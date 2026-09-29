-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- MIGRATION: Phase 3 Core Data Schema & PostGIS Spatial Extensions
-- ==============================================================================
--
-- This migration establishes the spatial and capability data architecture:
-- 1. PostGIS spatial extensions for geospatial calculations
-- 2. Normalized service capability catalogue (service_capabilities)
-- 3. Vehicle capability junction with multi-tenant integrity (vehicle_capabilities)
-- 4. Role-aware Row Level Security for vehicle capabilities:
--    - Admin/Operator: organization-wide visibility and management
--    - Worker: strictly restricted to actively assigned vehicles via worker_vehicle_assignments
--    - Anonymous: zero access
-- 5. Authoritative geospatial location columns on incidents and vehicles
-- 6. Spatial GiST indexes for high-performance proximity queries
-- 7. Tenant-safe, role-bounded spatial functions:
--    - calculate_incident_vehicle_distance: distance calculation in metres
--    - get_nearby_vehicles: proximity retrieval for fleet dispatch
--    - get_nearby_vehicles_for_incident: incident proximity retrieval
--
-- Security Guarantees:
-- - All functions execute with safe search_path = public, extensions
-- - Caller organization derived strictly from authenticated session
-- - Fleet proximity queries restricted to admin and operator roles (workers rejected)
-- - Strict coordinate bounds (-90..90, -180..180) and radius bounds (0..200,000m)
-- - Composite foreign keys enforce tenant isolation
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. POSTGIS SPATIAL EXTENSION
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;

-- ------------------------------------------------------------------------------
-- 2. VEHICLES SPATIAL EXTENSIONS
-- ------------------------------------------------------------------------------
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS last_known_location geography(Point, 4326);

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

-- GiST spatial index for vehicle locations
CREATE INDEX IF NOT EXISTS idx_vehicles_last_known_location
  ON public.vehicles USING GIST (last_known_location);

-- ------------------------------------------------------------------------------
-- 3. SERVICE CAPABILITIES CATALOGUE
-- System-wide standard catalogue of roadside assistance and recovery capabilities.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'standard',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed standard service capabilities catalogue
INSERT INTO public.service_capabilities (code, name, description, category, is_active)
VALUES
  ('towing', 'Standard Towing', 'Standard wheel-lift or flatbed towing for passenger vehicles', 'recovery', true),
  ('flatbed_recovery', 'Flatbed Recovery', 'Specialized flatbed transport for AWD, EV, or low-clearance vehicles', 'recovery', true),
  ('jump_start', 'Battery Jump Start', '12V/24V battery boost and charging diagnostic service', 'roadside', true),
  ('tire_assistance', 'Tire Change & Inflation', 'Spare tire installation or roadside puncture inflation assistance', 'roadside', true),
  ('lockout', 'Vehicle Lockout', 'Non-destructive vehicle entry for locked keys or lockout scenarios', 'roadside', true),
  ('fuel_delivery', 'Emergency Fuel Delivery', 'Delivery of emergency fuel (petrol/diesel) to stranded vehicles', 'roadside', true),
  ('winch_recovery', 'Winch-Out & Recovery', 'Off-road ditch or mud winching and vehicle extraction', 'recovery', true),
  ('heavy_recovery', 'Heavy Duty Recovery', 'Commercial vehicle, bus, and heavy truck towing and recovery', 'commercial', true),
  ('general_assistance', 'General Roadside Assistance', 'Minor roadside mechanical diagnostics and generic assistance', 'roadside', true)
ON CONFLICT (code) DO NOTHING;

-- RLS on service_capabilities
ALTER TABLE public.service_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_capabilities_select_active"
  ON public.service_capabilities
  FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "service_capabilities_insert_admin"
  ON public.service_capabilities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_current_user_role() IN ('admin', 'operator')
  );

CREATE POLICY "service_capabilities_update_admin"
  ON public.service_capabilities
  FOR UPDATE
  TO authenticated
  USING (
    public.get_current_user_role() IN ('admin', 'operator')
  )
  WITH CHECK (
    public.get_current_user_role() IN ('admin', 'operator')
  );

CREATE POLICY "service_capabilities_delete_admin"
  ON public.service_capabilities
  FOR DELETE
  TO authenticated
  USING (
    public.get_current_user_role() IN ('admin', 'operator')
  );

