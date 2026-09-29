-- ==============================================================================
-- MATOS SYSTEMS - ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- MIGRATION: Phase 4 Incident Management & Operational State Machine
-- ==============================================================================
--
-- This migration establishes the operational lifecycle and transition architecture:
-- 1. Safely drops old status constraint, migrates 'created' -> 'new', updates default, and adds authoritative 10-state CHECK
-- 2. Concurrency-safe, tenant- and year-scoped incident reference generation (pg_advisory_xact_lock)
-- 3. Authoritative SECURITY DEFINER state transition function (transition_incident_status)
--    - Enforces locked transition matrix
--    - Atomic transition update + operational_events audit append in one transaction
--    - Prevents transitions from terminal states and same-state jumps
--    - Strict caller authentication and admin/operator role enforcement
--    - Concurrency protection via row locking (FOR UPDATE)
-- 4. Privileged incident creation function (create_incident)
--    - Strictly derives organization_id and created_by from session
--    - Validates optional coordinate pairs (longitude, latitude) into geography(Point, 4326)
--    - Validates location accuracy (finite, non-negative, requires coordinates)
--    - Validates vehicle year (1900-2100)
--    - Enforces operator_manual intake contract
--    - Enforces locked Phase 2 TEXT service_type and priority values (no enum casts)
--    - Atomically writes INCIDENT_CREATED operational event
--    - Returns JSONB containing incident_id, reference_number, event_id, created_at
-- 5. Direct status modification guard trigger (trg_protect_incident_status)
--    - Prevents bypassing the state machine via direct generic UPDATE statements
-- 6. Removal of direct mutation RLS paths:
--    - Dropped incidents_insert_operator_admin (creation exclusively via create_incident RPC)
--    - Dropped incidents_update and incidents_update_operator_admin (transitions exclusively via transition_incident_status RPC)
--    - Dropped events_insert (events generated exclusively via privileged RPCs)
-- 7. High-performance composite indexes supporting operational queues and audit queries
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. STATUS MODEL MIGRATION & REPLACED CHECK CONSTRAINT
-- ------------------------------------------------------------------------------

-- Step 1: DROP old Phase 2 incidents_status_check first so 'new' can be written
ALTER TABLE public.incidents
  DROP CONSTRAINT IF EXISTS incidents_status_check;

-- Step 2: Migrate any existing rows from 'created' to 'new'
UPDATE public.incidents
SET status = 'new'
WHERE status = 'created';

-- Step 3: Set column default to 'new'
ALTER TABLE public.incidents
  ALTER COLUMN status SET DEFAULT 'new';

-- Step 4: Add authoritative Phase 4 10-state lifecycle CHECK constraint
ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_status_check
  CHECK (status IN (
    'new',
    'triaged',
    'ready_for_dispatch',
    'dispatched',
    'en_route',
    'on_scene',
    'in_progress',
    'completed',
    'cancelled',
    'unable_to_complete'
  ));

