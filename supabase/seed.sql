-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- SEED SCRIPT: Operational Development & Demonstration Environment
-- ==============================================================================
-- EXECUTION SEQUENCING:
--   1. Phase 2 migration: supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql
--   2. Phase 3 migration: supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql
--   3. Phase 4 migration: supabase/migrations/20260929140000_phase4_incident_state_machine.sql
--   4. Seed script:       supabase/seed.sql (this file)
--
-- NOTE ON SYNTHETIC DATA:
-- All coordinates, vehicle telemetry, and incident records below are SYNTHETIC
-- DEVELOPMENT / DEMONSTRATION DATA ONLY.
-- They exist solely to test spatial indexing, proximity queries, and role-aware RLS.
-- This script contains NO real customer information, NO production metrics, and NO
-- fabricated business performance claims.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. DEMO ORGANIZATION
-- ------------------------------------------------------------------------------
INSERT INTO public.organizations (id, name)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Matos Roadside Assistance (Demo Org)'
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- ------------------------------------------------------------------------------
-- 2. DEMO RESPONSE FLEET (VEHICLES WITH SYNTHETIC SPATIAL LOCATIONS)
-- Synthetic coordinates located around the Dublin, Ireland metropolitan area.
-- ------------------------------------------------------------------------------
INSERT INTO public.vehicles (
  id,
  organization_id,
  callsign,
  registration_number,
  is_active,
  last_known_location,
  location_updated_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Unit 101 - Flatbed Heavy Tow',
    'TOW-FB-101',
    true,
    ST_SetSRID(ST_MakePoint(-6.2603, 53.3498), 4326)::geography, -- Synthetic point: Dublin City Centre
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000012'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Unit 102 - Rapid Service & Lockout',
    'SRV-LK-102',
    true,
    ST_SetSRID(ST_MakePoint(-6.2230, 53.3280), 4326)::geography, -- Synthetic point: Ballsbridge
    now()
  )
ON CONFLICT (id) DO UPDATE SET
  last_known_location = EXCLUDED.last_known_location,
  location_updated_at = EXCLUDED.location_updated_at;

-- ------------------------------------------------------------------------------
-- 3. STANDARD SERVICE CAPABILITIES CATALOGUE
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 4. VEHICLE CAPABILITY BINDINGS (SYNTHETIC FLEET CAPABILITIES)
-- ------------------------------------------------------------------------------
-- Unit 101: Heavy towing, flatbed recovery, winch-out, heavy recovery
INSERT INTO public.vehicle_capabilities (organization_id, vehicle_id, capability_id, notes)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000011'::uuid,
  sc.id,
  'Heavy equipment certified'
FROM public.service_capabilities sc
WHERE sc.code IN ('towing', 'flatbed_recovery', 'winch_recovery', 'heavy_recovery')
ON CONFLICT (vehicle_id, capability_id) DO NOTHING;

-- Unit 102: Jump start, tire change, lockout, fuel delivery, general assistance
INSERT INTO public.vehicle_capabilities (organization_id, vehicle_id, capability_id, notes)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000012'::uuid,
  sc.id,
  'Rapid response roadside equipment'
FROM public.service_capabilities sc
WHERE sc.code IN ('jump_start', 'tire_assistance', 'lockout', 'fuel_delivery', 'general_assistance')
ON CONFLICT (vehicle_id, capability_id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 5. DEMO INCIDENT (SYNTHETIC ROAD HAZARD IN DUBLIN)
-- ------------------------------------------------------------------------------
INSERT INTO public.incidents (
  id,
  organization_id,
  reference_number,
  status,
  customer_name,
  customer_phone,
  vehicle_info,
  location_address,
  service_type,
  priority,
  notes,
  location,
  location_accuracy,
  location_source,
  vehicle_registration,
  vehicle_make,
  vehicle_model,
  vehicle_year,
  vehicle_color,
  required_capability_id
)
SELECT
  '00000000-0000-0000-0000-000000000101'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid,
  'INC-2026-0001',
  'new',
  'Liam O''Connor (Synthetic Demo)',
  '+353 87 555 0192',
  '2021 Volkswagen Golf Silver',
  'St Stephen''s Green South, Dublin 2, Ireland',
  'towing',
  'standard',
  'Synthetic test incident: Engine failure, AWD transmission requires flatbed recovery',
  ST_SetSRID(ST_MakePoint(-6.2550, 53.3400), 4326)::geography, -- Synthetic point: St Stephen''s Green
  12.5,
  'device_gps',
  '211-D-12345',
  'Volkswagen',
  'Golf',
  2021,
  'Silver Metallic',
  sc.id
FROM public.service_capabilities sc
WHERE sc.code = 'flatbed_recovery'
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 6. PROVISIONING HELPER FOR SUPABASE AUTH IDENTITIES
-- ------------------------------------------------------------------------------
-- Run the following stored procedure or SQL snippet after creating demo users
-- in your Supabase Project (via Auth Dashboard -> Users -> Add User):
--
-- Demo Identities:
-- 1. Admin:    admin@matos.local    (Role: admin)
-- 2. Operator: operator@matos.local (Role: operator)
-- 3. Worker:   worker@matos.local   (Role: worker)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provision_demo_user(
  target_email TEXT,
  target_role public.app_role,
  target_display_name TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  found_user_id UUID;
  dev_org_id CONSTANT UUID := '00000000-0000-0000-0000-000000000001'::uuid;
  v_worker_id UUID;
BEGIN
  -- Lookup user from auth.users by email
  SELECT id INTO found_user_id
  FROM auth.users
  WHERE email = target_email
  LIMIT 1;

  IF found_user_id IS NULL THEN
    RAISE NOTICE 'User % not found in auth.users. Please create the user in Supabase Auth first.', target_email;
    RETURN;
  END IF;

  -- Insert or update public.profiles
  INSERT INTO public.profiles (id, organization_id, role, display_name, is_active)
  VALUES (found_user_id, dev_org_id, target_role, target_display_name, true)
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    role = EXCLUDED.role,
    display_name = EXCLUDED.display_name,
    is_active = true,
    updated_at = now();

  -- If worker role, ensure worker_profiles record exists and bind to demo vehicle
  IF target_role = 'worker' THEN
    INSERT INTO public.worker_profiles (user_id, organization_id, availability_status)
    VALUES (found_user_id, dev_org_id, 'available')
    ON CONFLICT (user_id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      availability_status = 'available',
      updated_at = now()
    RETURNING id INTO v_worker_id;

    -- Provision active vehicle shift binding for worker to Unit 101 for testing worker RLS
    IF v_worker_id IS NOT NULL THEN
      INSERT INTO public.worker_vehicle_assignments (
        organization_id,
        worker_id,
        vehicle_id,
        status,
        assigned_at
      )
      VALUES (
        dev_org_id,
        v_worker_id,
        '00000000-0000-0000-0000-000000000011'::uuid,
        'active',
        now()
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RAISE NOTICE 'Provisioned profile for % with role %', target_email, target_role;
END;
$$;
