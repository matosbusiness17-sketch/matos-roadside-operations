-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- PHASE 7C: WORKER GPS / VEHICLE LOCATION PUBLISHING
-- Migration: 20260930190000_phase7c_worker_location_publish.sql
--
-- Objectives:
-- 1. Create authoritative worker vehicle location publishing RPC:
--    public.worker_publish_vehicle_location(
--      p_latitude double precision,
--      p_longitude double precision
--    ) RETURNS JSONB
-- 2. Enforce strict session-derived authorization:
--    - Caller must be authenticated
--    - Caller profile must exist and be active
--    - Caller role must be strictly 'worker'
--    - Caller worker_profile must exist
--    - Caller organization derived strictly from authenticated profile
-- 3. Enforce active shift binding:
--    - Exactly ONE active worker_vehicle_assignments binding required
--    - Ambiguous or missing bindings rejected fail-closed
--    - Target vehicle must be active and belong to same organization
-- 4. Secure spatial update:
--    - PostGIS ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
--    - Update existing last_known_location and location_updated_at columns on public.vehicles
--    - Zero duplicate coordinate columns
-- 5. Strict privilege management:
--    - Revoke from PUBLIC and anon; grant execute to authenticated
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.worker_publish_vehicle_location(
  p_latitude double precision,
  p_longitude double precision
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
  v_binding_count INTEGER;
  v_vehicle_id UUID;
  v_verified_vehicle_id UUID;
  v_vehicle_active BOOLEAN;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Derive & verify authenticated session
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to publish vehicle location';
  END IF;

  -- 2. Coordinate validation
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Latitude and longitude coordinates are required';
  END IF;

  IF p_latitude < -90.0 OR p_latitude > 90.0 OR p_longitude < -180.0 OR p_longitude > 180.0 THEN
    RAISE EXCEPTION 'Coordinates out of valid range: latitude [-90, 90], longitude [-180, 180]';
  END IF;

  -- 3. Resolve profile & enforce worker role
  SELECT p.organization_id, p.role, p.is_active
  INTO v_caller_org, v_caller_role, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_caller_uid;

  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Profile not found for authenticated user';
  END IF;

  IF NOT v_profile_active THEN
    RAISE EXCEPTION 'Profile is deactivated';
  END IF;

  IF v_caller_role != 'worker' THEN
    RAISE EXCEPTION 'Unauthorized: only workers can publish vehicle location';
  END IF;

  -- 4. Resolve worker_profile existence
  SELECT wp.id
  INTO v_worker_id
  FROM public.worker_profiles wp
  WHERE wp.user_id = v_caller_uid
    AND wp.organization_id = v_caller_org;

  IF v_worker_id IS NULL THEN
    RAISE EXCEPTION 'Worker profile not found for authenticated user';
  END IF;

  -- 5. Resolve active vehicle assignment binding (strictly require exactly 1)
  SELECT COUNT(*)
  INTO v_binding_count
  FROM public.worker_vehicle_assignments wva
  WHERE wva.worker_id = v_worker_id
    AND wva.organization_id = v_caller_org
    AND wva.status = 'active';

  IF v_binding_count = 0 THEN
    RAISE EXCEPTION 'No active vehicle assignment found for worker';
  ELSIF v_binding_count > 1 THEN
    RAISE EXCEPTION 'Ambiguous active vehicle assignment state: multiple active bindings found';
  END IF;

  SELECT wva.vehicle_id
  INTO v_vehicle_id
  FROM public.worker_vehicle_assignments wva
  WHERE wva.worker_id = v_worker_id
    AND wva.organization_id = v_caller_org
    AND wva.status = 'active';

  -- 6. Lock and verify assigned vehicle
  SELECT v.id, v.is_active
  INTO v_verified_vehicle_id, v_vehicle_active
  FROM public.vehicles v
  WHERE v.id = v_vehicle_id
    AND v.organization_id = v_caller_org
  FOR UPDATE;

  IF v_verified_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Assigned vehicle not found in organization';
  END IF;

  IF NOT v_vehicle_active THEN
    RAISE EXCEPTION 'Assigned vehicle is deactivated';
  END IF;

  -- 7. Update authoritative vehicle location (PostGIS Point: longitude then latitude)
  UPDATE public.vehicles
  SET last_known_location = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
      location_updated_at = v_now,
      updated_at = v_now
  WHERE id = v_vehicle_id;

  -- 8. Return structured payload
  RETURN jsonb_build_object(
    'success', true,
    'vehicle_id', v_vehicle_id,
    'latitude', p_latitude,
    'longitude', p_longitude,
    'location_updated_at', v_now
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- PRIVILEGE MANAGEMENT
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.worker_publish_vehicle_location(double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_publish_vehicle_location(double precision, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.worker_publish_vehicle_location(double precision, double precision) TO authenticated;