-- ------------------------------------------------------------------------------
-- 2. CONCURRENCY-SAFE REFERENCE NUMBER GENERATOR
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_incident_reference_number(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_year_int INTEGER;
  v_next_seq BIGINT;
  v_ref TEXT;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID cannot be null';
  END IF;

  v_year := to_char(now(), 'YYYY');
  v_year_int := v_year::INTEGER;

  -- Acquire transaction-scoped advisory lock scoped by organization and calendar year
  -- to avoid unnecessary cross-tenant serialization while guaranteeing serialized allocations
  -- for the same tenant and year until transaction completion.
  PERFORM pg_advisory_xact_lock(hashtext(p_org_id::text), v_year_int);

  -- Determine next sequence number by extracting highest existing numeric suffix
  SELECT COALESCE(
    MAX(
      NULLIF(
        regexp_replace(reference_number, '^INC-[0-9]{4}-([0-9]+)$', '\1'),
        reference_number
      )::BIGINT
    ),
    0
  ) + 1
  INTO v_next_seq
  FROM public.incidents
  WHERE organization_id = p_org_id
    AND reference_number ~ ('^INC-' || v_year || '-[0-9]+$');

  -- Format with 4-digit zero-padding for < 10000, and full un-truncated string for >= 10000
  IF v_next_seq < 10000 THEN
    v_ref := 'INC-' || v_year || '-' || lpad(v_next_seq::TEXT, 4, '0');
  ELSE
    v_ref := 'INC-' || v_year || '-' || v_next_seq::TEXT;
  END IF;

  RETURN v_ref;
END;
$$;

-- Revoke all execute privileges from PUBLIC, authenticated, and anon (internal helper only)
REVOKE ALL ON FUNCTION public.generate_incident_reference_number(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_incident_reference_number(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.generate_incident_reference_number(UUID) FROM anon;

-- ------------------------------------------------------------------------------
-- 3. PRIVILEGED INCIDENT INTAKE FUNCTION
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_incident(
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_location_address TEXT,
  p_service_type TEXT,
  p_priority TEXT,
  p_notes TEXT,
  p_required_capability_id UUID,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_location_accuracy DOUBLE PRECISION,
  p_location_source TEXT,
  p_vehicle_registration TEXT,
  p_vehicle_make TEXT,
  p_vehicle_model TEXT,
  p_vehicle_year INTEGER,
  p_vehicle_color TEXT
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
  v_incident_id UUID;
  v_reference_number TEXT;
  v_location geography(Point, 4326) := NULL;
  v_service_type TEXT;
  v_priority TEXT;
  v_event_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  -- Derive tenant and actor strictly from authenticated session
  v_caller_org := public.get_current_user_organization_id();
  v_caller_role := public.get_current_user_role();
  v_caller_uid := auth.uid();

  IF v_caller_org IS NULL OR v_caller_role IS NULL OR v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to create incidents';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Unauthorized: only admins and operators can create incidents';
  END IF;

  -- Validate mandatory customer and location strings
  IF p_customer_name IS NULL OR length(trim(p_customer_name)) = 0 THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;

  IF p_customer_phone IS NULL OR length(trim(p_customer_phone)) = 0 THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;

  IF p_location_address IS NULL OR length(trim(p_location_address)) = 0 THEN
    RAISE EXCEPTION 'Location address is required';
  END IF;

  -- Validate and normalize service_type to locked Phase 2 values (TEXT)
  v_service_type := COALESCE(NULLIF(trim(p_service_type), ''), 'general_assistance');

  IF v_service_type NOT IN (
    'towing',
    'jump_start',
    'lockout',
    'tire_change',
    'fuel_delivery',
    'winch_recovery',
    'general_assistance'
  ) THEN
    RAISE EXCEPTION 'Invalid service_type: %', v_service_type;
  END IF;

  -- Validate and normalize priority to locked Phase 2 values (TEXT)
  v_priority := COALESCE(NULLIF(trim(p_priority), ''), 'standard');

  IF v_priority NOT IN ('low', 'standard', 'high', 'critical') THEN
    RAISE EXCEPTION 'Invalid priority: %', v_priority;
  END IF;

  -- Validate coordinate pair requirements and finite numeric bounds
  IF (p_latitude IS NOT NULL AND p_longitude IS NULL) OR (p_latitude IS NULL AND p_longitude IS NOT NULL) THEN
    RAISE EXCEPTION 'Latitude and longitude must both be provided or both be null';
  END IF;

  IF p_latitude IS NOT NULL THEN
    IF p_latitude = 'NaN'::DOUBLE PRECISION OR p_latitude = 'Infinity'::DOUBLE PRECISION OR p_latitude = '-Infinity'::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'Latitude must be a finite number';
    END IF;
    IF p_latitude < -90.0 OR p_latitude > 90.0 THEN
      RAISE EXCEPTION 'Latitude must be between -90 and 90 degrees';
    END IF;
  END IF;

  IF p_longitude IS NOT NULL THEN
    IF p_longitude = 'NaN'::DOUBLE PRECISION OR p_longitude = 'Infinity'::DOUBLE PRECISION OR p_longitude = '-Infinity'::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'Longitude must be a finite number';
    END IF;
    IF p_longitude < -180.0 OR p_longitude > 180.0 THEN
      RAISE EXCEPTION 'Longitude must be between -180 and 180 degrees';
    END IF;
  END IF;

  -- Validate location accuracy
  IF p_location_accuracy IS NOT NULL THEN
    IF p_latitude IS NULL OR p_longitude IS NULL THEN
      RAISE EXCEPTION 'Location accuracy cannot be specified without coordinates';
    END IF;
    IF p_location_accuracy = 'NaN'::DOUBLE PRECISION OR p_location_accuracy = 'Infinity'::DOUBLE PRECISION OR p_location_accuracy = '-Infinity'::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'Location accuracy must be a finite number';
    END IF;
    IF p_location_accuracy < 0 THEN
      RAISE EXCEPTION 'Location accuracy cannot be negative';
    END IF;
  END IF;

  -- Validate vehicle year
  IF p_vehicle_year IS NOT NULL THEN
    IF p_vehicle_year < 1900 OR p_vehicle_year > 2100 THEN
      RAISE EXCEPTION 'Vehicle year must be between 1900 and 2100';
    END IF;
  END IF;

  -- Enforce operator manual intake provenance contract
  IF p_location_source IS NOT NULL AND p_location_source <> 'operator_manual' THEN
    RAISE EXCEPTION 'Invalid location source for operator intake: Only "operator_manual" is permitted';
  END IF;

  -- Validate required capability if provided
  IF p_required_capability_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.service_capabilities
      WHERE id = p_required_capability_id AND is_active = true
    ) THEN
      RAISE EXCEPTION 'Required capability % does not exist or is inactive', p_required_capability_id;
    END IF;
  END IF;

  -- Construct PostGIS geography point in correct (longitude, latitude) order
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    v_location := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography;
  END IF;

  -- Generate human-readable reference number via serialized allocation helper
  v_reference_number := public.generate_incident_reference_number(v_caller_org);

  -- Insert incident record with status = 'new' and location_source = 'operator_manual'
  INSERT INTO public.incidents (
    organization_id,
    reference_number,
    status,
    priority,
    service_type,
    customer_name,
    customer_phone,
    location_address,
    location,
    location_accuracy,
    location_source,
    vehicle_registration,
    vehicle_make,
    vehicle_model,
    vehicle_year,
    vehicle_color,
    required_capability_id,
    notes,
    created_by
  ) VALUES (
    v_caller_org,
    v_reference_number,
    'new',
    v_priority,
    v_service_type,
    trim(p_customer_name),
    trim(p_customer_phone),
    trim(p_location_address),
    v_location,
    p_location_accuracy,
    'operator_manual',
    nullif(trim(p_vehicle_registration), ''),
    nullif(trim(p_vehicle_make), ''),
    nullif(trim(p_vehicle_model), ''),
    p_vehicle_year,
    nullif(trim(p_vehicle_color), ''),
    p_required_capability_id,
    nullif(trim(p_notes), ''),
    v_caller_uid
  ) RETURNING id, created_at INTO v_incident_id, v_created_at;

  -- Atomically write INCIDENT_CREATED operational event in the same transaction
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
    'INCIDENT_CREATED',
    v_caller_uid,
    jsonb_build_object(
      'reference_number', v_reference_number,
      'status', 'new',
      'priority', v_priority,
      'service_type', v_service_type,
      'location_source', 'operator_manual',
      'required_capability_id', p_required_capability_id
    )
  ) RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'incident_id', v_incident_id,
    'reference_number', v_reference_number,
    'status', 'new',
    'event_id', v_event_id,
    'created_at', v_created_at
  );
END;
$$;

-- Exact signature privilege management for create_incident
REVOKE ALL ON FUNCTION public.create_incident(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.create_incident(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT
) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_incident(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID,
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT
) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. AUTHORITATIVE INCIDENT STATE TRANSITION FUNCTION
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

  IF v_caller_role NOT IN ('admin', 'operator') THEN
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
  ) RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'incident_id', v_incident_id,
    'reference_number', v_ref,
    'previous_status', v_current_status,
    'new_status', p_new_status,
    'reason', nullif(trim(p_reason), ''),
    'event_id', v_event_id
  );