-- ------------------------------------------------------------------------------
-- 4. VEHICLE CAPABILITIES
-- Junction binding response vehicles to authorized service capabilities.
-- Enforces composite foreign key to guarantee vehicle and organization alignment.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicle_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL,
  capability_id UUID NOT NULL REFERENCES public.service_capabilities(id) ON DELETE RESTRICT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Composite tenant integrity constraint
  CONSTRAINT fk_vehicle_capabilities_vehicle_org
    FOREIGN KEY (vehicle_id, organization_id)
    REFERENCES public.vehicles(id, organization_id)
    ON DELETE CASCADE,

  CONSTRAINT uq_vehicle_capabilities_vehicle_cap
    UNIQUE (vehicle_id, capability_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_capabilities_org
  ON public.vehicle_capabilities(organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_capabilities_vehicle
  ON public.vehicle_capabilities(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_capabilities_cap
  ON public.vehicle_capabilities(capability_id);

-- RLS on vehicle_capabilities
ALTER TABLE public.vehicle_capabilities ENABLE ROW LEVEL SECURITY;

-- SELECT POLICY: Role-aware capability access control
-- Admin/Operator: full visibility across their organization fleet
-- Worker: strictly confined to vehicles for which an ACTIVE worker_vehicle_assignment exists
-- Anonymous: zero access
CREATE POLICY "vehicle_capabilities_select"
  ON public.vehicle_capabilities
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR (
        public.get_current_user_role() = 'worker'
        AND EXISTS (
          SELECT 1
          FROM public.worker_vehicle_assignments wva
          WHERE wva.vehicle_id = public.vehicle_capabilities.vehicle_id
            AND wva.worker_id = public.get_current_worker_id()
            AND wva.organization_id = public.get_current_user_organization_id()
            AND wva.status = 'active'
        )
      )
    )
  );

-- INSERT POLICY: Admin/Operator only with explicit WITH CHECK
CREATE POLICY "vehicle_capabilities_insert"
  ON public.vehicle_capabilities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

-- UPDATE POLICY: Admin/Operator only with explicit USING and WITH CHECK
CREATE POLICY "vehicle_capabilities_update"
  ON public.vehicle_capabilities
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  )
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

-- DELETE POLICY: Admin/Operator only
CREATE POLICY "vehicle_capabilities_delete"
  ON public.vehicle_capabilities
  FOR DELETE
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

-- ------------------------------------------------------------------------------
-- 5. INCIDENTS SPATIAL & VEHICLE DATA EXTENSIONS
-- Adds authoritative location, accuracy, source, vehicle data, and required capability.
-- ------------------------------------------------------------------------------
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS location geography(Point, 4326);

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS location_accuracy DOUBLE PRECISION;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS location_source TEXT;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS vehicle_registration TEXT;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS vehicle_make TEXT;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS vehicle_model TEXT;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS vehicle_year INTEGER;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS vehicle_color TEXT;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS required_capability_id UUID REFERENCES public.service_capabilities(id) ON DELETE SET NULL;

-- Spatial GiST index on incident location
CREATE INDEX IF NOT EXISTS idx_incidents_location
  ON public.incidents USING GIST (location);

-- Index on required capability for rapid lookup
CREATE INDEX IF NOT EXISTS idx_incidents_required_capability
  ON public.incidents(required_capability_id);

-- ------------------------------------------------------------------------------
-- 6. SPATIAL SECURITY DEFINER FUNCTIONS
-- ------------------------------------------------------------------------------

