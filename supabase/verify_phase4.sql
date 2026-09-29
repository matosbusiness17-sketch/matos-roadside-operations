-- ==============================================================================
-- MATOS SYSTEMS — PHASE 4 DATABASE STRUCTURAL VERIFICATION SCRIPT
-- ==============================================================================
-- Non-destructive catalog verification script for Phase 4 state machine & security.
-- Intended for manual execution in the Supabase SQL Editor.
-- Does NOT modify data or perform runtime transactions.
-- ==============================================================================

DO $$
DECLARE
  v_count INTEGER;
  v_str TEXT;
  v_prosecdef BOOLEAN;
  v_proconfig TEXT[];
  v_has_priv BOOLEAN;
  v_statuses TEXT[];
  v_expected_statuses TEXT[] := ARRAY[
    'cancelled',
    'completed',
    'dispatched',
    'en_route',
    'in_progress',
    'new',
    'on_scene',
    'ready_for_dispatch',
    'triaged',
    'unable_to_complete'
  ];
  v_fn_oid OID;
  v_fn_src TEXT;
  v_fn_result TEXT;
  v_extracted_services TEXT[];
  v_extracted_priorities TEXT[];
BEGIN
  RAISE NOTICE '================================================================';
  RAISE NOTICE '  MATOS SYSTEMS — PHASE 4 STRUCTURAL DATABASE VERIFICATION      ';
  RAISE NOTICE '================================================================';

  -- ----------------------------------------------------------------------------
  -- 1. INCIDENT STATUS CONSTRAINT & DEFAULT
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 1. Incident Status Constraint & Column Default ---';

  -- Check constraint exists
  SELECT pg_get_constraintdef(c.oid)
  INTO v_str
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'incidents'
    AND c.conname = 'incidents_status_check';

  IF v_str IS NULL THEN
    RAISE EXCEPTION '[FAIL] Constraint incidents_status_check not found on public.incidents';
  END IF;

  -- Extract statuses from CHECK expression
  SELECT array_agg(m[1] ORDER BY m[1])
  INTO v_statuses
  FROM regexp_matches(v_str, '''([a-z_]+)''', 'g') AS m;

  IF v_statuses <> v_expected_statuses THEN
    RAISE EXCEPTION '[FAIL] incidents_status_check does not match exact 10-state lifecycle. Found: %, Expected: %',
      v_statuses, v_expected_statuses;
  END IF;
  RAISE NOTICE '[PASS] incidents_status_check enforces exact 10 statuses (no "created", no extra values)';

  -- Column default check (must be 'new'::text)
  SELECT column_default
  INTO v_str
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'incidents'
    AND column_name = 'status';

  IF v_str IS NULL OR v_str <> '''new''::text' THEN
    RAISE EXCEPTION '[FAIL] public.incidents.status default is not ''new''::text (found: %)', v_str;
  END IF;
  RAISE NOTICE '[PASS] public.incidents.status default is correctly ''new''::text';

  -- Ensure no legacy 'created' rows remain
  SELECT count(*)
  INTO v_count
  FROM public.incidents
  WHERE status = 'created';

  IF v_count > 0 THEN
    RAISE EXCEPTION '[FAIL] Found % incident row(s) with deprecated status ''created''', v_count;
  END IF;
  RAISE NOTICE '[PASS] Zero incident rows with status ''created''';

  -- ----------------------------------------------------------------------------
  -- 2. ROW LEVEL SECURITY STATUS
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 2. Table Row Level Security Status ---';

  SELECT relrowsecurity INTO v_prosecdef
  FROM pg_class t
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public' AND t.relname = 'incidents';

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '[FAIL] RLS is NOT enabled on public.incidents';
  END IF;
  RAISE NOTICE '[PASS] RLS is enabled on public.incidents';

  SELECT relrowsecurity INTO v_prosecdef
  FROM pg_class t
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public' AND t.relname = 'operational_events';

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '[FAIL] RLS is NOT enabled on public.operational_events';
  END IF;
  RAISE NOTICE '[PASS] RLS is enabled on public.operational_events';

  -- ----------------------------------------------------------------------------
  -- 3. POLICY COMMAND CLOSURE (PREVENT DIRECT MUTATIONS VIA RLS)
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 3. Policy Command Closures on Mutation Tables ---';

  -- Verify SELECT policy exists on public.incidents
  SELECT count(*) INTO v_count
  FROM pg_policy pol
  JOIN pg_class t ON pol.polrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'incidents'
    AND pol.polcmd = 'r';

  IF v_count = 0 THEN
    RAISE EXCEPTION '[FAIL] No SELECT policy found on public.incidents';
  END IF;
  RAISE NOTICE '[PASS] SELECT policy exists on public.incidents';

  -- Verify NO direct INSERT (a), UPDATE (w), or ALL (*) policies on public.incidents
  SELECT count(*) INTO v_count
  FROM pg_policy pol
  JOIN pg_class t ON pol.polrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'incidents'
    AND pol.polcmd IN ('a', 'w', '*');

  IF v_count > 0 THEN
    RAISE EXCEPTION '[FAIL] Found % direct mutation policy/policies (INSERT/UPDATE/ALL) on public.incidents', v_count;
  END IF;
  RAISE NOTICE '[PASS] No direct INSERT, UPDATE, or ALL policies on public.incidents (all mutations strictly via RPC)';

  -- Verify SELECT policy exists on public.operational_events
  SELECT count(*) INTO v_count
  FROM pg_policy pol
  JOIN pg_class t ON pol.polrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'operational_events'
    AND pol.polcmd = 'r';

  IF v_count = 0 THEN
    RAISE EXCEPTION '[FAIL] No SELECT policy found on public.operational_events';
  END IF;
  RAISE NOTICE '[PASS] SELECT policy exists on public.operational_events';

  -- Verify NO direct INSERT (a) or ALL (*) policies on public.operational_events
  SELECT count(*) INTO v_count
  FROM pg_policy pol
  JOIN pg_class t ON pol.polrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'operational_events'
    AND pol.polcmd IN ('a', '*');

  IF v_count > 0 THEN
    RAISE EXCEPTION '[FAIL] Found % direct insertion/mutation policy/policies on public.operational_events', v_count;
  END IF;
  RAISE NOTICE '[PASS] No direct INSERT or ALL policies on public.operational_events (events written exclusively via RPC)';

  -- Verify specific named policies are absent
  SELECT count(*) INTO v_count
  FROM pg_policy pol
  JOIN pg_class t ON pol.polrelid = t.oid
  WHERE t.relname = 'incidents'
    AND pol.polname IN ('incidents_insert_operator_admin', 'incidents_update', 'incidents_update_operator_admin');

  IF v_count > 0 THEN
    RAISE EXCEPTION '[FAIL] Specific direct incident policies still exist';
  END IF;
  RAISE NOTICE '[PASS] Named direct incident mutation policies confirmed dropped';

  SELECT count(*) INTO v_count
  FROM pg_policy pol
  JOIN pg_class t ON pol.polrelid = t.oid
  WHERE t.relname = 'operational_events'
    AND pol.polname = 'events_insert';

  IF v_count > 0 THEN
    RAISE EXCEPTION '[FAIL] events_insert policy still exists on public.operational_events';
  END IF;
  RAISE NOTICE '[PASS] events_insert policy confirmed dropped';

  -- ----------------------------------------------------------------------------
  -- 4. CONCURRENCY-SAFE REFERENCE GENERATOR (INTERNAL HELPER)
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 4. Reference Number Generator (Internal Helper) ---';

  SELECT p.oid, p.prosecdef, p.proconfig, p.prosrc
  INTO v_fn_oid, v_prosecdef, v_proconfig, v_fn_src
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'generate_incident_reference_number'
    AND pg_get_function_identity_arguments(p.oid) = 'p_org_id uuid';

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION '[FAIL] public.generate_incident_reference_number(uuid) not found';
  END IF;

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '[FAIL] generate_incident_reference_number is not SECURITY DEFINER';
  END IF;

  -- Safe search path = public
  IF v_proconfig IS NULL OR NOT (v_proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION '[FAIL] generate_incident_reference_number does not set search_path = public';
  END IF;
  RAISE NOTICE '[PASS] generate_incident_reference_number is SECURITY DEFINER with search_path = public';

  -- Transaction-scoped advisory lock presence
  IF v_fn_src NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION '[FAIL] generate_incident_reference_number does not use pg_advisory_xact_lock';
  END IF;
  RAISE NOTICE '[PASS] generate_incident_reference_number uses pg_advisory_xact_lock';

  -- Generator privilege check: MUST NOT be executable by authenticated or anon
  SELECT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') INTO v_has_priv;
  IF v_has_priv IS TRUE THEN
    RAISE EXCEPTION '[FAIL] generate_incident_reference_number is executable by authenticated role';
  END IF;

  SELECT has_function_privilege('anon', v_fn_oid, 'EXECUTE') INTO v_has_priv;
  IF v_has_priv IS TRUE THEN
    RAISE EXCEPTION '[FAIL] generate_incident_reference_number is executable by anon role';
  END IF;
  RAISE NOTICE '[PASS] generate_incident_reference_number is strictly internal (no execute for authenticated or anon)';

  -- ----------------------------------------------------------------------------
  -- 5. STATE TRANSITION FUNCTION (transition_incident_status)
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 5. State Transition Function (transition_incident_status) ---';

  SELECT p.oid, p.prosecdef, p.proconfig, p.prosrc
  INTO v_fn_oid, v_prosecdef, v_proconfig, v_fn_src
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'transition_incident_status'
    AND pg_get_function_identity_arguments(p.oid) = 'p_incident_id uuid, p_new_status text, p_reason text';

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION '[FAIL] public.transition_incident_status(uuid, text, text) not found';
  END IF;

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '[FAIL] transition_incident_status is not SECURITY DEFINER';
  END IF;

  IF v_proconfig IS NULL OR NOT (v_proconfig @> ARRAY['search_path=public, extensions']) THEN
    RAISE EXCEPTION '[FAIL] transition_incident_status does not set search_path = public, extensions';
  END IF;
  RAISE NOTICE '[PASS] transition_incident_status is SECURITY DEFINER with search_path = public, extensions';

  -- Role condition check (must reject non-admin/operator)
  IF v_fn_src !~ 'v_caller_role\s+NOT\s+IN\s*\(\s*''admin''\s*,\s*''operator''\s*\)' THEN
    RAISE EXCEPTION '[FAIL] transition_incident_status does not enforce role NOT IN (''admin'', ''operator'')';
  END IF;
  RAISE NOTICE '[PASS] transition_incident_status enforces both admin AND operator role authorization';

  -- Concurrency FOR UPDATE row lock check
  IF v_fn_src NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION '[FAIL] transition_incident_status does not use FOR UPDATE row lock';
  END IF;
  RAISE NOTICE '[PASS] transition_incident_status uses FOR UPDATE row lock within tenant';

  -- Operational event append check
  IF v_fn_src NOT LIKE '%INCIDENT_STATUS_CHANGED%' THEN
    RAISE EXCEPTION '[FAIL] transition_incident_status does not write INCIDENT_STATUS_CHANGED event';
  END IF;
  RAISE NOTICE '[PASS] transition_incident_status atomically appends INCIDENT_STATUS_CHANGED event';

  -- Privileges
  SELECT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') INTO v_has_priv;
  IF v_has_priv IS NOT TRUE THEN
    RAISE EXCEPTION '[FAIL] authenticated does not have EXECUTE on transition_incident_status';
  END IF;

  SELECT has_function_privilege('anon', v_fn_oid, 'EXECUTE') INTO v_has_priv;
  IF v_has_priv IS TRUE THEN
    RAISE EXCEPTION '[FAIL] anon has EXECUTE on transition_incident_status';
  END IF;
  RAISE NOTICE '[PASS] transition_incident_status execute privileges correct (authenticated=true, anon=false)';

  -- ----------------------------------------------------------------------------
  -- 6. CONTROLLED INTAKE FUNCTION (create_incident)
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 6. Controlled Intake Function (create_incident) ---';

  SELECT p.oid, p.prosecdef, p.proconfig, p.prosrc
  INTO v_fn_oid, v_prosecdef, v_proconfig, v_fn_src
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname = 'create_incident'
    AND pg_get_function_identity_arguments(p.oid) = 'p_customer_name text, p_customer_phone text, p_location_address text, p_service_type text, p_priority text, p_notes text, p_required_capability_id uuid, p_latitude double precision, p_longitude double precision, p_location_accuracy double precision, p_location_source text, p_vehicle_registration text, p_vehicle_make text, p_vehicle_model text, p_vehicle_year integer, p_vehicle_color text';

  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION '[FAIL] Exact 16-parameter public.create_incident function not found';
  END IF;

  -- A. Catalog return type check via pg_get_function_result (MUST be jsonb, NOT uuid)
  SELECT pg_get_function_result(v_fn_oid) INTO v_fn_result;
  IF v_fn_result IS NULL OR v_fn_result <> 'jsonb' THEN
    RAISE EXCEPTION '[FAIL] create_incident return type is not jsonb (found: %)', v_fn_result;
  END IF;
  RAISE NOTICE '[PASS] create_incident return type is jsonb (not uuid)';

  IF v_prosecdef IS NOT TRUE THEN
    RAISE EXCEPTION '[FAIL] create_incident is not SECURITY DEFINER';
  END IF;

  IF v_proconfig IS NULL OR NOT (v_proconfig @> ARRAY['search_path=public, extensions']) THEN
    RAISE EXCEPTION '[FAIL] create_incident does not set search_path = public, extensions';
  END IF;
  RAISE NOTICE '[PASS] create_incident exact signature verified with SECURITY DEFINER and safe search_path';

  -- B. Service type contract check (locked Phase 2 set)
  SELECT array_agg(m[1] ORDER BY m[1])
  INTO v_extracted_services
  FROM (
    SELECT (regexp_matches(v_fn_src, 'v_service_type\s+NOT\s+IN\s*\(([^)]+)\)', 'i'))[1] AS val_str
  ) s,
  LATERAL regexp_matches(s.val_str, '''([a-z_]+)''', 'g') AS m;

  IF v_extracted_services IS NULL OR v_extracted_services <> ARRAY[
    'fuel_delivery',
    'general_assistance',
    'jump_start',
    'lockout',
    'tire_change',
    'towing',
    'winch_recovery'
  ] THEN
    RAISE EXCEPTION '[FAIL] create_incident service_type validation does not match exact locked Phase 2 set. Found: %', v_extracted_services;
  END IF;

  IF v_fn_src LIKE '%winching%' THEN
    RAISE EXCEPTION '[FAIL] create_incident source contains forbidden "winching" service type';
  END IF;

  IF v_fn_src ~ '''other''' THEN
    RAISE EXCEPTION '[FAIL] create_incident source contains forbidden "other" service type';
  END IF;
  RAISE NOTICE '[PASS] create_incident validates exact locked Phase 2 service types (7 types; winching/other forbidden)';

  -- C. Priority contract check (low, standard, high, critical)
  SELECT array_agg(m[1] ORDER BY m[1])
  INTO v_extracted_priorities
  FROM (
    SELECT (regexp_matches(v_fn_src, 'v_priority\s+NOT\s+IN\s*\(([^)]+)\)', 'i'))[1] AS val_str
  ) s,
  LATERAL regexp_matches(s.val_str, '''([a-z_]+)''', 'g') AS m;

  IF v_extracted_priorities IS NULL OR v_extracted_priorities <> ARRAY['critical', 'high', 'low', 'standard'] THEN
    RAISE EXCEPTION '[FAIL] create_incident priority validation does not match exact locked set. Found: %', v_extracted_priorities;
  END IF;
  RAISE NOTICE '[PASS] create_incident validates exact locked Phase 2 priorities (low, standard, high, critical)';

  -- D. Absent nonexistent enum casts
  IF v_fn_src LIKE '%::public.service_type%' OR v_fn_src ~ 'public\.service_type\b' THEN
    RAISE EXCEPTION '[FAIL] create_incident references nonexistent public.service_type enum';
  END IF;

  IF v_fn_src LIKE '%::public.incident_priority%' OR v_fn_src ~ 'public\.incident_priority\b' THEN
    RAISE EXCEPTION '[FAIL] create_incident references nonexistent public.incident_priority enum';
  END IF;
  RAISE NOTICE '[PASS] create_incident uses direct TEXT columns with no nonexistent enum casts';

  -- E. JSON Result implementation & Operational Event ID Capture
  IF v_fn_src NOT LIKE '%jsonb_build_object%' THEN
    RAISE EXCEPTION '[FAIL] create_incident does not use jsonb_build_object for return payload';
  END IF;

  IF v_fn_src NOT LIKE '%''success''%'
     OR v_fn_src NOT LIKE '%''incident_id''%'
     OR v_fn_src NOT LIKE '%''reference_number''%'
     OR v_fn_src NOT LIKE '%''status''%'
     OR v_fn_src NOT LIKE '%''event_id''%'
     OR v_fn_src NOT LIKE '%''created_at''%' THEN
    RAISE EXCEPTION '[FAIL] create_incident return jsonb payload missing required keys';
  END IF;

  IF v_fn_src !~ 'INSERT\s+INTO\s+public\.operational_events[\s\S]+?RETURNING\s+id\s+INTO\s+v_event_id' THEN
    RAISE EXCEPTION '[FAIL] create_incident does not capture operational event id into v_event_id';
  END IF;

  IF v_fn_src NOT LIKE '%INCIDENT_CREATED%' THEN
    RAISE EXCEPTION '[FAIL] create_incident does not insert INCIDENT_CREATED operational event';
  END IF;
  RAISE NOTICE '[PASS] create_incident constructs JSONB return payload and captures operational event ID';

  -- Role condition check
  IF v_fn_src !~ 'v_caller_role\s+NOT\s+IN\s*\(\s*''admin''\s*,\s*''operator''\s*\)' THEN
    RAISE EXCEPTION '[FAIL] create_incident does not enforce role NOT IN (''admin'', ''operator'')';
  END IF;
  RAISE NOTICE '[PASS] create_incident enforces both admin AND operator role authorization';

  -- Accuracy validation check
  IF v_fn_src NOT LIKE '%Location accuracy cannot be specified without coordinates%' OR v_fn_src NOT LIKE '%p_location_accuracy < 0%' THEN
    RAISE EXCEPTION '[FAIL] create_incident does not validate location accuracy constraints';
  END IF;
  RAISE NOTICE '[PASS] create_incident validates location accuracy';

  -- Vehicle year check
  IF v_fn_src NOT LIKE '%1900%' OR v_fn_src NOT LIKE '%2100%' THEN
    RAISE EXCEPTION '[FAIL] create_incident does not validate vehicle year 1900-2100';
  END IF;
  RAISE NOTICE '[PASS] create_incident validates vehicle year range 1900-2100';

  -- Operator manual intake provenance check
  IF v_fn_src NOT LIKE '%operator_manual%' THEN
    RAISE EXCEPTION '[FAIL] create_incident does not enforce operator_manual contract';
  END IF;
  RAISE NOTICE '[PASS] create_incident enforces operator_manual contract';

  -- Privileges
  SELECT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') INTO v_has_priv;
  IF v_has_priv IS NOT TRUE THEN
    RAISE EXCEPTION '[FAIL] authenticated does not have EXECUTE on create_incident';
  END IF;

  SELECT has_function_privilege('anon', v_fn_oid, 'EXECUTE') INTO v_has_priv;
  IF v_has_priv IS TRUE THEN
    RAISE EXCEPTION '[FAIL] anon has EXECUTE on create_incident';
  END IF;
  RAISE NOTICE '[PASS] create_incident execute privileges correct (authenticated=true, anon=false)';

  -- ----------------------------------------------------------------------------
  -- 7. AUDIT IMMUTABILITY TRIGGER & STATUS GUARD TRIGGER
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 7. Triggers: Immutability & Status Protection ---';

  SELECT count(*) INTO v_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = 'operational_events'
    AND t.tgname = 'trg_immutable_operational_events';

  IF v_count = 0 THEN
    RAISE EXCEPTION '[FAIL] Immutable trigger not found on public.operational_events';
  END IF;
  RAISE NOTICE '[PASS] trg_immutable_operational_events trigger exists';

  SELECT count(*) INTO v_count
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = 'incidents'
    AND t.tgname = 'trg_protect_incident_status';

  IF v_count = 0 THEN
    RAISE EXCEPTION '[FAIL] trg_protect_incident_status trigger not found on public.incidents';
  END IF;
  RAISE NOTICE '[PASS] trg_protect_incident_status trigger exists';

  -- ----------------------------------------------------------------------------
  -- 8. PERFORMANCE COMPOSITE INDEXES
  -- ----------------------------------------------------------------------------
  RAISE NOTICE '--- 8. Indexes ---';

  SELECT count(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'incidents'
    AND indexname = 'idx_incidents_org_created';
  IF v_count = 0 THEN
    RAISE EXCEPTION '[FAIL] Index idx_incidents_org_created not found';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'incidents'
    AND indexname = 'idx_incidents_org_status_created';
  IF v_count = 0 THEN
    RAISE EXCEPTION '[FAIL] Index idx_incidents_org_status_created not found';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'operational_events'
    AND indexname = 'idx_operational_events_incident_history';
  IF v_count = 0 THEN
    RAISE EXCEPTION '[FAIL] Index idx_operational_events_incident_history not found';
  END IF;
  RAISE NOTICE '[PASS] Phase 4 operational indexes verified';

  RAISE NOTICE '================================================================';
  RAISE NOTICE '  SUCCESS: ALL PHASE 4 STRUCTURAL DATABASE CHECKS PASSED        ';
  RAISE NOTICE '================================================================';
END;
$$;
