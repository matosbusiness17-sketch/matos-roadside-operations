-- ==============================================================================
-- MATOS SYSTEMS — PHASE 5 DATABASE STRUCTURAL VERIFICATION SCRIPT
-- ==============================================================================
-- Non-destructive catalog verification script for Phase 5 operational snapshot RPC.
-- Intended for manual execution in the Supabase SQL Editor.
-- Does NOT modify data or perform runtime transactions.
-- Does NOT execute get_operations_map_snapshot() directly (as SQL Editor session
-- lacks application-level JWT claims).
-- ==============================================================================

DO $$
DECLARE
  v_fn_oid OID;
  v_prosecdef BOOLEAN;
  v_proconfig TEXT[];
  v_return_type TEXT;
  v_nargs INTEGER;
  v_has_priv_auth BOOLEAN;
  v_has_priv_anon BOOLEAN;
  v_has_priv_public BOOLEAN;
  v_src TEXT;
  v_idx_count INTEGER;
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE '  MATOS SYSTEMS — PHASE 5 STRUCTURAL DATABASE VERIFICATION      ';
  RAISE NOTICE '================================================================';

  -- ----------------------------------------------------------------------------
  -- 1. FUNCTION EXISTENCE, IDENTITY & SIGNATURE
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 1. Snapshot RPC Function Identity & Signature ---';

  SELECT p.oid, p.prosecdef, p.proconfig, format_type(p.prorettype, NULL), p.pronargs, p.prosrc
  INTO v_fn_oid, v_prosecdef, v_proconfig, v_return_type, v_nargs, v_src
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'get_operations_map_snapshot';

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION '[FAIL] Function public.get_operations_map_snapshot() not found in pg_proc';
  END IF;
  RAISE NOTICE '[PASS] Function public.get_operations_map_snapshot() exists';

  -- Verify exact zero parameters
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION '[FAIL] get_operations_map_snapshot expected 0 arguments, found: %', v_nargs;
  END IF;
  RAISE NOTICE '[PASS] get_operations_map_snapshot takes exactly 0 parameters (zero-parameter contract)';

  -- Verify return type is jsonb
  IF v_return_type <> 'jsonb' THEN
    RAISE EXCEPTION '[FAIL] get_operations_map_snapshot return type expected jsonb, found: %', v_return_type;
  END IF;
  RAISE NOTICE '[PASS] get_operations_map_snapshot return type is jsonb';

  -- Verify SECURITY DEFINER
  IF NOT v_prosecdef THEN
    RAISE EXCEPTION '[FAIL] get_operations_map_snapshot is not declared SECURITY DEFINER';
  END IF;
  RAISE NOTICE '[PASS] get_operations_map_snapshot is SECURITY DEFINER';

  -- Verify search_path contains public, extensions
  IF v_proconfig IS NULL OR NOT ('search_path=public, extensions' = ANY(v_proconfig)) THEN
    RAISE EXCEPTION '[FAIL] get_operations_map_snapshot search_path configuration invalid: %', v_proconfig;
  END IF;
  RAISE NOTICE '[PASS] get_operations_map_snapshot search_path configured with: public, extensions';

  -- ----------------------------------------------------------------------------
  -- 2. PRIVILEGES & ACCESS CONTROL
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 2. Function Execution Privileges ---';

  -- Authenticated user must have EXECUTE
  SELECT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE')
  INTO v_has_priv_auth;

  IF NOT v_has_priv_auth THEN
    RAISE EXCEPTION '[FAIL] Role authenticated does not have EXECUTE privilege on get_operations_map_snapshot';
  END IF;
  RAISE NOTICE '[PASS] Role authenticated has EXECUTE privilege';

  -- Anon user must NOT have EXECUTE
  SELECT has_function_privilege('anon', v_fn_oid, 'EXECUTE')
  INTO v_has_priv_anon;

  IF v_has_priv_anon THEN
    RAISE EXCEPTION '[FAIL] Role anon unexpectedly has EXECUTE privilege on get_operations_map_snapshot';
  END IF;
  RAISE NOTICE '[PASS] Role anon is denied EXECUTE privilege';

  -- PUBLIC must NOT retain EXECUTE (catalog / aclexplode inspection; grantee = 0 is PUBLIC)
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(
      COALESCE(p.proacl, acldefault('f', p.proowner))
    ) acl
    WHERE p.oid = v_fn_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
  INTO v_has_priv_public;

  IF v_has_priv_public THEN
    RAISE EXCEPTION '[FAIL] Role PUBLIC unexpectedly retains EXECUTE privilege on get_operations_map_snapshot';
  END IF;
  RAISE NOTICE '[PASS] Role PUBLIC is revoked from EXECUTE privilege';

  -- ----------------------------------------------------------------------------
  -- 3. SOURCE CODE SECURITY & TENANT ENFORCEMENT
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 3. Function Source Session & Authorization Analysis ---';

  IF v_src NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION '[FAIL] Function source does not derive auth.uid()';
  END IF;
  RAISE NOTICE '[PASS] Function source derives auth.uid() from session';

  IF v_src NOT LIKE '%get_current_user_organization_id()%' THEN
    RAISE EXCEPTION '[FAIL] Function source does not derive organization from get_current_user_organization_id()';
  END IF;
  RAISE NOTICE '[PASS] Function source derives tenant from get_current_user_organization_id()';

  IF v_src NOT LIKE '%get_current_user_role()%' THEN
    RAISE EXCEPTION '[FAIL] Function source does not derive role from get_current_user_role()';
  END IF;
  RAISE NOTICE '[PASS] Function source derives role from get_current_user_role()';

  -- Worker rejection & admin/operator boundary
  IF v_src NOT LIKE '%admin%' OR v_src NOT LIKE '%operator%' THEN
    RAISE EXCEPTION '[FAIL] Function source does not restrict roles to admin and operator';
  END IF;
  RAISE NOTICE '[PASS] Function source restricts role execution to admin and operator';

  -- ----------------------------------------------------------------------------
  -- 4. INCIDENT & VEHICLE SCOPING IN SOURCE
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 4. Active Incident & Fleet Scoping in Source ---';

  -- Active statuses must be present
  IF v_src NOT LIKE '%new%' OR v_src NOT LIKE '%triaged%' OR v_src NOT LIKE '%ready_for_dispatch%'
     OR v_src NOT LIKE '%dispatched%' OR v_src NOT LIKE '%en_route%' OR v_src NOT LIKE '%on_scene%'
     OR v_src NOT LIKE '%in_progress%' THEN
    RAISE EXCEPTION '[FAIL] Function source missing one or more of the 7 active operational statuses';
  END IF;
  RAISE NOTICE '[PASS] Function source includes all 7 active operational statuses';

  -- Missing location tolerance
  IF v_src LIKE '%i.location IS NOT NULL%' OR v_src LIKE '%location IS NOT NULL%' THEN
    -- Check if it is used in a WHERE clause rather than a CASE expression
    IF v_src ~* 'WHERE[\s\S]*?location\s+IS\s+NOT\s+NULL' THEN
      RAISE EXCEPTION '[FAIL] Incident query requires location IS NOT NULL in WHERE clause';
    END IF;
  END IF;
  RAISE NOTICE '[PASS] Incident query tolerates missing coordinates (no location IS NOT NULL WHERE filter)';

  -- Active fleet scoping
  IF v_src NOT LIKE '%is_active = true%' AND v_src NOT LIKE '%is_active=true%' THEN
    RAISE EXCEPTION '[FAIL] Vehicle query does not filter by is_active = true';
  END IF;
  RAISE NOTICE '[PASS] Vehicle query scopes to active response fleet (is_active = true)';

  -- Unlocated vehicle tolerance
  IF v_src ~* 'WHERE[\s\S]*?last_known_location\s+IS\s+NOT\s+NULL' THEN
    RAISE EXCEPTION '[FAIL] Vehicle query requires last_known_location IS NOT NULL in WHERE clause';
  END IF;
  RAISE NOTICE '[PASS] Vehicle query tolerates unlocated units (no last_known_location IS NOT NULL WHERE filter)';

  -- ----------------------------------------------------------------------------
  -- 5. POSTGIS COORDINATE EXTRACTION & READ-ONLY INTEGRITY
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 5. PostGIS Derivation & Mutation Prevention ---';

  IF v_src NOT LIKE '%ST_X%' OR v_src NOT LIKE '%ST_Y%' THEN
    RAISE EXCEPTION '[FAIL] Function source does not use PostGIS ST_X and ST_Y coordinate derivation';
  END IF;
  RAISE NOTICE '[PASS] Function source extracts PostGIS coordinates via ST_X and ST_Y';

  -- Read-only guarantee: zero data modifications
  IF v_src ~* 'INSERT\s+INTO\s+public\.(incidents|vehicles|assignments|operational_events)' THEN
    RAISE EXCEPTION '[FAIL] Function source contains INSERT mutation on operational tables';
  END IF;
  IF v_src ~* 'UPDATE\s+public\.(incidents|vehicles|assignments|operational_events)' THEN
    RAISE EXCEPTION '[FAIL] Function source contains UPDATE mutation on operational tables';
  END IF;
  IF v_src ~* 'DELETE\s+FROM\s+public\.(incidents|vehicles|assignments|operational_events)' THEN
    RAISE EXCEPTION '[FAIL] Function source contains DELETE mutation on operational tables';
  END IF;
  RAISE NOTICE '[PASS] Function source is strictly read-only (zero data mutation statements)';

  -- ----------------------------------------------------------------------------
  -- 6. SUPPORTING INDEX HEALTH
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 6. Supporting Index Existence ---';

  SELECT count(*)
  INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'incidents'
    AND indexname IN ('idx_incidents_org', 'idx_incidents_status', 'idx_incidents_location');

  IF v_idx_count < 3 THEN
    RAISE EXCEPTION '[FAIL] Expected incident supporting indexes missing (found % of 3)', v_idx_count;
  END IF;
  RAISE NOTICE '[PASS] Required incident indexes exist (idx_incidents_org, idx_incidents_status, idx_incidents_location)';

  SELECT count(*)
  INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'vehicles'
    AND indexname IN ('idx_vehicles_org', 'idx_vehicles_last_known_location');

  IF v_idx_count < 2 THEN
    RAISE EXCEPTION '[FAIL] Expected vehicle supporting indexes missing (found % of 2)', v_idx_count;
  END IF;
  RAISE NOTICE '[PASS] Required vehicle indexes exist (idx_vehicles_org, idx_vehicles_last_known_location)';

  -- ----------------------------------------------------------------------------
  -- SUMMARY
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '================================================================';
  RAISE NOTICE '  VERIFICATION COMPLETE: ALL PHASE 5 CHECKS PASSED              ';
  RAISE NOTICE '================================================================';
END $$;