END;
$$;

-- Exact signature privilege management for transition_incident_status
REVOKE ALL ON FUNCTION public.transition_incident_status(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_incident_status(UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.transition_incident_status(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. DIRECT STATUS MODIFICATION GUARD TRIGGER
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_incident_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Strict cross-tenant protection
  IF NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'Organization ID of an incident cannot be modified';
  END IF;

  -- Status update protection: must be executed through transition_incident_status()
  IF NEW.status <> OLD.status THEN
    IF current_setting('matos.authorized_status_transition', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Direct status updates are forbidden. Status transitions must occur through transition_incident_status()';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_incident_status ON public.incidents;

CREATE TRIGGER trg_protect_incident_status
  BEFORE UPDATE OF status, organization_id
  ON public.incidents
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_incident_status_transition();

-- ------------------------------------------------------------------------------
-- 6. DIRECT MUTATION POLICY CLOSURES (RLS HARDENING)
-- ------------------------------------------------------------------------------

-- Drop Phase 2 direct incident INSERT policy; normal authenticated clients must use create_incident RPC
DROP POLICY IF EXISTS "incidents_insert_operator_admin" ON public.incidents;

-- Drop Phase 2 direct incident UPDATE policies; mutations must use transition_incident_status RPC
DROP POLICY IF EXISTS "incidents_update" ON public.incidents;
DROP POLICY IF EXISTS "incidents_update_operator_admin" ON public.incidents;

-- Drop Phase 2 direct operational_events INSERT policy to prevent audit record forgery
DROP POLICY IF EXISTS "events_insert" ON public.operational_events;

-- ------------------------------------------------------------------------------
-- 7. PERFORMANCE COMPOSITE INDEXES
-- ------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_incidents_org_created
  ON public.incidents(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_org_status_created
  ON public.incidents(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operational_events_incident_history
  ON public.operational_events(entity_id, created_at ASC)
  WHERE entity_type = 'incident';
