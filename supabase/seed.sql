-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- SEED SCRIPT: Phase 2 Development & Demonstration Environment
-- ==============================================================================
-- This script provisions the development organization and fleet units.
-- It also provides the exact SQL to attach development identities (admin, operator, worker)
-- once their Supabase Auth accounts are created.
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
-- 2. DEMO RESPONSE FLEET (VEHICLES)
-- ------------------------------------------------------------------------------
INSERT INTO public.vehicles (id, organization_id, callsign, registration_number, is_active)
VALUES
  (
    '00000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Unit 101 - Flatbed Heavy Tow',
    'TOW-FB-101',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000012'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid,
    'Unit 102 - Rapid Service & Lockout',
    'SRV-LK-102',
    true
  )
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 3. PROVISIONING HELPER FOR SUPABASE AUTH IDENTITIES
-- ------------------------------------------------------------------------------
-- Run the following stored procedure or SQL snippet after creating the 3 demo users
-- in your Supabase Project (via Auth Dashboard -> Users -> Invite or Add User):
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
  worker_id UUID;
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

  -- If worker role, ensure worker_profiles record exists
  IF target_role = 'worker' THEN
    INSERT INTO public.worker_profiles (user_id, organization_id, availability_status)
    VALUES (found_user_id, dev_org_id, 'available')
    ON CONFLICT (user_id) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      availability_status = 'available',
      updated_at = now();
  END IF;

  RAISE NOTICE 'Provisioned profile for % with role %', target_email, target_role;
END;
$$;

-- To execute provisioning after creating users in Supabase Auth:
-- SELECT public.provision_demo_user('admin@matos.local', 'admin', 'Alex Admin');
-- SELECT public.provision_demo_user('operator@matos.local', 'operator', 'Morgan Operator');
-- SELECT public.provision_demo_user('worker@matos.local', 'worker', 'Taylor Worker');
