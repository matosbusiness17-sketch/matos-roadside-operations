-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- PHASE 6 MIGRATION: CAPABILITY-AWARE MATCHING & DISPATCH ENGINE
-- ==============================================================================
--
-- Description:
-- Establishes the authoritative database engine for capability-aware matching,
-- proximity ordering, and controlled operator dispatch & reassignment.
--
-- Core architectural guarantees:
-- 1. Preflight data-integrity checks preventing partial unique index failures.
-- 2. Concurrency protection via partial unique indexes:
--    - Unique active shift binding per worker and per vehicle (worker_vehicle_assignments)
--    - Unique active assignment per incident, worker, and vehicle (assignments)
-- 3. Direct mutation policy closure on public.assignments (drop generic INSERT/UPDATE
--    policies, revoke direct mutation grants, retain SELECT visibility).
-- 4. Authoritative read-only RPC: public.get_dispatch_candidates(UUID)
--    - Session-derived tenant and role (admin/operator only; workers rejected)
--    - Strict worker-vehicle pair eligibility (active shift binding, available worker,
--      active profile, active vehicle, active capability match, no active conflicts)
--    - PostGIS ST_Distance proximity ordering inside the final jsonb_agg aggregate
--    - Missing-location tolerance without coordinate fabrication
-- 5. Authoritative atomic RPC: public.dispatch_incident(UUID, UUID, UUID)
--    - Row-level locking (FOR UPDATE)
--    - Eligibility and conflict re-validation at transaction time
--    - Reuses Phase 4 transition_incident_status (ready_for_dispatch -> dispatched)
--    - Atomic assignment creation + ASSIGNMENT_CREATED operational audit event
-- 6. Authoritative atomic RPC: public.reassign_incident(UUID, UUID, UUID, UUID)
--    - Row-level locking (FOR UPDATE)
--    - Validates dispatched incident & assigned current assignment
--    - Cancels current assignment (status = 'cancelled', no completed_at fabrication)
--    - Creates replacement assignment (status = 'assigned')
--    - Retains dispatched status + INCIDENT_REASSIGNED operational audit event
--
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. PRE-MIGRATION DATA INTEGRITY PREFLIGHT CHECKS
-- Fail closed if duplicate active records exist in legacy data.
-- Do NOT silently delete, cancel, or repair inconsistent active data.
-- ------------------------------------------------------------------------------

DO $$
DECLARE
  v_dup_wva_workers INT;
  v_dup_wva_vehicles INT;
  v_dup_assign_incidents INT;
  v_dup_assign_workers INT;
  v_dup_assign_vehicles INT;
BEGIN
  -- Check worker_vehicle_assignments: multiple active bindings for same worker
  SELECT count(*) INTO v_dup_wva_workers
  FROM (
    SELECT organization_id, worker_id
    FROM public.worker_vehicle_assignments
    WHERE status = 'active'
    GROUP BY organization_id, worker_id
    HAVING count(*) > 1
  ) t;

  IF v_dup_wva_workers > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed: % worker(s) have multiple active vehicle bindings', v_dup_wva_workers;
  END IF;

  -- Check worker_vehicle_assignments: multiple active bindings for same vehicle
  SELECT count(*) INTO v_dup_wva_vehicles
  FROM (
    SELECT organization_id, vehicle_id
    FROM public.worker_vehicle_assignments
    WHERE status = 'active'
    GROUP BY organization_id, vehicle_id
    HAVING count(*) > 1
  ) t;

  IF v_dup_wva_vehicles > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed: % vehicle(s) have multiple active worker bindings', v_dup_wva_vehicles;
  END IF;

  -- Check assignments: multiple active assignments for same incident
  SELECT count(*) INTO v_dup_assign_incidents
  FROM (
    SELECT organization_id, incident_id
    FROM public.assignments
    WHERE status IN ('assigned', 'accepted', 'en_route', 'on_scene')
    GROUP BY organization_id, incident_id
    HAVING count(*) > 1
  ) t;

  IF v_dup_assign_incidents > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed: % incident(s) have multiple active assignments', v_dup_assign_incidents;
  END IF;

  -- Check assignments: multiple active assignments for same worker
  SELECT count(*) INTO v_dup_assign_workers
  FROM (
    SELECT organization_id, worker_id
    FROM public.assignments
    WHERE status IN ('assigned', 'accepted', 'en_route', 'on_scene')
    GROUP BY organization_id, worker_id
    HAVING count(*) > 1
  ) t;

  IF v_dup_assign_workers > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed: % worker(s) have multiple active assignments', v_dup_assign_workers;
  END IF;

  -- Check assignments: multiple active assignments for same vehicle
  SELECT count(*) INTO v_dup_assign_vehicles
  FROM (
    SELECT organization_id, vehicle_id
    FROM public.assignments
    WHERE vehicle_id IS NOT NULL
      AND status IN ('assigned', 'accepted', 'en_route', 'on_scene')
    GROUP BY organization_id, vehicle_id
    HAVING count(*) > 1
  ) t;

  IF v_dup_assign_vehicles > 0 THEN
    RAISE EXCEPTION 'Pre-migration check failed: % vehicle(s) have multiple active assignments', v_dup_assign_vehicles;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. PARTIAL UNIQUE INDEXES FOR ACTIVE RECORD CONCURRENCY PROTECTION