-- 6.1 CALCULATE INCIDENT-TO-VEHICLE DISTANCE
-- Calculates geodesic distance in metres between an incident and a vehicle.
-- Role-bounded:
--   Admin/Operator: can calculate for any incident and vehicle in caller organization
--   Worker: restricted to incidents assigned to worker AND vehicle actively authorized for worker
CREATE OR REPLACE FUNCTION public.calculate_incident_vehicle_distance(
  p_incident_id UUID,
  p_vehicle_id UUID
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_org UUID;
  v_caller_role app_role;
  v_worker_id UUID;
  v_incident_loc geography(Point, 4326);
  v_vehicle_loc geography(Point, 4326);
  v_distance DOUBLE PRECISION;
BEGIN
  -- 1. Validate non-null inputs
  IF p_incident_id IS NULL OR p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'Incident ID and Vehicle ID must not be null';
  END IF;

  -- 2. Authenticated caller validation
  v_caller_org := public.get_current_user_organization_id();
  v_caller_role := public.get_current_user_role();

  IF v_caller_org IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Authentication required: caller has no active profile or organization';
  END IF;

  -- 3. Role boundary enforcement
  IF v_caller_role IN ('admin', 'operator') THEN
    -- Admin and operator can query distances within their organization
    NULL;
  ELSIF v_caller_role = 'worker' THEN
    v_worker_id := public.get_current_worker_id();
    IF v_worker_id IS NULL THEN
      RAISE EXCEPTION 'Access denied: worker profile not found';
    END IF;

    -- Worker must be assigned to this incident
    IF NOT EXISTS (
      SELECT 1 FROM public.assignments a
      WHERE a.incident_id = p_incident_id
        AND a.worker_id = v_worker_id
        AND a.organization_id = v_caller_org
    ) THEN
      RAISE EXCEPTION 'Access denied: worker is not assigned to this incident';
    END IF;

    -- Worker must be actively assigned to this vehicle
    IF NOT EXISTS (
      SELECT 1 FROM public.worker_vehicle_assignments wva
      WHERE wva.vehicle_id = p_vehicle_id
        AND wva.worker_id = v_worker_id
        AND wva.organization_id = v_caller_org
        AND wva.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Access denied: worker is not actively authorized for this vehicle';
    END IF;
  ELSE
    RAISE EXCEPTION 'Access denied: unrecognized role';
  END IF;

  -- 4. Retrieve incident location constrained to caller organization
  SELECT location INTO v_incident_loc
  FROM public.incidents
  WHERE id = p_incident_id AND organization_id = v_caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident not found or does not belong to caller organization';
  END IF;

  -- 5. Retrieve vehicle location constrained to caller organization
  SELECT last_known_location INTO v_vehicle_loc
  FROM public.vehicles
  WHERE id = p_vehicle_id AND organization_id = v_caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found or does not belong to caller organization';
  END IF;

  -- 6. Check for valid coordinates
  IF v_incident_loc IS NULL OR v_vehicle_loc IS NULL THEN
    RETURN NULL;
  END IF;

  -- 7. Calculate PostGIS geography distance in metres
  v_distance := ST_Distance(v_incident_loc, v_vehicle_loc);
  RETURN v_distance;
END;
$$;

-- 6.2 GET NEARBY VEHICLES
-- Proximity query retrieving active fleet units ordered by distance in metres.
-- Restricted to Admin and Operator roles only. Workers are rejected.
CREATE OR REPLACE FUNCTION public.get_nearby_vehicles(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_radius_meters DOUBLE PRECISION DEFAULT 50000,
  p_required_capability_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  vehicle_id UUID,
  callsign TEXT,
  registration_number TEXT,
  distance_meters DOUBLE PRECISION,
  last_known_location geography(Point, 4326),
  location_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_org UUID;
  v_caller_role app_role;
  v_origin geography(Point, 4326);
  v_limit INTEGER;
BEGIN
  -- 1. Authenticate caller and verify admin/operator role
  v_caller_org := public.get_current_user_organization_id();
  v_caller_role := public.get_current_user_role();

  IF v_caller_org IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Authentication required: caller has no active profile or organization';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Access denied: proximity fleet searches are restricted to administrators and operators';
  END IF;

  -- 2. Validate latitude
  IF p_latitude IS NULL THEN
    RAISE EXCEPTION 'Latitude must not be null';
  END IF;
  IF p_latitude = 'NaN'::DOUBLE PRECISION OR p_latitude = 'Infinity'::DOUBLE PRECISION OR p_latitude = '-Infinity'::DOUBLE PRECISION THEN
    RAISE EXCEPTION 'Latitude must be a finite number';
  END IF;
  IF p_latitude < -90.0 OR p_latitude > 90.0 THEN
    RAISE EXCEPTION 'Latitude must be between -90 and 90 degrees';
  END IF;

  -- 3. Validate longitude
  IF p_longitude IS NULL THEN
    RAISE EXCEPTION 'Longitude must not be null';
  END IF;
  IF p_longitude = 'NaN'::DOUBLE PRECISION OR p_longitude = 'Infinity'::DOUBLE PRECISION OR p_longitude = '-Infinity'::DOUBLE PRECISION THEN
    RAISE EXCEPTION 'Longitude must be a finite number';
  END IF;
  IF p_longitude < -180.0 OR p_longitude > 180.0 THEN
    RAISE EXCEPTION 'Longitude must be between -180 and 180 degrees';
  END IF;

  -- 4. Validate search radius (strict, no silent clamping)
  IF p_radius_meters IS NULL THEN
    RAISE EXCEPTION 'Search radius must not be null';
  END IF;
  IF p_radius_meters = 'NaN'::DOUBLE PRECISION OR p_radius_meters = 'Infinity'::DOUBLE PRECISION OR p_radius_meters = '-Infinity'::DOUBLE PRECISION THEN
    RAISE EXCEPTION 'Search radius must be a finite number';
  END IF;
  IF p_radius_meters <= 0.0 THEN
    RAISE EXCEPTION 'Search radius must be greater than zero metres';
  END IF;
  IF p_radius_meters > 200000.0 THEN
    RAISE EXCEPTION 'Search radius exceeds maximum permitted limit of 200,000 metres (200 km)';
  END IF;

  -- 5. Safe result bounding
  v_limit := GREATEST(1, LEAST(COALESCE(p_limit, 20), 100));

  -- 6. Construct origin point
  v_origin := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography;

  -- 7. Query active vehicles within radius
  RETURN QUERY
  SELECT
    v.id AS vehicle_id,
    v.callsign,
    v.registration_number,
    ST_Distance(v.last_known_location, v_origin) AS distance_meters,
    v.last_known_location,
    v.location_updated_at
  FROM public.vehicles v
  WHERE v.organization_id = v_caller_org
    AND v.is_active = true
    AND v.last_known_location IS NOT NULL
    AND ST_DWithin(v.last_known_location, v_origin, p_radius_meters)
    AND (
      p_required_capability_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_capabilities vc
        WHERE vc.vehicle_id = v.id
          AND vc.organization_id = v_caller_org
          AND vc.capability_id = p_required_capability_id
      )
    )
  ORDER BY ST_Distance(v.last_known_location, v_origin) ASC
  LIMIT v_limit;
END;
$$;

-- 6.3 GET NEARBY VEHICLES FOR INCIDENT
-- Proximity query for an incident location and its required capability.
-- Restricted to Admin and Operator roles only. Workers are rejected.
CREATE OR REPLACE FUNCTION public.get_nearby_vehicles_for_incident(
  p_incident_id UUID,
  p_radius_meters DOUBLE PRECISION DEFAULT 50000,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  vehicle_id UUID,
  callsign TEXT,
  registration_number TEXT,
  distance_meters DOUBLE PRECISION,
  last_known_location geography(Point, 4326),
  location_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_org UUID;
  v_caller_role app_role;
  v_incident_loc geography(Point, 4326);
  v_required_cap UUID;
  v_lat DOUBLE PRECISION;
  v_lon DOUBLE PRECISION;
BEGIN
  -- 1. Validate incident ID
  IF p_incident_id IS NULL THEN
    RAISE EXCEPTION 'Incident ID must not be null';
  END IF;

  -- 2. Authenticate caller and verify admin/operator role
  v_caller_org := public.get_current_user_organization_id();
  v_caller_role := public.get_current_user_role();

  IF v_caller_org IS NULL OR v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Authentication required: caller has no active profile or organization';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Access denied: proximity fleet searches are restricted to administrators and operators';
  END IF;

  -- 3. Explicit radius validation preventing bypass
  IF p_radius_meters IS NULL THEN
    RAISE EXCEPTION 'Search radius must not be null';
  END IF;
  IF p_radius_meters = 'NaN'::DOUBLE PRECISION OR p_radius_meters = 'Infinity'::DOUBLE PRECISION OR p_radius_meters = '-Infinity'::DOUBLE PRECISION THEN
    RAISE EXCEPTION 'Search radius must be a finite number';
  END IF;
  IF p_radius_meters <= 0.0 THEN
    RAISE EXCEPTION 'Search radius must be greater than zero metres';
  END IF;
  IF p_radius_meters > 200000.0 THEN
    RAISE EXCEPTION 'Search radius exceeds maximum permitted limit of 200,000 metres (200 km)';
  END IF;

  -- 4. Retrieve incident within caller organization
  SELECT location, required_capability_id
  INTO v_incident_loc, v_required_cap
  FROM public.incidents
  WHERE id = p_incident_id AND organization_id = v_caller_org;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident not found or does not belong to caller organization';
  END IF;

  IF v_incident_loc IS NULL THEN
    RETURN;
  END IF;

  -- 5. Extract coordinates
  v_lon := ST_X(v_incident_loc::geometry);
  v_lat := ST_Y(v_incident_loc::geometry);

  -- 6. Safely delegate to get_nearby_vehicles
  RETURN QUERY
  SELECT * FROM public.get_nearby_vehicles(
    v_lat,
    v_lon,
    p_radius_meters,
    v_required_cap,
    p_limit
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. FUNCTION PRIVILEGE REVOCATIONS & GRANTS
-- Revoke execution from PUBLIC, grant explicitly to authenticated users only.
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.calculate_incident_vehicle_distance(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_incident_vehicle_distance(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_nearby_vehicles(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_vehicles(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, UUID, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.get_nearby_vehicles_for_incident(UUID, DOUBLE PRECISION, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_nearby_vehicles_for_incident(UUID, DOUBLE PRECISION, INTEGER) TO authenticated;
