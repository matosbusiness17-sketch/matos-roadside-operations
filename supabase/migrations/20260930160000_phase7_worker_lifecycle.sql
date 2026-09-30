-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- PHASE 7A: RESPONSE WORKER LIFECYCLE & DATABASE FOUNDATION
-- Migration: 20260930160000_phase7_worker_lifecycle.sql
--
-- Objectives:
-- 1. Update public.transition_incident_status to permit worker lifecycle invocation
--    when authorized via transaction-local setting matos.authorized_worker_transition.
-- 2. Create authoritative worker lifecycle transition RPC:
--    public.worker_transition_assignment(p_assignment_id UUID, p_action TEXT) RETURNS JSONB
-- 3. Enforce exact 5 worker lifecycle transitions:
--    - ACCEPT_ASSIGNMENT: assigned -> accepted (incident remains dispatched; worker -> busy)
--    - START_JOURNEY: accepted -> en_route (incident -> en_route)
--    - ARRIVE_ON_SCENE: en_route -> on_scene (incident -> on_scene)
--    - START_WORK: assignment stays on_scene (incident -> in_progress)
--    - COMPLETE_JOB: on_scene -> completed, completed_at = now() (incident -> completed; worker -> available)
-- 4. Enforce session-derived identity, row locking (FOR UPDATE), tenant boundary,
--    and atomic operational audit events without reopening direct UPDATE access.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. UPDATE AUTHORITATIVE INCIDENT STATE TRANSITION FUNCTION
--    Allows worker role invocation ONLY when explicitly authorized via the
--    transaction-local configuration setting 'matos.authorized_worker_transition'.
--    Direct RPC invocation by workers without this flag remains strictly rejected.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transition_incident_status(
  p_incident_id UUID,
  p_new_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_org UUID;
  v_caller_role public.app_role;
  v_caller_uid UUID;
  v_current_status TEXT;
  v_incident_id UUID;
  v_ref TEXT;
  v_event_id UUID;
  v_valid_transition BOOLEAN := false;
BEGIN
  -- Derive session identity
  v_caller_org := public.get_current_user_organization_id();
  v_caller_role := public.get_current_user_role();
  v_caller_uid := auth.uid();

  IF v_caller_org IS NULL OR v_caller_role IS NULL OR v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to transition incident status';
  END IF;

  -- Allow admin and operator directly, or worker ONLY when explicitly executing through
  -- an authorized worker lifecycle transition (matos.authorized_worker_transition = 'true')
  IF v_caller_role NOT IN ('admin', 'operator')
     AND current_setting('matos.authorized_worker_transition', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Unauthorized: only admins and operators can transition incident status';
  END IF;

  IF p_incident_id IS NULL THEN
    RAISE EXCEPTION 'Incident ID is required';
  END IF;

  IF p_new_status IS NULL THEN
    RAISE EXCEPTION 'Target status is required';
  END IF;

  -- Retrieve target incident with row lock (FOR UPDATE) strictly within caller organization
  SELECT id, status, reference_number
  INTO v_incident_id, v_current_status, v_ref
  FROM public.incidents
  WHERE id = p_incident_id
    AND organization_id = v_caller_org
  FOR UPDATE;

  IF v_incident_id IS NULL THEN
    RAISE EXCEPTION 'Incident not found or unauthorized';
  END IF;

  -- Rejection of same-state transitions
  IF v_current_status = p_new_status THEN
    RAISE EXCEPTION 'Incident is already in status %', v_current_status;
  END IF;

  -- Rejection of transitions out of terminal states
  IF v_current_status IN ('completed', 'cancelled', 'unable_to_complete') THEN
    RAISE EXCEPTION 'Cannot transition incident in terminal status %', v_current_status;
  END IF;

  -- Locked state machine transition matrix validation
  CASE v_current_status
    WHEN 'new' THEN
      IF p_new_status IN ('triaged', 'cancelled') THEN
        v_valid_transition := true;
      END IF;
    WHEN 'triaged' THEN
      IF p_new_status IN ('ready_for_dispatch', 'cancelled') THEN
        v_valid_transition := true;
      END IF;
    WHEN 'ready_for_dispatch' THEN
      IF p_new_status IN ('dispatched', 'cancelled') THEN
        v_valid_transition := true;
      END IF;
    WHEN 'dispatched' THEN
      IF p_new_status IN ('en_route', 'cancelled') THEN
        v_valid_transition := true;
      END IF;
    WHEN 'en_route' THEN
      IF p_new_status IN ('on_scene', 'cancelled', 'unable_to_complete') THEN
        v_valid_transition := true;
      END IF;
    WHEN 'on_scene' THEN
      IF p_new_status IN ('in_progress', 'cancelled', 'unable_to_complete') THEN
        v_valid_transition := true;
      END IF;
    WHEN 'in_progress' THEN
      IF p_new_status IN ('completed', 'unable_to_complete') THEN
        v_valid_transition := true;
      END IF;
    ELSE
      v_valid_transition := false;
  END CASE;

  IF NOT v_valid_transition THEN
    RAISE EXCEPTION 'Invalid status transition from % to %', v_current_status, p_new_status;
  END IF;

  -- Authorize status mutation via transaction-local GUC flag
  PERFORM set_config('matos.authorized_status_transition', 'true', true);

  -- Perform the intended single status update
  UPDATE public.incidents
  SET status = p_new_status,
      updated_at = now()
  WHERE id = v_incident_id;

  -- Reset authorization flag immediately after update
  PERFORM set_config('matos.authorized_status_transition', 'false', true);

  -- Atomically record INCIDENT_STATUS_CHANGED event in operational_events
  INSERT INTO public.operational_events (
    organization_id,
    entity_type,
    entity_id,
    event_type,
    actor_id,
    metadata
  ) VALUES (
    v_caller_org,
    'incident',
    v_incident_id,
    'INCIDENT_STATUS_CHANGED',
    v_caller_uid,
    jsonb_build_object(
      'previous_status', v_current_status,
      'new_status', p_new_status,
      'reason', nullif(trim(p_reason), '')
    )
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'incident_id', v_incident_id,
    'reference_number', v_ref,
    'previous_status', v_current_status,
    'new_status', p_new_status,
    'event_id', v_event_id,
    'transitioned_at', now()
  );
END;
$$;

-- Exact signature privilege management for transition_incident_status
REVOKE ALL ON FUNCTION public.transition_incident_status(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_incident_status(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.transition_incident_status(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. AUTHORITATIVE WORKER ASSIGNMENT LIFECYCLE TRANSITION RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.worker_transition_assignment(
  p_assignment_id UUID,
  p_action TEXT
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
  v_profile_active BOOLEAN;
  v_worker_id UUID;
  v_worker_availability TEXT;
  
  v_assignment RECORD;
  v_incident RECORD;
  
  v_new_assignment_status TEXT;
  v_new_incident_status TEXT;
  v_new_worker_availability TEXT;
  v_completed_at TIMESTAMPTZ := NULL;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Session Context & Worker Role Verification
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.organization_id, p.role, p.is_active, wp.id, wp.availability_status
  INTO v_caller_org, v_caller_role, v_profile_active, v_worker_id, v_worker_availability
  FROM public.profiles p
  JOIN public.worker_profiles wp ON wp.user_id = p.id AND wp.organization_id = p.organization_id
  WHERE p.id = v_caller_uid;

  IF v_caller_org IS NULL OR v_worker_id IS NULL THEN
    RAISE EXCEPTION 'Worker profile not found for authenticated user';
  END IF;

  IF NOT v_profile_active THEN
    RAISE EXCEPTION 'Profile is deactivated';
  END IF;

  -- Worker role strictly required; admins and operators must not invoke worker lifecycle RPC
  IF v_caller_role != 'worker' THEN
    RAISE EXCEPTION 'Unauthorized: only workers can execute worker assignment transitions';
  END IF;

  -- 2. Parameter Validation
  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'Assignment ID is required';
  END IF;

  IF p_action IS NULL OR p_action NOT IN (
    'ACCEPT_ASSIGNMENT',
    'START_JOURNEY',
    'ARRIVE_ON_SCENE',
    'START_WORK',
    'COMPLETE_JOB'
  ) THEN
    RAISE EXCEPTION 'Invalid worker transition action: %', p_action;
  END IF;

  -- 3. Lock Target Assignment with Row Lock (FOR UPDATE)
  SELECT a.id, a.organization_id, a.incident_id, a.worker_id, a.vehicle_id, a.status, a.assigned_at, a.completed_at
  INTO v_assignment
  FROM public.assignments a
  WHERE a.id = p_assignment_id
  FOR UPDATE;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  -- Verify tenant consistency
  IF v_assignment.organization_id != v_caller_org THEN
    RAISE EXCEPTION 'Assignment not found or cross-tenant access forbidden';
  END IF;

  -- Verify ownership: assignment must belong to caller's resolved worker profile
  IF v_assignment.worker_id != v_worker_id THEN
    RAISE EXCEPTION 'Unauthorized: assignment is not assigned to current worker';
  END IF;

  -- 4. Lock Target Incident with Row Lock (FOR UPDATE)
  SELECT inc.id, inc.organization_id, inc.status, inc.reference_number
  INTO v_incident
  FROM public.incidents inc
  WHERE inc.id = v_assignment.incident_id
  FOR UPDATE;

  IF v_incident.id IS NULL THEN
    RAISE EXCEPTION 'Related incident not found';
  END IF;

  IF v_incident.organization_id != v_caller_org THEN
    RAISE EXCEPTION 'Cross-tenant incident reference detected';
  END IF;

  -- 5. Execute Exact Action Transition
  CASE p_action

    -- --------------------------------------------------------------------------
    -- ACTION 1: ACCEPT_ASSIGNMENT
    -- Assignment: assigned -> accepted
    -- Incident: remains dispatched
    -- Worker Availability: -> busy
    -- --------------------------------------------------------------------------
    WHEN 'ACCEPT_ASSIGNMENT' THEN
      IF v_assignment.status != 'assigned' OR v_incident.status != 'dispatched' THEN
        RAISE EXCEPTION 'ACCEPT_ASSIGNMENT requires assignment in status assigned and incident in status dispatched (current: assignment=%, incident=%)',
          v_assignment.status, v_incident.status;
      END IF;

      v_new_assignment_status := 'accepted';
      v_new_incident_status := v_incident.status; -- remains dispatched
      v_new_worker_availability := 'busy';

      UPDATE public.assignments
      SET status = 'accepted'
      WHERE id = v_assignment.id;

      UPDATE public.worker_profiles
      SET availability_status = 'busy',
          updated_at = v_now
      WHERE id = v_worker_id;

      INSERT INTO public.operational_events (
        organization_id,
        event_type,
        entity_type,
        entity_id,
        actor_id,
        metadata
      ) VALUES (
        v_caller_org,
        'ASSIGNMENT_ACCEPTED',
        'assignment',
        v_assignment.id,
        v_caller_uid,
        jsonb_build_object(
          'assignment_id', v_assignment.id,
          'incident_id', v_incident.id,
          'worker_id', v_worker_id,
          'vehicle_id', v_assignment.vehicle_id,
          'previous_assignment_status', 'assigned',
          'new_assignment_status', 'accepted',
          'incident_status', v_new_incident_status,
          'worker_availability', 'busy'
        )
      );

    -- --------------------------------------------------------------------------
    -- ACTION 2: START_JOURNEY
    -- Assignment: accepted -> en_route
    -- Incident: dispatched -> en_route (reusing Phase 4 transition function)
    -- Worker Availability: unchanged
    -- --------------------------------------------------------------------------
    WHEN 'START_JOURNEY' THEN
      IF v_assignment.status != 'accepted' OR v_incident.status != 'dispatched' THEN
        RAISE EXCEPTION 'START_JOURNEY requires assignment in status accepted and incident in status dispatched (current: assignment=%, incident=%)',
          v_assignment.status, v_incident.status;
      END IF;

      v_new_assignment_status := 'en_route';
      v_new_incident_status := 'en_route';
      v_new_worker_availability := v_worker_availability;

      UPDATE public.assignments
      SET status = 'en_route'
      WHERE id = v_assignment.id;

      -- Authorize incident transition through Phase 4 state machine
      PERFORM set_config('matos.authorized_worker_transition', 'true', true);
      PERFORM public.transition_incident_status(
        v_incident.id,
        'en_route',
        'Worker started journey to incident scene'
      );
      PERFORM set_config('matos.authorized_worker_transition', 'false', true);

      INSERT INTO public.operational_events (
        organization_id,
        event_type,
        entity_type,
        entity_id,
        actor_id,
        metadata
      ) VALUES (
        v_caller_org,
        'ASSIGNMENT_EN_ROUTE',
        'assignment',
        v_assignment.id,
        v_caller_uid,
        jsonb_build_object(
          'assignment_id', v_assignment.id,
          'incident_id', v_incident.id,
          'worker_id', v_worker_id,
          'vehicle_id', v_assignment.vehicle_id,
          'previous_assignment_status', 'accepted',
          'new_assignment_status', 'en_route',
          'previous_incident_status', 'dispatched',
          'new_incident_status', 'en_route'
        )
      );

    -- --------------------------------------------------------------------------
    -- ACTION 3: ARRIVE_ON_SCENE
    -- Assignment: en_route -> on_scene
    -- Incident: en_route -> on_scene (reusing Phase 4 transition function)
    -- Worker Availability: unchanged
    -- --------------------------------------------------------------------------
    WHEN 'ARRIVE_ON_SCENE' THEN
      IF v_assignment.status != 'en_route' OR v_incident.status != 'en_route' THEN
        RAISE EXCEPTION 'ARRIVE_ON_SCENE requires assignment in status en_route and incident in status en_route (current: assignment=%, incident=%)',
          v_assignment.status, v_incident.status;
      END IF;

      v_new_assignment_status := 'on_scene';
      v_new_incident_status := 'on_scene';
      v_new_worker_availability := v_worker_availability;

      UPDATE public.assignments
      SET status = 'on_scene'
      WHERE id = v_assignment.id;

      -- Authorize incident transition through Phase 4 state machine
      PERFORM set_config('matos.authorized_worker_transition', 'true', true);
      PERFORM public.transition_incident_status(
        v_incident.id,
        'on_scene',
        'Worker arrived on incident scene'
      );
      PERFORM set_config('matos.authorized_worker_transition', 'false', true);

      INSERT INTO public.operational_events (
        organization_id,
        event_type,
        entity_type,
        entity_id,
        actor_id,
        metadata
      ) VALUES (
        v_caller_org,
        'ASSIGNMENT_ON_SCENE',
        'assignment',
        v_assignment.id,
        v_caller_uid,
        jsonb_build_object(
          'assignment_id', v_assignment.id,
          'incident_id', v_incident.id,
          'worker_id', v_worker_id,
          'vehicle_id', v_assignment.vehicle_id,
          'previous_assignment_status', 'en_route',
          'new_assignment_status', 'on_scene',
          'previous_incident_status', 'en_route',
          'new_incident_status', 'on_scene'
        )
      );

    -- --------------------------------------------------------------------------
    -- ACTION 4: START_WORK
    -- Assignment: remains on_scene (no assignment status named in_progress)
    -- Incident: on_scene -> in_progress (reusing Phase 4 transition function)
    -- Worker Availability: unchanged
    -- --------------------------------------------------------------------------
    WHEN 'START_WORK' THEN
      IF v_assignment.status != 'on_scene' OR v_incident.status != 'on_scene' THEN
        RAISE EXCEPTION 'START_WORK requires assignment in status on_scene and incident in status on_scene (current: assignment=%, incident=%)',
          v_assignment.status, v_incident.status;
      END IF;

      v_new_assignment_status := 'on_scene'; -- assignment stays on_scene
      v_new_incident_status := 'in_progress';
      v_new_worker_availability := v_worker_availability;

      -- Do not mutate assignment status (remains on_scene)

      -- Authorize incident transition through Phase 4 state machine
      PERFORM set_config('matos.authorized_worker_transition', 'true', true);
      PERFORM public.transition_incident_status(
        v_incident.id,
        'in_progress',
        'Worker commenced on-scene roadside service'
      );
      PERFORM set_config('matos.authorized_worker_transition', 'false', true);

      INSERT INTO public.operational_events (
        organization_id,
        event_type,
        entity_type,
        entity_id,
        actor_id,
        metadata
      ) VALUES (
        v_caller_org,
        'INCIDENT_WORK_STARTED',
        'incident',
        v_incident.id,
        v_caller_uid,
        jsonb_build_object(
          'assignment_id', v_assignment.id,
          'incident_id', v_incident.id,
          'worker_id', v_worker_id,
          'vehicle_id', v_assignment.vehicle_id,
          'assignment_status', 'on_scene',
          'previous_incident_status', 'on_scene',
          'new_incident_status', 'in_progress'
        )
      );

    -- --------------------------------------------------------------------------
    -- ACTION 5: COMPLETE_JOB
    -- Assignment: on_scene -> completed, completed_at = now()
    -- Incident: in_progress -> completed (reusing Phase 4 transition function)
    -- Worker Availability: -> available
    -- --------------------------------------------------------------------------
    WHEN 'COMPLETE_JOB' THEN
      IF v_assignment.status != 'on_scene' OR v_incident.status != 'in_progress' THEN
        RAISE EXCEPTION 'COMPLETE_JOB requires assignment in status on_scene and incident in status in_progress (current: assignment=%, incident=%)',
          v_assignment.status, v_incident.status;
      END IF;

      v_completed_at := v_now;
      v_new_assignment_status := 'completed';
      v_new_incident_status := 'completed';
      v_new_worker_availability := 'available';

      UPDATE public.assignments
      SET status = 'completed',
          completed_at = v_completed_at
      WHERE id = v_assignment.id;

      UPDATE public.worker_profiles
      SET availability_status = 'available',
          updated_at = v_now
      WHERE id = v_worker_id;

      -- Authorize incident transition through Phase 4 state machine
      PERFORM set_config('matos.authorized_worker_transition', 'true', true);
      PERFORM public.transition_incident_status(
        v_incident.id,
        'completed',
        'Worker completed roadside assistance job'
      );
      PERFORM set_config('matos.authorized_worker_transition', 'false', true);

      INSERT INTO public.operational_events (
        organization_id,
        event_type,
        entity_type,
        entity_id,
        actor_id,
        metadata
      ) VALUES (
        v_caller_org,
        'ASSIGNMENT_COMPLETED',
        'assignment',
        v_assignment.id,
        v_caller_uid,
        jsonb_build_object(
          'assignment_id', v_assignment.id,
          'incident_id', v_incident.id,
          'worker_id', v_worker_id,
          'vehicle_id', v_assignment.vehicle_id,
          'previous_assignment_status', 'on_scene',
          'new_assignment_status', 'completed',
          'previous_incident_status', 'in_progress',
          'new_incident_status', 'completed',
          'completed_at', v_completed_at,
          'worker_availability', 'available'
        )
      );

    ELSE
      RAISE EXCEPTION 'Unsupported action: %', p_action;
  END CASE;

  -- 6. Structured Return
  RETURN jsonb_build_object(
    'success', true,
    'action', p_action,
    'assignment_id', v_assignment.id,
    'assignment_status', v_new_assignment_status,
    'incident_id', v_incident.id,
    'incident_status', v_new_incident_status,
    'worker_id', v_worker_id,
    'worker_availability', v_new_worker_availability,
    'completed_at', v_completed_at,
    'transitioned_at', v_now
  );
END;
$$;

-- Revoke permissions from PUBLIC and anon; grant exclusively to authenticated
REVOKE ALL ON FUNCTION public.worker_transition_assignment(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_transition_assignment(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.worker_transition_assignment(UUID, TEXT) TO authenticated;