-- ------------------------------------------------------------------------------

-- Worker Vehicle Assignments: at most one active vehicle per worker and vice-versa
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_wva_active_worker
  ON public.worker_vehicle_assignments(organization_id, worker_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_wva_active_vehicle
  ON public.worker_vehicle_assignments(organization_id, vehicle_id)
  WHERE status = 'active';

-- Assignments: at most one active assignment per incident, worker, and vehicle
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_assignments_active_incident
  ON public.assignments(organization_id, incident_id)
  WHERE status IN ('assigned', 'accepted', 'en_route', 'on_scene');

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_assignments_active_worker
  ON public.assignments(organization_id, worker_id)
  WHERE status IN ('assigned', 'accepted', 'en_route', 'on_scene');

CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_assignments_active_vehicle
  ON public.assignments(organization_id, vehicle_id)
  WHERE vehicle_id IS NOT NULL
    AND status IN ('assigned', 'accepted', 'en_route', 'on_scene');

-- ------------------------------------------------------------------------------
-- 3. ASSIGNMENT DIRECT MUTATION CLOSURE
-- Drop generic direct INSERT/UPDATE policies from Phase 2; enforce mutations
-- exclusively through privileged SECURITY DEFINER RPCs.
-- ------------------------------------------------------------------------------

DROP POLICY IF EXISTS "assignments_insert_operator_admin" ON public.assignments;
DROP POLICY IF EXISTS "assignments_update" ON public.assignments;

-- Revoke direct mutation statements from authenticated and anon clients
REVOKE INSERT, UPDATE, DELETE ON public.assignments FROM authenticated, anon;
GRANT SELECT ON public.assignments TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. GET_DISPATCH_CANDIDATES RPC
-- Evaluates candidate worker-vehicle pairs for a specific incident.
-- Read-only query; strictly decision support.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_dispatch_candidates(
  p_incident_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_uid UUID;
  v_caller_org UUID;
  v_caller_role public.app_role;

  v_inc RECORD;
  v_cap RECORD;
  v_active_assignments_count INT := 0;
  v_current_assignment_status TEXT := NULL;
  v_dispatch_state TEXT;
  v_current_assignment JSONB := NULL;
  v_current_assignment_id UUID := NULL;
  v_exclude_worker_id UUID := NULL;
  v_exclude_vehicle_id UUID := NULL;
  v_ranking_available BOOLEAN := false;

  v_ranked_json JSONB;
  v_unranked_json JSONB;
  v_result JSONB;
BEGIN
  -- 1. Session & Role Validation
  v_caller_uid := auth.uid();
  v_caller_org := public.get_current_user_organization_id();
  v_caller_role := public.get_current_user_role();

  IF v_caller_uid IS NULL OR v_caller_org IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Authentication required to retrieve dispatch candidates';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Unauthorized: only admins and operators can access dispatch candidates';
  END IF;

  IF p_incident_id IS NULL THEN
    RAISE EXCEPTION 'Incident ID is required';
  END IF;

  -- 2. Fetch Incident Context
  SELECT
    i.id,
    i.reference_number,
    i.status,
    i.required_capability_id,
    i.location
  INTO v_inc
  FROM public.incidents i
  WHERE i.id = p_incident_id
    AND i.organization_id = v_caller_org;

  IF v_inc.id IS NULL THEN
    RAISE EXCEPTION 'Incident not found or unauthorized';
  END IF;

  -- Capability summary details
  IF v_inc.required_capability_id IS NOT NULL THEN
    SELECT sc.id, sc.code, sc.name
    INTO v_cap
    FROM public.service_capabilities sc
    WHERE sc.id = v_inc.required_capability_id;
  END IF;

  -- 3. Evaluate Incident Dispatch State & Current Active Assignments
  SELECT count(*)
  INTO v_active_assignments_count
  FROM public.assignments a
  WHERE a.incident_id = p_incident_id
    AND a.organization_id = v_caller_org
    AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene');

  IF v_inc.status = 'ready_for_dispatch' THEN
    -- Invariant: For initial dispatch, target incident must have NO active assignments
    IF v_active_assignments_count > 0 THEN
      -- Target incident already has an active assignment; candidate generation must not proceed
      v_dispatch_state := 'unavailable';
      v_current_assignment := NULL;
    ELSE
      v_dispatch_state := 'initial_dispatch';
      v_current_assignment := NULL;
    END IF;
  ELSIF v_inc.status = 'dispatched' THEN
    -- Invariant: Dispatched incidents must have EXACTLY ONE active assignment
    -- If count is 0 (missing assignment) or > 1 (corrupt active state), fail closed to unavailable.
    -- DO NOT silently resolve multiple active records using ORDER BY ... LIMIT 1!
    IF v_active_assignments_count <> 1 THEN
      v_dispatch_state := 'unavailable';
      v_current_assignment := NULL;
    ELSE
      SELECT
        a.id,
        a.status,
        a.worker_id,
        a.vehicle_id,
        jsonb_build_object(
          'id', a.id,
          'status', a.status,
          'worker_id', a.worker_id,
          'worker_name', p.display_name,
          'vehicle_id', a.vehicle_id,
          'callsign', v.callsign,
          'registration_number', v.registration_number,
          'assigned_at', a.assigned_at
        )
      INTO
        v_current_assignment_id,
        v_current_assignment_status,
        v_exclude_worker_id,
        v_exclude_vehicle_id,
        v_current_assignment
      FROM public.assignments a
      JOIN public.worker_profiles wp ON a.worker_id = wp.id
      JOIN public.profiles p ON wp.user_id = p.id
      LEFT JOIN public.vehicles v ON a.vehicle_id = v.id
      WHERE a.incident_id = p_incident_id
        AND a.organization_id = v_caller_org
        AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene');

      IF v_current_assignment_status = 'assigned' THEN
        v_dispatch_state := 'reassignment';
      ELSIF v_current_assignment_status IN ('accepted', 'en_route', 'on_scene') THEN
        v_dispatch_state := 'assigned_locked';
      ELSE
        v_dispatch_state := 'unavailable';
      END IF;
    END IF;
  ELSE
    v_dispatch_state := 'unavailable';
    v_current_assignment := NULL;
  END IF;

  v_ranking_available := (v_inc.location IS NOT NULL);

  -- 4. If assigned_locked or unavailable, return empty candidate lists immediately
  IF v_dispatch_state NOT IN ('initial_dispatch', 'reassignment') THEN
    RETURN jsonb_build_object(
      'generated_at', now(),
      'dispatch_state', v_dispatch_state,
      'incident', jsonb_build_object(
        'id', v_inc.id,
        'reference_number', v_inc.reference_number,
        'status', v_inc.status,
        'required_capability', CASE
          WHEN v_inc.required_capability_id IS NOT NULL AND v_cap.id IS NOT NULL THEN
            jsonb_build_object(
              'id', v_cap.id,
              'code', v_cap.code,
              'name', v_cap.name
            )
          ELSE NULL
        END,
        'has_location', (v_inc.location IS NOT NULL)
      ),
      'current_assignment', v_current_assignment,
      'ranking_available', v_ranking_available,
      'ranked_candidates', '[]'::jsonb,
      'unranked_candidates', '[]'::jsonb
    );
  END IF;

  -- 5. Determine Eligible Candidate Pairs & Calculate Distance
  WITH eligible_pairs AS (
    SELECT
      wp.id AS worker_id,
      p.display_name AS worker_name,
      v.id AS vehicle_id,
      v.callsign,
      v.registration_number,
      v.last_known_location AS vehicle_location,
      v.location_updated_at AS vehicle_location_updated_at,
      CASE
        WHEN v_inc.location IS NOT NULL AND v.last_known_location IS NOT NULL THEN
          ST_Distance(v_inc.location, v.last_known_location)
        ELSE NULL
      END AS distance_meters,
      true AS required_capability_matched
    FROM public.worker_vehicle_assignments wva
    JOIN public.worker_profiles wp
      ON wva.worker_id = wp.id
      AND wp.organization_id = v_caller_org
    JOIN public.profiles p
      ON wp.user_id = p.id
      AND p.organization_id = v_caller_org
    JOIN public.vehicles v
      ON wva.vehicle_id = v.id
      AND v.organization_id = v_caller_org
    WHERE wva.organization_id = v_caller_org
      AND wva.status = 'active'
      AND wp.availability_status = 'available'
      AND p.is_active = true
      AND v.is_active = true
      -- Required capability match rule
      AND (
        v_inc.required_capability_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.vehicle_capabilities vc
          JOIN public.service_capabilities sc
            ON vc.capability_id = sc.id
          WHERE vc.vehicle_id = v.id
            AND vc.organization_id = v_caller_org
            AND vc.capability_id = v_inc.required_capability_id
            AND sc.is_active = true
        )
      )
      -- Incident active dispatch conflict rule (ignore current assignment during reassignment)
      AND NOT EXISTS (
        SELECT 1
        FROM public.assignments a
        WHERE a.organization_id = v_caller_org
          AND a.incident_id = p_incident_id
          AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene')
          AND (v_dispatch_state != 'reassignment' OR a.id != v_current_assignment_id)
      )
      -- Worker active dispatch conflict rule (ignore current assignment during reassignment)
      AND NOT EXISTS (
        SELECT 1
        FROM public.assignments a
        WHERE a.organization_id = v_caller_org
          AND a.worker_id = wp.id
          AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene')
          AND (v_dispatch_state != 'reassignment' OR a.id != v_current_assignment_id)
      )
      -- Vehicle active dispatch conflict rule (ignore current assignment during reassignment)
      AND NOT EXISTS (
        SELECT 1
        FROM public.assignments a
        WHERE a.organization_id = v_caller_org
          AND a.vehicle_id = v.id
          AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene')
          AND (v_dispatch_state != 'reassignment' OR a.id != v_current_assignment_id)
      )
      -- Reassignment exclusion: do not offer the identical active pair as a replacement
      AND NOT (
        v_dispatch_state = 'reassignment'
        AND wp.id = v_exclude_worker_id
        AND v.id = v_exclude_vehicle_id
      )
  ),
  ranked AS (
    SELECT
      worker_id,
      worker_name,
      vehicle_id,
      callsign,
      registration_number,
      distance_meters,
      vehicle_location_updated_at,
      required_capability_matched
    FROM eligible_pairs
    WHERE distance_meters IS NOT NULL
  ),
  unranked AS (
    SELECT
      worker_id,
      worker_name,
      vehicle_id,
      callsign,
      registration_number,
      NULL::double precision AS distance_meters,
      vehicle_location_updated_at,
      required_capability_matched,
      CASE
        WHEN v_inc.location IS NULL THEN 'incident_location_unavailable'
        ELSE 'vehicle_location_unavailable'
      END AS ranking_reason
    FROM eligible_pairs
    WHERE distance_meters IS NULL
  )
  SELECT
    -- Ranked candidates aggregate with deterministic ordering INSIDE jsonb_agg
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'worker_id', r.worker_id,
            'worker_name', r.worker_name,
            'vehicle_id', r.vehicle_id,
            'callsign', r.callsign,
            'registration_number', r.registration_number,
            'distance_meters', r.distance_meters,
            'vehicle_location_updated_at', r.vehicle_location_updated_at,
            'required_capability_matched', r.required_capability_matched
          )
          ORDER BY r.distance_meters ASC, r.callsign ASC, r.worker_id ASC
        )
        FROM ranked r
      ),
      '[]'::jsonb
    ),
    -- Unranked candidates aggregate with deterministic ordering INSIDE jsonb_agg
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'worker_id', u.worker_id,
            'worker_name', u.worker_name,
            'vehicle_id', u.vehicle_id,
            'callsign', u.callsign,
            'registration_number', u.registration_number,
            'distance_meters', NULL,
            'vehicle_location_updated_at', u.vehicle_location_updated_at,
            'required_capability_matched', u.required_capability_matched,
            'ranking_reason', u.ranking_reason
          )
          ORDER BY u.callsign ASC, u.worker_id ASC
        )
        FROM unranked u
      ),
      '[]'::jsonb
    )
  INTO v_ranked_json, v_unranked_json;

  -- 6. Build Final Authoritative Response
  v_result := jsonb_build_object(
    'generated_at', now(),
    'dispatch_state', v_dispatch_state,
    'incident', jsonb_build_object(
      'id', v_inc.id,
      'reference_number', v_inc.reference_number,
      'status', v_inc.status,
      'required_capability', CASE
        WHEN v_inc.required_capability_id IS NOT NULL AND v_cap.id IS NOT NULL THEN
          jsonb_build_object(
            'id', v_cap.id,
            'code', v_cap.code,
            'name', v_cap.name
          )
        ELSE NULL
      END,
      'has_location', (v_inc.location IS NOT NULL)
    ),
    'current_assignment', v_current_assignment,
    'ranking_available', v_ranking_available,
    'ranked_candidates', v_ranked_json,
    'unranked_candidates', v_unranked_json
  );

  RETURN v_result;
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. DISPATCH_INCIDENT RPC
-- Authoritatively executes initial dispatch for an incident in ready_for_dispatch.
-- Atomic database transaction.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dispatch_incident(
  p_incident_id UUID,
  p_worker_id UUID,
  p_vehicle_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_uid UUID;
  v_caller_org UUID;
  v_caller_role public.app_role;

  v_inc RECORD;
  v_worker RECORD;
  v_veh RECORD;
  v_wva RECORD;
  v_assignment_id UUID;
  v_assigned_at TIMESTAMPTZ;
BEGIN
  -- 1. Session & Role Validation
  v_caller_uid := auth.uid();
  v_caller_org := public.get_current_user_organization_id();
  v_caller_role := public.get_current_user_role();

  IF v_caller_uid IS NULL OR v_caller_org IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Authentication required to dispatch incident';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Unauthorized: only admins and operators can dispatch incidents';
  END IF;

  IF p_incident_id IS NULL OR p_worker_id IS NULL OR p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Incident ID, Worker ID, and Vehicle ID are required';
  END IF;

  -- 2. Lock and Validate Target Incident
  SELECT
    i.id,
    i.reference_number,
    i.status,
    i.required_capability_id
  INTO v_inc
  FROM public.incidents i
  WHERE i.id = p_incident_id
    AND i.organization_id = v_caller_org
  FOR UPDATE;

  IF v_inc.id IS NULL THEN
    RAISE EXCEPTION 'Incident not found or unauthorized';
  END IF;

  IF v_inc.status <> 'ready_for_dispatch' THEN
    RAISE EXCEPTION 'Incident is not ready for dispatch (current status: %)', v_inc.status;
  END IF;

  -- 3. Lock and Validate Worker
  SELECT
    wp.id,
    wp.availability_status,
    p.is_active,
    p.display_name
  INTO v_worker
  FROM public.worker_profiles wp
  JOIN public.profiles p ON wp.user_id = p.id
  WHERE wp.id = p_worker_id
    AND wp.organization_id = v_caller_org
  FOR UPDATE OF wp;

  IF v_worker.id IS NULL THEN
    RAISE EXCEPTION 'Worker not found or unauthorized';
  END IF;

  IF NOT v_worker.is_active THEN
    RAISE EXCEPTION 'Worker profile is deactivated';
  END IF;

  IF v_worker.availability_status <> 'available' THEN
    RAISE EXCEPTION 'Worker is not available (current status: %)', v_worker.availability_status;
  END IF;

  -- 4. Lock and Validate Vehicle
  SELECT
    v.id,
    v.callsign,
    v.is_active
  INTO v_veh
  FROM public.vehicles v
  WHERE v.id = p_vehicle_id
    AND v.organization_id = v_caller_org
  FOR UPDATE;

  IF v_veh.id IS NULL THEN
    RAISE EXCEPTION 'Vehicle not found or unauthorized';
  END IF;

  IF NOT v_veh.is_active THEN
    RAISE EXCEPTION 'Vehicle is not active';
  END IF;

  -- 5. Lock and Validate Active Worker-Vehicle Shift Assignment
  SELECT
    wva.id
  INTO v_wva
  FROM public.worker_vehicle_assignments wva
  WHERE wva.worker_id = p_worker_id
    AND wva.vehicle_id = p_vehicle_id
    AND wva.organization_id = v_caller_org
    AND wva.status = 'active'
  FOR UPDATE;

  IF v_wva.id IS NULL THEN
    RAISE EXCEPTION 'No active shift assignment exists for this worker and vehicle';
  END IF;

  -- 6. Capability Validation
  IF v_inc.required_capability_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.vehicle_capabilities vc
      JOIN public.service_capabilities sc ON vc.capability_id = sc.id
      WHERE vc.vehicle_id = p_vehicle_id
        AND vc.organization_id = v_caller_org
        AND vc.capability_id = v_inc.required_capability_id
        AND sc.is_active = true
    ) THEN
      RAISE EXCEPTION 'Selected vehicle does not possess the required capability for this incident';
    END IF;
  END IF;

  -- 7. Re-check Active Assignment Conflicts at Transaction Time
  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.organization_id = v_caller_org
      AND a.incident_id = p_incident_id
      AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene')
  ) THEN
    RAISE EXCEPTION 'Incident already has an active assignment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.organization_id = v_caller_org
      AND a.worker_id = p_worker_id
      AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene')
  ) THEN
    RAISE EXCEPTION 'Worker already has an active assignment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.organization_id = v_caller_org
      AND a.vehicle_id = p_vehicle_id
      AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene')
  ) THEN
    RAISE EXCEPTION 'Vehicle already has an active assignment';
  END IF;

  -- 8. Create Assignment Record
  INSERT INTO public.assignments (
    organization_id,
    incident_id,
    worker_id,
    vehicle_id,
    status,
    assigned_at
  )
  VALUES (
    v_caller_org,
    p_incident_id,
    p_worker_id,
    p_vehicle_id,
    'assigned',
    now()
  )
  RETURNING id, assigned_at INTO v_assignment_id, v_assigned_at;

  -- 9. Authoritative Incident Transition (ready_for_dispatch -> dispatched)
  -- Reuses Phase 4 transition_incident_status state machine
  PERFORM public.transition_incident_status(
    p_incident_id,
    'dispatched',
    'Incident dispatched to unit ' || v_veh.callsign
  );

  -- 10. Record Immutable Operational Audit Event
  INSERT INTO public.operational_events (
    organization_id,
    event_type,
    entity_type,
    entity_id,
    actor_id,
    metadata
  )
  VALUES (
    v_caller_org,
    'ASSIGNMENT_CREATED',
    'assignment',
    v_assignment_id,
    v_caller_uid,
    jsonb_build_object(
      'incident_id', p_incident_id,
      'reference_number', v_inc.reference_number,
      'worker_id', p_worker_id,
      'vehicle_id', p_vehicle_id,
      'callsign', v_veh.callsign
    )
  );

  -- 11. Return Authoritative Response Payload
  RETURN jsonb_build_object(
    'success', true,
    'assignment_id', v_assignment_id,
    'incident_id', p_incident_id,
    'reference_number', v_inc.reference_number,
    'incident_status', 'dispatched',
    'worker_id', p_worker_id,
    'vehicle_id', p_vehicle_id,
    'assigned_at', v_assigned_at
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. REASSIGN_INCIDENT RPC
-- Reassigns a dispatched incident whose current assignment is still 'assigned'.
-- Cancels the old assignment, creates the new assignment, and records the audit event.
-- Incident remains 'dispatched'.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reassign_incident(
  p_incident_id UUID,
  p_current_assignment_id UUID,
  p_new_worker_id UUID,
  p_new_vehicle_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_uid UUID;
  v_caller_org UUID;
  v_caller_role public.app_role;

  v_inc RECORD;
  v_curr RECORD;
  v_new_worker RECORD;
  v_new_veh RECORD;
  v_new_wva RECORD;
  v_new_assignment_id UUID;
  v_new_assigned_at TIMESTAMPTZ;
BEGIN
  -- 1. Session & Role Validation
  v_caller_uid := auth.uid();
  v_caller_org := public.get_current_user_organization_id();
  v_caller_role := public.get_current_user_role();

  IF v_caller_uid IS NULL OR v_caller_org IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Authentication required to reassign incident';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Unauthorized: only admins and operators can reassign incidents';
  END IF;

  IF p_incident_id IS NULL OR p_current_assignment_id IS NULL
     OR p_new_worker_id IS NULL OR p_new_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Incident ID, Current Assignment ID, New Worker ID, and New Vehicle ID are required';
  END IF;

  -- 2. Lock and Validate Incident
  SELECT
    i.id,
    i.reference_number,
    i.status,
    i.required_capability_id
  INTO v_inc
  FROM public.incidents i
  WHERE i.id = p_incident_id
    AND i.organization_id = v_caller_org
  FOR UPDATE;

  IF v_inc.id IS NULL THEN
    RAISE EXCEPTION 'Incident not found or unauthorized';
  END IF;

  IF v_inc.status <> 'dispatched' THEN
    RAISE EXCEPTION 'Incident must be in dispatched status for reassignment (current status: %)', v_inc.status;
  END IF;

  -- 3. Lock and Validate Current Assignment
  SELECT
    a.id,
    a.status,
    a.worker_id,
    a.vehicle_id
  INTO v_curr
  FROM public.assignments a
  WHERE a.id = p_current_assignment_id
    AND a.incident_id = p_incident_id
    AND a.organization_id = v_caller_org
  FOR UPDATE;

  IF v_curr.id IS NULL THEN
    RAISE EXCEPTION 'Current assignment not found or unauthorized for this incident';
  END IF;

  IF v_curr.status <> 'assigned' THEN
    RAISE EXCEPTION 'Current assignment cannot be reassigned; status is already % (only assigned can be reassigned)', v_curr.status;
  END IF;

  -- 4. Prevent Reassignment to Identical Pair
  IF v_curr.worker_id = p_new_worker_id AND v_curr.vehicle_id = p_new_vehicle_id THEN
    RAISE EXCEPTION 'Replacement worker and vehicle pair cannot be identical to current assignment';
  END IF;

  -- 5. Lock and Validate Replacement Worker
  SELECT
    wp.id,
    wp.availability_status,
    p.is_active,
    p.display_name
  INTO v_new_worker
  FROM public.worker_profiles wp
  JOIN public.profiles p ON wp.user_id = p.id
  WHERE wp.id = p_new_worker_id
    AND wp.organization_id = v_caller_org
  FOR UPDATE OF wp;

  IF v_new_worker.id IS NULL THEN
    RAISE EXCEPTION 'Replacement worker not found or unauthorized';
  END IF;

  IF NOT v_new_worker.is_active THEN
    RAISE EXCEPTION 'Replacement worker profile is deactivated';
  END IF;

  IF v_new_worker.availability_status <> 'available' THEN
    RAISE EXCEPTION 'Replacement worker is not available (current status: %)', v_new_worker.availability_status;
  END IF;

  -- 6. Lock and Validate Replacement Vehicle
  SELECT
    v.id,
    v.callsign,
    v.is_active
  INTO v_new_veh
  FROM public.vehicles v
  WHERE v.id = p_new_vehicle_id
    AND v.organization_id = v_caller_org
  FOR UPDATE;

  IF v_new_veh.id IS NULL THEN
    RAISE EXCEPTION 'Replacement vehicle not found or unauthorized';
  END IF;

  IF NOT v_new_veh.is_active THEN
    RAISE EXCEPTION 'Replacement vehicle is not active';
  END IF;

  -- 7. Lock and Validate Active Worker-Vehicle Shift Assignment
  SELECT
    wva.id
  INTO v_new_wva
  FROM public.worker_vehicle_assignments wva
  WHERE wva.worker_id = p_new_worker_id
    AND wva.vehicle_id = p_new_vehicle_id
    AND wva.organization_id = v_caller_org
    AND wva.status = 'active'
  FOR UPDATE;

  IF v_new_wva.id IS NULL THEN
    RAISE EXCEPTION 'No active shift assignment exists for replacement worker and vehicle';
  END IF;

  -- 8. Capability Validation
  IF v_inc.required_capability_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.vehicle_capabilities vc
      JOIN public.service_capabilities sc ON vc.capability_id = sc.id
      WHERE vc.vehicle_id = p_new_vehicle_id
        AND vc.organization_id = v_caller_org
        AND vc.capability_id = v_inc.required_capability_id
        AND sc.is_active = true
    ) THEN
      RAISE EXCEPTION 'Replacement vehicle does not possess the required capability for this incident';
    END IF;
  END IF;

  -- 9. Re-check Active Assignment Conflicts (ignoring current assignment ID)
  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.organization_id = v_caller_org
      AND a.incident_id = p_incident_id
      AND a.id <> p_current_assignment_id
      AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene')
  ) THEN
    RAISE EXCEPTION 'Incident already has another active assignment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.organization_id = v_caller_org
      AND a.worker_id = p_new_worker_id
      AND a.id <> p_current_assignment_id
      AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene')
  ) THEN
    RAISE EXCEPTION 'Replacement worker already has an active assignment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.organization_id = v_caller_org
      AND a.vehicle_id = p_new_vehicle_id
      AND a.id <> p_current_assignment_id
      AND a.status IN ('assigned', 'accepted', 'en_route', 'on_scene')
  ) THEN
    RAISE EXCEPTION 'Replacement vehicle already has an active assignment';
  END IF;

  -- 10. Cancel Current Assignment
  -- Do not invent a completed_at timestamp on cancellation
  UPDATE public.assignments
  SET status = 'cancelled'
  WHERE id = p_current_assignment_id;

  -- 11. Create Replacement Assignment
  INSERT INTO public.assignments (
    organization_id,
    incident_id,
    worker_id,
    vehicle_id,
    status,
    assigned_at
  )
  VALUES (
    v_caller_org,
    p_incident_id,
    p_new_worker_id,
    p_new_vehicle_id,
    'assigned',
    now()
  )
  RETURNING id, assigned_at INTO v_new_assignment_id, v_new_assigned_at;

  -- Incident remains in 'dispatched' status (no transition)

  -- 12. Write Immutable Operational Event
  INSERT INTO public.operational_events (
    organization_id,
    event_type,
    entity_type,
    entity_id,
    actor_id,
    metadata
  )
  VALUES (
    v_caller_org,
    'INCIDENT_REASSIGNED',
    'incident',
    p_incident_id,
    v_caller_uid,
    jsonb_build_object(
      'incident_id', p_incident_id,
      'reference_number', v_inc.reference_number,
      'old_assignment_id', p_current_assignment_id,
      'new_assignment_id', v_new_assignment_id,
      'old_worker_id', v_curr.worker_id,
      'old_vehicle_id', v_curr.vehicle_id,
      'new_worker_id', p_new_worker_id,
      'new_vehicle_id', p_new_vehicle_id
    )
  );

  -- 13. Return Authoritative Response Payload
  RETURN jsonb_build_object(
    'success', true,
    'incident_id', p_incident_id,
    'reference_number', v_inc.reference_number,
    'old_assignment_id', p_current_assignment_id,
    'new_assignment_id', v_new_assignment_id,
    'new_worker_id', p_new_worker_id,
    'new_vehicle_id', p_new_vehicle_id,
    'incident_status', 'dispatched'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. FUNCTION PRIVILEGES & REVOCATIONS
-- Security DEFINER RPCs: Revoke from PUBLIC and anon; grant exclusively to
-- authenticated role. Internal role check enforces admin/operator authorization.
-- ------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_dispatch_candidates(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dispatch_candidates(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.dispatch_incident(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_incident(UUID, UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.reassign_incident(UUID, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_incident(UUID, UUID, UUID, UUID) TO authenticated;

-- ==============================================================================
-- END OF PHASE 6 MIGRATION
-- ==============================================================================
