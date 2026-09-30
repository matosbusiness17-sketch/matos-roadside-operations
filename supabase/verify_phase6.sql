-- ==============================================================================
-- MATOS SYSTEMS — PHASE 6 DATABASE STRUCTURAL VERIFICATION SCRIPT
-- ==============================================================================
-- Non-destructive catalog verification script for Phase 6 dispatch engine:
-- - Partial unique indexes for shift bindings and active dispatch assignments
-- - Assignment direct mutation policy closure and privilege revocations (INSERT, UPDATE, DELETE)
-- - RPC ACL verification: anon denied, authenticated granted, PUBLIC revoked
-- - Functions: get_dispatch_candidates, dispatch_incident, reassign_incident
--
-- Intended for manual execution in the Supabase SQL Editor.
-- Does NOT modify data or execute runtime dispatch mutations.
-- Uses authoritative PostgreSQL catalogs (pg_proc, pg_indexes, pg_policies, aclexplode).
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
  v_has_public_acl BOOLEAN;
  v_fn_def TEXT;

  v_idx_count INTEGER;
  v_pol_count INTEGER;
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE '  MATOS SYSTEMS — PHASE 6 STRUCTURAL DATABASE VERIFICATION      ';
  RAISE NOTICE '================================================================';

  -- ----------------------------------------------------------------------------
  -- 1. PARTIAL UNIQUE CONCURRENCY INDEXES
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 1. Partial Unique Concurrency Indexes ---';

  -- idx_uq_wva_active_worker
  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'worker_vehicle_assignments'
    AND indexname = 'idx_uq_wva_active_worker'
    AND indexdef ~* 'UNIQUE'
    AND indexdef ~* 'organization_id'
    AND indexdef ~* 'worker_id'
    AND indexdef ~* 'status\s*=\s*''active''';

  IF v_idx_count <> 1 THEN
    RAISE EXCEPTION '[FAIL] Unique partial index idx_uq_wva_active_worker not found with expected predicate';
  END IF;
  RAISE NOTICE '[PASS] Partial unique index idx_uq_wva_active_worker verified';

  -- idx_uq_wva_active_vehicle
  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'worker_vehicle_assignments'
    AND indexname = 'idx_uq_wva_active_vehicle'
    AND indexdef ~* 'UNIQUE'
    AND indexdef ~* 'organization_id'
    AND indexdef ~* 'vehicle_id'
    AND indexdef ~* 'status\s*=\s*''active''';

  IF v_idx_count <> 1 THEN
    RAISE EXCEPTION '[FAIL] Unique partial index idx_uq_wva_active_vehicle not found with expected predicate';
  END IF;
  RAISE NOTICE '[PASS] Partial unique index idx_uq_wva_active_vehicle verified';

  -- idx_uq_assignments_active_incident
  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'assignments'
    AND indexname = 'idx_uq_assignments_active_incident'
    AND indexdef ~* 'UNIQUE'
    AND indexdef ~* 'organization_id'
    AND indexdef ~* 'incident_id'
    AND indexdef ~* 'assigned' AND indexdef ~* 'accepted' AND indexdef ~* 'en_route' AND indexdef ~* 'on_scene';

  IF v_idx_count <> 1 THEN
    RAISE EXCEPTION '[FAIL] Unique partial index idx_uq_assignments_active_incident not found with expected predicate';
  END IF;
  RAISE NOTICE '[PASS] Partial unique index idx_uq_assignments_active_incident verified';

  -- idx_uq_assignments_active_worker
  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'assignments'
    AND indexname = 'idx_uq_assignments_active_worker'
    AND indexdef ~* 'UNIQUE'
    AND indexdef ~* 'organization_id'
    AND indexdef ~* 'worker_id'
    AND indexdef ~* 'assigned' AND indexdef ~* 'accepted' AND indexdef ~* 'en_route' AND indexdef ~* 'on_scene';

  IF v_idx_count <> 1 THEN
    RAISE EXCEPTION '[FAIL] Unique partial index idx_uq_assignments_active_worker not found with expected predicate';
  END IF;
  RAISE NOTICE '[PASS] Partial unique index idx_uq_assignments_active_worker verified';

  -- idx_uq_assignments_active_vehicle
  SELECT count(*) INTO v_idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'assignments'
    AND indexname = 'idx_uq_assignments_active_vehicle'
    AND indexdef ~* 'UNIQUE'
    AND indexdef ~* 'organization_id'
    AND indexdef ~* 'vehicle_id'
    AND indexdef ~* 'vehicle_id IS NOT NULL'
    AND indexdef ~* 'assigned' AND indexdef ~* 'accepted' AND indexdef ~* 'en_route' AND indexdef ~* 'on_scene';

  IF v_idx_count <> 1 THEN
    RAISE EXCEPTION '[FAIL] Unique partial index idx_uq_assignments_active_vehicle not found with expected predicate';
  END IF;
  RAISE NOTICE '[PASS] Partial unique index idx_uq_assignments_active_vehicle verified with NULL safety';

  -- ----------------------------------------------------------------------------
  -- 2. ASSIGNMENTS DIRECT MUTATION POLICY CLOSURE & TABLE PRIVILEGES
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 2. Assignments Policy Closure & Mutation Lockdown ---';

  -- assignments_select must exist
  SELECT count(*) INTO v_pol_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'assignments'
    AND policyname = 'assignments_select';

  IF v_pol_count <> 1 THEN
    RAISE EXCEPTION '[FAIL] Expected assignments_select policy on public.assignments to exist';
  END IF;
  RAISE NOTICE '[PASS] Policy assignments_select preserved for operator and worker reads';

  -- assignments_insert_operator_admin must NOT exist
  SELECT count(*) INTO v_pol_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'assignments'
    AND policyname = 'assignments_insert_operator_admin';

  IF v_pol_count <> 0 THEN
    RAISE EXCEPTION '[FAIL] Generic assignments_insert_operator_admin policy was NOT dropped';
  END IF;
  RAISE NOTICE '[PASS] Generic direct insert policy assignments_insert_operator_admin is absent';

  -- assignments_update must NOT exist
  SELECT count(*) INTO v_pol_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'assignments'
    AND policyname = 'assignments_update';

  IF v_pol_count <> 0 THEN
    RAISE EXCEPTION '[FAIL] Generic assignments_update policy was NOT dropped';
  END IF;
  RAISE NOTICE '[PASS] Generic direct update policy assignments_update is absent';

  -- Direct mutation grants on assignments table (INSERT, UPDATE, DELETE revoked from authenticated and anon)
  IF has_table_privilege('anon', 'public.assignments', 'INSERT') THEN
    RAISE EXCEPTION '[FAIL] Role anon unexpectedly has INSERT on public.assignments';
  END IF;
  IF has_table_privilege('anon', 'public.assignments', 'UPDATE') THEN
    RAISE EXCEPTION '[FAIL] Role anon unexpectedly has UPDATE on public.assignments';
  END IF;
  IF has_table_privilege('anon', 'public.assignments', 'DELETE') THEN
    RAISE EXCEPTION '[FAIL] Role anon unexpectedly has DELETE on public.assignments';
  END IF;
  IF has_table_privilege('authenticated', 'public.assignments', 'INSERT') THEN
    RAISE EXCEPTION '[FAIL] Role authenticated unexpectedly has direct INSERT on public.assignments';
  END IF;
  IF has_table_privilege('authenticated', 'public.assignments', 'UPDATE') THEN
    RAISE EXCEPTION '[FAIL] Role authenticated unexpectedly has direct UPDATE on public.assignments';
  END IF;
  IF has_table_privilege('authenticated', 'public.assignments', 'DELETE') THEN
    RAISE EXCEPTION '[FAIL] Role authenticated unexpectedly has direct DELETE on public.assignments';
  END IF;
  RAISE NOTICE '[PASS] Direct table mutations (INSERT, UPDATE, DELETE) revoked from authenticated and anon';

  -- SELECT on public.assignments preserved for authenticated role
  IF NOT has_table_privilege('authenticated', 'public.assignments', 'SELECT') THEN
    RAISE EXCEPTION '[FAIL] Role authenticated lacks SELECT on public.assignments';
  END IF;
  RAISE NOTICE '[PASS] SELECT on public.assignments preserved for authenticated role';

  -- ----------------------------------------------------------------------------
  -- 3. FUNCTION VERIFICATION: get_dispatch_candidates(UUID)
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 3. RPC: public.get_dispatch_candidates(UUID) ---';

  SELECT p.oid, p.prosecdef, p.proconfig, format_type(p.prorettype, NULL), p.pronargs
  INTO v_fn_oid, v_prosecdef, v_proconfig, v_return_type, v_nargs
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'get_dispatch_candidates'
    AND p.pronargs = 1;

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION '[FAIL] Function public.get_dispatch_candidates(UUID) not found in pg_proc';
  END IF;
  RAISE NOTICE '[PASS] Function public.get_dispatch_candidates(UUID) exists';

  IF v_return_type <> 'jsonb' THEN
    RAISE EXCEPTION '[FAIL] get_dispatch_candidates return type expected jsonb, found: %', v_return_type;
  END IF;
  RAISE NOTICE '[PASS] get_dispatch_candidates return type is jsonb';

  IF NOT v_prosecdef THEN
    RAISE EXCEPTION '[FAIL] get_dispatch_candidates is not SECURITY DEFINER';
  END IF;
  RAISE NOTICE '[PASS] get_dispatch_candidates is SECURITY DEFINER';

  IF v_proconfig IS NULL OR NOT ('search_path=public, extensions' = ANY(v_proconfig)) THEN
    RAISE EXCEPTION '[FAIL] get_dispatch_candidates search_path invalid: %', v_proconfig;
  END IF;
  RAISE NOTICE '[PASS] get_dispatch_candidates search_path configured with: public, extensions';

  -- Privileges for get_dispatch_candidates
  SELECT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') INTO v_has_priv_auth;
  IF NOT v_has_priv_auth THEN
    RAISE EXCEPTION '[FAIL] Role authenticated lacks EXECUTE on get_dispatch_candidates';
  END IF;
  RAISE NOTICE '[PASS] Role authenticated has EXECUTE on get_dispatch_candidates';

  SELECT has_function_privilege('anon', v_fn_oid, 'EXECUTE') INTO v_has_priv_anon;
  IF v_has_priv_anon THEN
    RAISE EXCEPTION '[FAIL] Role anon unexpectedly has EXECUTE on get_dispatch_candidates';
  END IF;
  RAISE NOTICE '[PASS] Role anon is denied EXECUTE on get_dispatch_candidates';

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = v_fn_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) INTO v_has_public_acl;
  IF v_has_public_acl THEN
    RAISE EXCEPTION '[FAIL] PUBLIC retains EXECUTE on get_dispatch_candidates';
  END IF;
  RAISE NOTICE '[PASS] PUBLIC is revoked from get_dispatch_candidates';

  -- Function Source Inspection via pg_get_functiondef
  v_fn_def := pg_get_functiondef(v_fn_oid);

  IF v_fn_def !~* 'ST_Distance' THEN
    RAISE EXCEPTION '[FAIL] get_dispatch_candidates does not call PostGIS ST_Distance';
  END IF;
  RAISE NOTICE '[PASS] get_dispatch_candidates uses PostGIS ST_Distance';

  IF v_fn_def !~* 'jsonb_agg\([\s\S]*?ORDER\s+BY\s+r\.distance_meters\s+ASC,\s*r\.callsign\s+ASC,\s*r\.worker_id\s+ASC' THEN
    RAISE EXCEPTION '[FAIL] get_dispatch_candidates aggregate-level distance ordering missing inside jsonb_agg';
  END IF;
  RAISE NOTICE '[PASS] get_dispatch_candidates enforces distance ordering INSIDE final jsonb_agg';

  -- Verify incident active conflict check in candidate CTE
  IF v_fn_def !~* 'NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.assignments\s+a[\s\S]*?a\.incident_id\s*=\s*p_incident_id[\s\S]*?a\.status\s+IN\s*\(\s*''assigned'',\s*''accepted'',\s*''en_route'',\s*''on_scene''\s*\)' THEN
    RAISE EXCEPTION '[FAIL] get_dispatch_candidates candidate CTE missing target incident conflict check';
  END IF;
  RAISE NOTICE '[PASS] get_dispatch_candidates candidate CTE enforces target incident conflict check';

  -- Verify fail-closed multi-active handling
  IF v_fn_def !~* 'v_active_assignments_count\s*<>\s*1' THEN
    RAISE EXCEPTION '[FAIL] get_dispatch_candidates does not fail closed on invalid active assignment count for dispatched incidents';
  END IF;
  RAISE NOTICE '[PASS] get_dispatch_candidates fails closed on abnormal active assignment counts';

  -- ----------------------------------------------------------------------------
  -- 4. FUNCTION VERIFICATION: dispatch_incident(UUID, UUID, UUID)
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 4. RPC: public.dispatch_incident(UUID, UUID, UUID) ---';

  SELECT p.oid, p.prosecdef, p.proconfig, format_type(p.prorettype, NULL), p.pronargs
  INTO v_fn_oid, v_prosecdef, v_proconfig, v_return_type, v_nargs
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'dispatch_incident'
    AND p.pronargs = 3;

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION '[FAIL] Function public.dispatch_incident(UUID, UUID, UUID) not found in pg_proc';
  END IF;
  RAISE NOTICE '[PASS] Function public.dispatch_incident(UUID, UUID, UUID) exists';

  IF v_return_type <> 'jsonb' THEN
    RAISE EXCEPTION '[FAIL] dispatch_incident return type expected jsonb, found: %', v_return_type;
  END IF;
  RAISE NOTICE '[PASS] dispatch_incident return type is jsonb';

  IF NOT v_prosecdef THEN
    RAISE EXCEPTION '[FAIL] dispatch_incident is not SECURITY DEFINER';
  END IF;
  RAISE NOTICE '[PASS] dispatch_incident is SECURITY DEFINER';

  IF v_proconfig IS NULL OR NOT ('search_path=public, extensions' = ANY(v_proconfig)) THEN
    RAISE EXCEPTION '[FAIL] dispatch_incident search_path invalid: %', v_proconfig;
  END IF;
  RAISE NOTICE '[PASS] dispatch_incident search_path configured with: public, extensions';

  -- Privileges for dispatch_incident
  SELECT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') INTO v_has_priv_auth;
  IF NOT v_has_priv_auth THEN
    RAISE EXCEPTION '[FAIL] Role authenticated lacks EXECUTE on dispatch_incident';
  END IF;
  RAISE NOTICE '[PASS] Role authenticated has EXECUTE on dispatch_incident';

  SELECT has_function_privilege('anon', v_fn_oid, 'EXECUTE') INTO v_has_priv_anon;
  IF v_has_priv_anon THEN
    RAISE EXCEPTION '[FAIL] Role anon unexpectedly has EXECUTE on dispatch_incident';
  END IF;
  RAISE NOTICE '[PASS] Role anon is denied EXECUTE on dispatch_incident';

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = v_fn_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) INTO v_has_public_acl;
  IF v_has_public_acl THEN
    RAISE EXCEPTION '[FAIL] PUBLIC retains EXECUTE on dispatch_incident';
  END IF;
  RAISE NOTICE '[PASS] PUBLIC is revoked from dispatch_incident';

  -- Function Source Inspection via pg_get_functiondef
  v_fn_def := pg_get_functiondef(v_fn_oid);

  IF v_fn_def !~* 'transition_incident_status\(\s*p_incident_id,\s*''dispatched''' THEN
    RAISE EXCEPTION '[FAIL] dispatch_incident does not reuse Phase 4 transition_incident_status';
  END IF;
  RAISE NOTICE '[PASS] dispatch_incident reuses authoritative Phase 4 transition function';

  IF v_fn_def !~* '''ASSIGNMENT_CREATED''' THEN
    RAISE EXCEPTION '[FAIL] dispatch_incident does not record ASSIGNMENT_CREATED audit event';
  END IF;
  RAISE NOTICE '[PASS] dispatch_incident writes ASSIGNMENT_CREATED audit event';

  -- ----------------------------------------------------------------------------
  -- 5. FUNCTION VERIFICATION: reassign_incident(UUID, UUID, UUID, UUID)
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 5. RPC: public.reassign_incident(UUID, UUID, UUID, UUID) ---';

  SELECT p.oid, p.prosecdef, p.proconfig, format_type(p.prorettype, NULL), p.pronargs
  INTO v_fn_oid, v_prosecdef, v_proconfig, v_return_type, v_nargs
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'reassign_incident'
    AND p.pronargs = 4;

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION '[FAIL] Function public.reassign_incident(UUID, UUID, UUID, UUID) not found in pg_proc';
  END IF;
  RAISE NOTICE '[PASS] Function public.reassign_incident(UUID, UUID, UUID, UUID) exists';

  IF v_return_type <> 'jsonb' THEN
    RAISE EXCEPTION '[FAIL] reassign_incident return type expected jsonb, found: %', v_return_type;
  END IF;
  RAISE NOTICE '[PASS] reassign_incident return type is jsonb';

  IF NOT v_prosecdef THEN
    RAISE EXCEPTION '[FAIL] reassign_incident is not SECURITY DEFINER';
  END IF;
  RAISE NOTICE '[PASS] reassign_incident is SECURITY DEFINER';

  IF v_proconfig IS NULL OR NOT ('search_path=public, extensions' = ANY(v_proconfig)) THEN
    RAISE EXCEPTION '[FAIL] reassign_incident search_path invalid: %', v_proconfig;
  END IF;
  RAISE NOTICE '[PASS] reassign_incident search_path configured with: public, extensions';

  -- Privileges for reassign_incident
  SELECT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') INTO v_has_priv_auth;
  IF NOT v_has_priv_auth THEN
    RAISE EXCEPTION '[FAIL] Role authenticated lacks EXECUTE on reassign_incident';
  END IF;
  RAISE NOTICE '[PASS] Role authenticated has EXECUTE on reassign_incident';

  SELECT has_function_privilege('anon', v_fn_oid, 'EXECUTE') INTO v_has_priv_anon;
  IF v_has_priv_anon THEN
    RAISE EXCEPTION '[FAIL] Role anon unexpectedly has EXECUTE on reassign_incident';
  END IF;
  RAISE NOTICE '[PASS] Role anon is denied EXECUTE on reassign_incident';

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = v_fn_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) INTO v_has_public_acl;
  IF v_has_public_acl THEN
    RAISE EXCEPTION '[FAIL] PUBLIC retains EXECUTE on reassign_incident';
  END IF;
  RAISE NOTICE '[PASS] PUBLIC is revoked from reassign_incident';

  -- Function Source Inspection via pg_get_functiondef
  v_fn_def := pg_get_functiondef(v_fn_oid);

  IF v_fn_def !~* 'status\s*=\s*''cancelled''' THEN
    RAISE EXCEPTION '[FAIL] reassign_incident does not cancel the previous assignment';
  END IF;
  RAISE NOTICE '[PASS] reassign_incident cancels prior assignment';

  IF v_fn_def !~* '''INCIDENT_REASSIGNED''' THEN
    RAISE EXCEPTION '[FAIL] reassign_incident does not record INCIDENT_REASSIGNED audit event';
  END IF;
  RAISE NOTICE '[PASS] reassign_incident writes INCIDENT_REASSIGNED audit event';

  RAISE NOTICE '================================================================';
  RAISE NOTICE '  PHASE 6 STRUCTURAL VERIFICATION COMPLETE: ALL CHECKS PASSED   ';
  RAISE NOTICE '================================================================';
END $$;
