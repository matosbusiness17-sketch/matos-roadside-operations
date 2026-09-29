-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- MIGRATION: Phase 5 Operational Mapping & Fleet Telemetry Foundation
-- ==============================================================================
--
-- This migration establishes the read-only operational snapshot RPC for the
-- unified operational mapping workspace (/operations):
--
-- 1. Authoritative SECURITY DEFINER function: public.get_operations_map_snapshot()
--    - Zero-parameter contract: no client-supplied organization or tenant parameter
--    - Session-derived tenancy: derives caller UID, organization, and role strictly
--      from authenticated session context (auth.uid(), get_current_user_organization_id(),
--      get_current_user_role())
--    - Role-restricted: permits admin and operator roles only; rejects workers
--    - Read-only execution guarantee: strictly performs SELECT queries; zero mutations
--    - Active incident scoping: returns exactly the 7 active operational statuses:
--        'new', 'triaged', 'ready_for_dispatch', 'dispatched', 'en_route', 'on_scene', 'in_progress'
--      and strictly excludes terminal statuses ('completed', 'cancelled', 'unable_to_complete')
--    - Deterministic incident ordering: enforced at final aggregate level:
--      priority (critical > high > standard > low), then oldest created_at first, then id ASC
--    - PostGIS coordinate derivation: derives numeric longitude (ST_X) and latitude (ST_Y)
--      from geography(Point, 4326) columns without storing duplicate coordinate columns
--    - Missing-location tolerance: incidents and vehicles without spatial coordinates
--      remain included in the snapshot with null latitude and longitude
--    - Active fleet scoping: returns active organization vehicles (is_active = true)
--      with last-known location timestamps and normalized service capabilities,
--      ordered at aggregate level by callsign ASC, id ASC
--    - Strict privilege model: execution revoked from PUBLIC and anon; granted to authenticated
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. READ-ONLY OPERATIONAL SNAPSHOT RPC
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_operations_map_snapshot()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_uid UUID;
  v_caller_org UUID;
  v_caller_role public.app_role;
  v_snapshot JSONB;
BEGIN
  -- 1. Derive authenticated session identity
  v_caller_uid := auth.uid();
  v_caller_org := public.get_current_user_organization_id();
  v_caller_role := public.get_current_user_role();

  -- 2. Validate session availability
  IF v_caller_uid IS NULL OR v_caller_org IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Authentication required to access operations map snapshot';
  END IF;

  -- 3. Restrict execution strictly to admin and operator roles (worker access rejected)
  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Unauthorized: only admins and operators can access operations map snapshot';
  END IF;

  -- 4. Construct read-only operational snapshot payload
  WITH incident_records AS (
    SELECT
      i.id,
      i.reference_number,
      i.status,
      i.priority,
      i.service_type,
      i.customer_name,
      i.customer_phone,
      i.location_address,
      CASE
        WHEN i.location IS NOT NULL THEN ST_Y(i.location::geometry)
        ELSE NULL
      END AS latitude,
      CASE
        WHEN i.location IS NOT NULL THEN ST_X(i.location::geometry)
        ELSE NULL
      END AS longitude,
      i.location_accuracy,
      i.location_source,
      CASE
        WHEN sc.id IS NOT NULL THEN
          jsonb_build_object(
            'id', sc.id,
            'code', sc.code,
            'name', sc.name
          )
        ELSE NULL
      END AS required_capability,
      i.vehicle_registration,
      i.vehicle_make,
      i.vehicle_model,
      i.vehicle_year,
      i.vehicle_color,
      i.notes,
      i.created_at,
      i.updated_at
    FROM public.incidents i
    LEFT JOIN public.service_capabilities sc
      ON i.required_capability_id = sc.id
    WHERE i.organization_id = v_caller_org
      AND i.status IN (
        'new',
        'triaged',
        'ready_for_dispatch',
        'dispatched',
        'en_route',
        'on_scene',
        'in_progress'
      )
  ),
  vehicle_records AS (
    SELECT
      v.id,
      v.callsign,
      v.registration_number,
      v.is_active,
      CASE
        WHEN v.last_known_location IS NOT NULL THEN ST_Y(v.last_known_location::geometry)
        ELSE NULL
      END AS latitude,
      CASE
        WHEN v.last_known_location IS NOT NULL THEN ST_X(v.last_known_location::geometry)
        ELSE NULL
      END AS longitude,
      v.location_updated_at,
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', sc.id,
              'code', sc.code,
              'name', sc.name
            )
            ORDER BY sc.name ASC
          )
          FROM public.vehicle_capabilities vc
          JOIN public.service_capabilities sc
            ON vc.capability_id = sc.id
          WHERE vc.vehicle_id = v.id
            AND vc.organization_id = v_caller_org
            AND sc.is_active = true
        ),
        '[]'::jsonb
      ) AS capabilities
    FROM public.vehicles v
    WHERE v.organization_id = v_caller_org
      AND v.is_active = true
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'incidents', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'reference_number', r.reference_number,
            'status', r.status,
            'priority', r.priority,
            'service_type', r.service_type,
            'customer_name', r.customer_name,
            'customer_phone', r.customer_phone,
            'location_address', r.location_address,
            'latitude', r.latitude,
            'longitude', r.longitude,
            'location_accuracy', r.location_accuracy,
            'location_source', r.location_source,
            'required_capability', r.required_capability,
            'vehicle_registration', r.vehicle_registration,
            'vehicle_make', r.vehicle_make,
            'vehicle_model', r.vehicle_model,
            'vehicle_year', r.vehicle_year,
            'vehicle_color', r.vehicle_color,
            'notes', r.notes,
            'created_at', r.created_at,
            'updated_at', r.updated_at
          )
          ORDER BY
            CASE r.priority
              WHEN 'critical' THEN 1
              WHEN 'high' THEN 2
              WHEN 'standard' THEN 3
              WHEN 'low' THEN 4
              ELSE 5
            END ASC,
            r.created_at ASC,
            r.id ASC
        )
        FROM incident_records r
      ),
      '[]'::jsonb
    ),
    'vehicles', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', vr.id,
            'callsign', vr.callsign,
            'registration_number', vr.registration_number,
            'is_active', vr.is_active,
            'latitude', vr.latitude,
            'longitude', vr.longitude,
            'location_updated_at', vr.location_updated_at,
            'capabilities', vr.capabilities
          )
          ORDER BY
            vr.callsign ASC,
            vr.id ASC
        )
        FROM vehicle_records vr
      ),
      '[]'::jsonb
    )
  ) INTO v_snapshot;

  RETURN v_snapshot;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. PRIVILEGES & ACCESS CONTROL
-- Explicitly revoke from PUBLIC and anon; grant exclusively to authenticated.
-- Internal role check ensures field workers are rejected even if authenticated.
-- ------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_operations_map_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_operations_map_snapshot() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_operations_map_snapshot() TO authenticated;
