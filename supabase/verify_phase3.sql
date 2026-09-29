-- ==============================================================================
-- MATOS SYSTEMS — PHASE 3 DATABASE STRUCTURAL & SECURITY VERIFICATION
-- ==============================================================================
-- Purpose:
--   Non-destructive structural and catalog verification for Phase 3:
--   PostGIS spatial schema, service capabilities, vehicle capabilities RLS,
--   incident extensions, and spatial SECURITY DEFINER functions.
--
-- Execution:
--   Intended for manual execution in the Supabase SQL Editor.
--   Note: This script performs catalog and policy structural verification;
--   it does not replace authenticated runtime cross-tenant integration testing.
-- ==============================================================================

DO $$
DECLARE
  v_passed INTEGER := 0;
  v_failed INTEGER := 0;

  -- Policy expression holders
  v_select_qual TEXT;
  v_select_outer TEXT;
  v_select_inner TEXT;
  v_insert_check TEXT;
  v_update_using TEXT;
  v_update_check TEXT;
  v_delete_using TEXT;
  v_sc_select_qual TEXT;
  v_sc_insert_check TEXT;
  v_sc_update_using TEXT;
  v_sc_update_check TEXT;
  v_sc_delete_using TEXT;

  -- Helper procedure for assertions
  PROCEDURE assert_true(condition BOOLEAN, test_name TEXT, fail_detail TEXT) IS
  BEGIN
    IF condition THEN
      v_passed := v_passed + 1;
      RAISE NOTICE '[PASS] %', test_name;
    ELSE
      v_failed := v_failed + 1;
      RAISE WARNING '[FAIL] %: %', test_name, fail_detail;
    END IF;
  END;

BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE '  MATOS SYSTEMS — PHASE 3 DATABASE STRUCTURAL VERIFICATION      ';
  RAISE NOTICE '================================================================';

  -- ----------------------------------------------------------------------------
  -- 1. POSTGIS SPATIAL EXTENSION
  -- ----------------------------------------------------------------------------
  assert_true(
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis'),
    'PostGIS extension is installed',
    'postgis extension not found in pg_extension'
  );

  -- ----------------------------------------------------------------------------
  -- 2. VEHICLES SPATIAL EXTENSIONS & INDEXING
  -- ----------------------------------------------------------------------------
  assert_true(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vehicles'
        AND column_name = 'last_known_location' AND udt_name = 'geography'
    ),
    'vehicles.last_known_location exists as geography',
    'Column last_known_location missing or not geography'
  );

  assert_true(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vehicles'
        AND column_name = 'location_updated_at' AND data_type = 'timestamp with time zone'
    ),
    'vehicles.location_updated_at exists as TIMESTAMPTZ',
    'Column location_updated_at missing or not TIMESTAMPTZ'
  );

  assert_true(
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'vehicles'
        AND indexname = 'idx_vehicles_last_known_location'
        AND indexdef ILIKE '%gist%last_known_location%'
    ),
    'GiST index on vehicles(last_known_location) exists',
    'GiST index idx_vehicles_last_known_location missing'
  );

  -- ----------------------------------------------------------------------------
  -- 3. SERVICE CAPABILITIES CATALOGUE & RLS
  -- ----------------------------------------------------------------------------
  assert_true(
    EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'service_capabilities'
        AND rowsecurity = true
    ),
    'service_capabilities table exists with RLS enabled',
    'service_capabilities table missing or RLS not enabled'
  );

  SELECT qual INTO v_sc_select_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'service_capabilities'
    AND policyname = 'service_capabilities_select_active';

  assert_true(
    v_sc_select_qual ILIKE '%is_active = true%' OR v_sc_select_qual ILIKE '%(is_active = true)%',
    'service_capabilities_select_active checks is_active = true',
    'SELECT policy missing is_active = true check'
  );

  SELECT with_check INTO v_sc_insert_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'service_capabilities'
    AND policyname = 'service_capabilities_insert_admin';

  assert_true(
    v_sc_insert_check ILIKE '%admin%' AND v_sc_insert_check ILIKE '%operator%',
    'service_capabilities_insert_admin checks admin/operator role',
    'INSERT policy missing admin/operator check'
  );

  SELECT qual, with_check INTO v_sc_update_using, v_sc_update_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'service_capabilities'
    AND policyname = 'service_capabilities_update_admin';

  assert_true(
    (v_sc_update_using ILIKE '%admin%' AND v_sc_update_using ILIKE '%operator%')
    AND (v_sc_update_check ILIKE '%admin%' AND v_sc_update_check ILIKE '%operator%'),
    'service_capabilities_update_admin checks admin/operator in USING and WITH CHECK',
    'UPDATE policy missing role checks in USING or WITH CHECK'
  );

  SELECT qual INTO v_sc_delete_using
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'service_capabilities'
    AND policyname = 'service_capabilities_delete_admin';

  assert_true(
    v_sc_delete_using ILIKE '%admin%' AND v_sc_delete_using ILIKE '%operator%',
    'service_capabilities_delete_admin checks admin/operator in USING',
    'DELETE policy missing admin/operator role check'
  );

  -- ----------------------------------------------------------------------------
  -- 4. VEHICLE CAPABILITIES TABLE & TENANT INTEGRITY
  -- ----------------------------------------------------------------------------
  assert_true(
    EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = 'vehicle_capabilities'
        AND rowsecurity = true
    ),
    'vehicle_capabilities table exists with RLS enabled',
    'vehicle_capabilities table missing or RLS not enabled'
  );

  assert_true(
    EXISTS (
      SELECT 1
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'vehicle_capabilities'
        AND tc.constraint_name = 'fk_vehicle_capabilities_vehicle_org'
    ),
    'vehicle_capabilities enforces composite FK fk_vehicle_capabilities_vehicle_org',
    'Composite foreign key fk_vehicle_capabilities_vehicle_org missing'
  );

  assert_true(
    EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_type = 'UNIQUE'
        AND table_name = 'vehicle_capabilities'
        AND constraint_name = 'uq_vehicle_capabilities_vehicle_cap'
    ),
    'vehicle_capabilities enforces unique constraint (vehicle_id, capability_id)',
    'Unique constraint uq_vehicle_capabilities_vehicle_cap missing'
  );

  -- ----------------------------------------------------------------------------
  -- 5. VEHICLE CAPABILITIES SELECT RLS (WORKER CONFINEMENT VERIFICATION)
  -- ----------------------------------------------------------------------------
  SELECT qual INTO v_select_qual
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'vehicle_capabilities'
    AND policyname = 'vehicle_capabilities_select';

  assert_true(
    v_select_qual IS NOT NULL,
    'vehicle_capabilities_select policy exists',
    'Policy vehicle_capabilities_select not found'
  );

  -- Split expression at EXISTS to distinguish outer row predicates from subquery predicates
  v_select_outer := split_part(v_select_qual, 'EXISTS', 1);
  v_select_inner := split_part(v_select_qual, 'EXISTS', 2);

  -- A. OUTER ROW / TENANT BOUNDARY
  assert_true(
    v_select_outer ~* 'organization_id\s*=\s*(public\.)?get_current_user_organization_id\(\)',
    'vehicle_capabilities_select outer row restricted to get_current_user_organization_id()',
    'Outer tenant organization predicate missing before EXISTS'
  );

  -- B. ADMIN / OPERATOR BRANCH
  assert_true(
    v_select_outer ~* 'admin' AND v_select_outer ~* 'operator',
    'vehicle_capabilities_select grants access to admin and operator roles',
    'Admin/operator branch missing from outer SELECT policy'
  );

  -- C. WORKER ROLE BRANCH
  assert_true(
    v_select_outer ~* 'worker',
    'vehicle_capabilities_select checks worker role',
    'Worker role check missing from outer SELECT policy'
  );

  -- D. WORKER ASSIGNMENT SUBQUERY CHECKS
  assert_true(
    v_select_inner ~* 'worker_vehicle_assignments',
    'vehicle_capabilities_select inspects worker_vehicle_assignments in subquery',
    'worker_vehicle_assignments table missing from EXISTS subquery'
  );

  assert_true(
    v_select_inner ~* 'vehicle_id\s*=\s*(public\.)?(vehicle_capabilities\.)?vehicle_id',
    'vehicle_capabilities_select subquery binds vehicle_id to row vehicle_id',
    'vehicle_id equality binding missing from worker assignment subquery'
  );

  assert_true(
    v_select_inner ~* 'worker_id\s*=\s*(public\.)?get_current_worker_id\(\)',
    'vehicle_capabilities_select subquery binds worker_id to get_current_worker_id()',
    'get_current_worker_id() binding missing from worker assignment subquery'
  );

  -- DISTINCT INNER TENANT BINDING
  assert_true(
    v_select_inner ~* 'organization_id\s*=\s*(public\.)?get_current_user_organization_id\(\)',
    'vehicle_capabilities_select subquery independently binds worker assignment organization_id',
    'worker_vehicle_assignments subquery missing organization_id = get_current_user_organization_id()'
  );

  assert_true(
    v_select_inner ~* 'status\s*=\s*''active''',
    'vehicle_capabilities_select subquery requires worker assignment status = active',
    'status = active check missing from worker assignment subquery'
  );

  -- Confirm get_current_user_organization_id occurs in both outer predicate and inner subquery
  assert_true(
    (
      SELECT count(*)
      FROM regexp_matches(
        v_select_qual,
        'get_current_user_organization_id',
        'g'
      )
    ) >= 2,
    'get_current_user_organization_id() appears at least twice (outer + inner subquery)',
    'Policy does not contain separate outer and inner organization bindings'
  );

  -- ----------------------------------------------------------------------------
  -- 6. VEHICLE CAPABILITIES WRITE POLICIES (INSERT / UPDATE / DELETE)
  -- ----------------------------------------------------------------------------
  -- vehicle_capabilities_insert
  SELECT with_check INTO v_insert_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'vehicle_capabilities'
    AND policyname = 'vehicle_capabilities_insert'
    AND cmd = 'INSERT';

  assert_true(
    v_insert_check IS NOT NULL
    AND v_insert_check ~* 'organization_id\s*=\s*(public\.)?get_current_user_organization_id\(\)'
    AND v_insert_check ~* 'admin' AND v_insert_check ~* 'operator',
    'vehicle_capabilities_insert WITH CHECK enforces caller org and admin/operator role',
    'INSERT WITH CHECK missing caller org or admin/operator check'
  );

  -- vehicle_capabilities_update
  SELECT qual, with_check INTO v_update_using, v_update_check
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'vehicle_capabilities'
    AND policyname = 'vehicle_capabilities_update'
    AND cmd = 'UPDATE';

  assert_true(
    v_update_using IS NOT NULL
    AND v_update_using ~* 'organization_id\s*=\s*(public\.)?get_current_user_organization_id\(\)'
    AND v_update_using ~* 'admin' AND v_update_using ~* 'operator',
    'vehicle_capabilities_update USING enforces caller org and admin/operator role',
    'UPDATE USING missing caller org or admin/operator check'
  );

  assert_true(
    v_update_check IS NOT NULL
    AND v_update_check ~* 'organization_id\s*=\s*(public\.)?get_current_user_organization_id\(\)'
    AND v_update_check ~* 'admin' AND v_update_check ~* 'operator',
    'vehicle_capabilities_update WITH CHECK independently enforces caller org and admin/operator role',
    'UPDATE WITH CHECK missing caller org or admin/operator check'
  );

  -- vehicle_capabilities_delete
  SELECT qual INTO v_delete_using
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'vehicle_capabilities'
    AND policyname = 'vehicle_capabilities_delete'
    AND cmd = 'DELETE';

  assert_true(
    v_delete_using IS NOT NULL
    AND v_delete_using ~* 'organization_id\s*=\s*(public\.)?get_current_user_organization_id\(\)'
    AND v_delete_using ~* 'admin' AND v_delete_using ~* 'operator',
    'vehicle_capabilities_delete USING enforces caller org and admin/operator role',
    'DELETE USING missing caller org or admin/operator check'
  );

  -- ----------------------------------------------------------------------------
  -- 7. INCIDENTS SPATIAL EXTENSIONS & VEHICLE FIELDS
  -- ----------------------------------------------------------------------------
  assert_true(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'incidents'
        AND column_name = 'location' AND udt_name = 'geography'
    ),
    'incidents.location exists as geography(Point, 4326)',
    'incidents.location missing or not geography'
  );

  assert_true(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'incidents'
        AND column_name = 'location_accuracy' AND data_type = 'double precision'
    ),
    'incidents.location_accuracy exists as DOUBLE PRECISION',
    'incidents.location_accuracy missing or not DOUBLE PRECISION'
  );

  assert_true(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'incidents'
        AND column_name = 'location_source' AND data_type = 'text'
    ),
    'incidents.location_source exists as TEXT',
    'incidents.location_source missing or not TEXT'
  );

  assert_true(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'incidents'
        AND column_name = 'required_capability_id' AND data_type = 'uuid'
    ),
    'incidents.required_capability_id exists as UUID',
    'incidents.required_capability_id missing'
  );

  assert_true(
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'incidents'
        AND indexname = 'idx_incidents_location'
        AND indexdef ILIKE '%gist%location%'
    ),
    'GiST index on incidents(location) exists',
    'GiST index idx_incidents_location missing'
  );

  -- ----------------------------------------------------------------------------
  -- 8. SPATIAL SECURITY DEFINER FUNCTIONS
  -- ----------------------------------------------------------------------------
  -- calculate_incident_vehicle_distance
  assert_true(
    EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'calculate_incident_vehicle_distance'
        AND prosecdef = true
    ),
    'calculate_incident_vehicle_distance is SECURITY DEFINER',
    'calculate_incident_vehicle_distance missing or not SECURITY DEFINER'
  );

  -- get_nearby_vehicles
  assert_true(
    EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'get_nearby_vehicles'
        AND prosecdef = true
    ),
    'get_nearby_vehicles is SECURITY DEFINER',
    'get_nearby_vehicles missing or not SECURITY DEFINER'
  );

  -- get_nearby_vehicles_for_incident
  assert_true(
    EXISTS (
      SELECT 1 FROM pg_proc
      WHERE proname = 'get_nearby_vehicles_for_incident'
        AND prosecdef = true
    ),
    'get_nearby_vehicles_for_incident is SECURITY DEFINER',
    'get_nearby_vehicles_for_incident missing or not SECURITY DEFINER'
  );

  -- ----------------------------------------------------------------------------
  -- FINAL SUMMARY
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '================================================================';
  RAISE NOTICE '  VERIFICATION SUMMARY: % PASSED, % FAILED', v_passed, v_failed;
  RAISE NOTICE '================================================================';

  IF v_failed > 0 THEN
    RAISE EXCEPTION 'Phase 3 database structural verification encountered % failure(s).', v_failed;
  ELSE
    RAISE NOTICE 'SUCCESS: All Phase 3 database structural & RLS expressions verified.';
  END IF;
END;
$$;
