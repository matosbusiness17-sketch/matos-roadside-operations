-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- MIGRATION: Phase 2 Core Schema, Tenancy, Role Authorization & Row Level Security
-- ==============================================================================
--
-- This migration establishes the foundational data architecture for Phase 2:
-- 1. Multi-tenant organization scoping (organizations)
-- 2. User identities & explicit role authorization (profiles: admin, operator, worker)
-- 3. Field worker operational identities (worker_profiles)
-- 4. Mobile response units & fleet registry (vehicles)
-- 5. Worker-to-vehicle operational bindings (worker_vehicle_assignments)
-- 6. Core incident lifecycle entity (incidents)
-- 7. Incident worker/vehicle dispatch bindings (assignments)
-- 8. Append-only operational event & audit log (operational_events)
-- 9. Row Level Security (RLS) policies enforcing multi-tenancy & role boundaries
-- 10. Privilege escalation guards preventing role self-modification
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS & ROLE TYPES
-- ------------------------------------------------------------------------------

-- Ensure pgcrypto or uuid generation is available
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Application roles constrained to approved Phase 2 set
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE app_role AS ENUM ('admin', 'operator', 'worker');
  END IF;
END$$;

-- ------------------------------------------------------------------------------
-- 2. ORGANIZATIONS
-- Tenancy root representing the roadside assistance company.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for organization lookup
CREATE INDEX IF NOT EXISTS idx_organizations_name ON public.organizations(name);

-- ------------------------------------------------------------------------------
-- 3. PROFILES
-- Application-level profile tied to a Supabase Auth user (auth.users).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  role app_role NOT NULL DEFAULT 'worker',
  display_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Composite unique allows child tables to enforce organization consistency
  CONSTRAINT uq_profiles_id_org UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_org ON public.profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- ------------------------------------------------------------------------------
-- 4. WORKER PROFILES
-- Worker-specific operational extension of an authenticated user/profile.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.worker_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  availability_status TEXT NOT NULL DEFAULT 'off_duty'
    CHECK (availability_status IN ('off_duty', 'available', 'busy', 'unavailable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce relational consistency: worker's organization matches profile's organization
  CONSTRAINT fk_worker_profiles_profile_org
    FOREIGN KEY (user_id, organization_id)
    REFERENCES public.profiles(id, organization_id)
    ON DELETE CASCADE,

  CONSTRAINT uq_worker_profiles_id_org UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_worker_profiles_org ON public.worker_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_user ON public.worker_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_worker_profiles_status ON public.worker_profiles(availability_status);

-- ------------------------------------------------------------------------------
-- 5. VEHICLES
-- Mobile response units/vehicles owned by an organization.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  callsign TEXT NOT NULL,
  registration_number TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_vehicles_org_callsign UNIQUE (organization_id, callsign),
  CONSTRAINT uq_vehicles_id_org UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_org ON public.vehicles(organization_id);

-- ------------------------------------------------------------------------------
-- 6. WORKER VEHICLE ASSIGNMENTS
-- Tracks which vehicle a worker is operating during a shift.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.worker_vehicle_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  vehicle_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,

  -- Foreign keys ensure cross-organization binding cannot occur
  CONSTRAINT fk_wva_worker_org
    FOREIGN KEY (worker_id, organization_id)
    REFERENCES public.worker_profiles(id, organization_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_wva_vehicle_org
    FOREIGN KEY (vehicle_id, organization_id)
    REFERENCES public.vehicles(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wva_org ON public.worker_vehicle_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_wva_worker ON public.worker_vehicle_assignments(worker_id);
CREATE INDEX IF NOT EXISTS idx_wva_vehicle ON public.worker_vehicle_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_wva_status ON public.worker_vehicle_assignments(status);

-- ------------------------------------------------------------------------------
-- 7. INCIDENTS
-- Structural foundation for roadside assistance incidents.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  reference_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'triaged', 'dispatched', 'en_route', 'on_scene', 'completed', 'cancelled')),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  vehicle_info TEXT,
  location_address TEXT NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'general_assistance'
    CHECK (service_type IN ('towing', 'jump_start', 'lockout', 'tire_change', 'fuel_delivery', 'winch_recovery', 'general_assistance')),
  priority TEXT NOT NULL DEFAULT 'standard'
    CHECK (priority IN ('low', 'standard', 'high', 'critical')),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_incidents_org_ref UNIQUE (organization_id, reference_number),
  CONSTRAINT uq_incidents_id_org UNIQUE (id, organization_id),

  -- Optional foreign key ensuring created_by belongs to the same organization
  CONSTRAINT fk_incidents_created_by_org
    FOREIGN KEY (created_by, organization_id)
    REFERENCES public.profiles(id, organization_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_incidents_org ON public.incidents(organization_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_ref ON public.incidents(reference_number);

-- ------------------------------------------------------------------------------
-- 8. ASSIGNMENTS
-- Dispatches a worker and vehicle to an incident.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  incident_id UUID NOT NULL,
  worker_id UUID NOT NULL,
  vehicle_id UUID,
  status TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'accepted', 'en_route', 'on_scene', 'completed', 'cancelled')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  -- Foreign keys enforcing strict tenant boundary across all 3 related entities
  CONSTRAINT fk_assignments_incident_org
    FOREIGN KEY (incident_id, organization_id)
    REFERENCES public.incidents(id, organization_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_assignments_worker_org
    FOREIGN KEY (worker_id, organization_id)
    REFERENCES public.worker_profiles(id, organization_id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_assignments_vehicle_org
    FOREIGN KEY (vehicle_id, organization_id)
    REFERENCES public.vehicles(id, organization_id)
    ON DELETE SET NULL,

  CONSTRAINT uq_assignments_id_org UNIQUE (id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_org ON public.assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_assignments_incident ON public.assignments(incident_id);
CREATE INDEX IF NOT EXISTS idx_assignments_worker ON public.assignments(worker_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON public.assignments(status);

-- ------------------------------------------------------------------------------
-- 9. OPERATIONAL EVENTS (AUDIT LOG)
-- Append-only event history for tracking state changes and actions.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.operational_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operational_events_org ON public.operational_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_operational_events_entity ON public.operational_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_operational_events_created ON public.operational_events(created_at);

-- ------------------------------------------------------------------------------
-- 10. SECURITY HELPER FUNCTIONS (SECURITY DEFINER)
-- Optimized STABLE helper functions to evaluate RLS policies efficiently.
-- ------------------------------------------------------------------------------

-- Returns current authenticated user's organization_id
CREATE OR REPLACE FUNCTION public.get_current_user_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true
  LIMIT 1;
$$;

-- Returns current authenticated user's role
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid() AND is_active = true
  LIMIT 1;
$$;

-- Returns current authenticated user's worker_profiles.id (if worker)
CREATE OR REPLACE FUNCTION public.get_current_worker_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.worker_profiles
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- ------------------------------------------------------------------------------
-- 11. PRIVILEGE ESCALATION GUARDS (TRIGGERS)
-- Prevents users from updating their own role or changing their organization.
-- Only organization admins can update another user's role.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_role app_role;
  caller_org UUID;
BEGIN
  -- Organization membership is immutable once created
  IF NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'Cross-organization transfers are strictly prohibited';
  END IF;

  -- If role is changing, verify caller is an active organization admin
  IF NEW.role <> OLD.role THEN
    caller_role := public.get_current_user_role();
    caller_org := public.get_current_user_organization_id();

    IF caller_role IS NULL OR caller_role <> 'admin' OR caller_org <> OLD.organization_id THEN
      RAISE EXCEPTION 'Privilege escalation rejected: only organization admins may alter user roles';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
CREATE TRIGGER trg_protect_profile_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.check_profile_privilege_escalation();

-- ------------------------------------------------------------------------------
-- 12. IMMUTABLE AUDIT LOG TRIGGER
-- Enforces append-only integrity on operational_events table.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_audit_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Operational audit log records are immutable and cannot be updated or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_immutable_operational_events ON public.operational_events;
CREATE TRIGGER trg_immutable_operational_events
  BEFORE UPDATE OR DELETE ON public.operational_events
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_audit_modification();

-- ------------------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY (RLS) POLICIES
-- Strict multi-tenant isolation and role-bounded data access.
-- Anonymous clients (auth.role() != 'authenticated') have ZERO access.
-- ------------------------------------------------------------------------------

-- Enable RLS on all public tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_events ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 13.1 ORGANIZATIONS POLICIES
-- ------------------------------------------------------------------------------
CREATE POLICY "org_select_own"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (id = public.get_current_user_organization_id());

CREATE POLICY "org_update_admin_only"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (
    id = public.get_current_user_organization_id()
    AND public.get_current_user_role() = 'admin'
  )
  WITH CHECK (
    id = public.get_current_user_organization_id()
    AND public.get_current_user_role() = 'admin'
  );

-- ------------------------------------------------------------------------------
-- 13.2 PROFILES POLICIES
-- ------------------------------------------------------------------------------
-- Users can view all active profiles within their own organization (for dispatch & collaboration)
CREATE POLICY "profiles_select_own_org"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (organization_id = public.get_current_user_organization_id());

-- Users can update their own display name (trigger guards role / organization escalation)
CREATE POLICY "profiles_update_self_or_admin"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (id = auth.uid() OR public.get_current_user_role() = 'admin')
  )
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND (id = auth.uid() OR public.get_current_user_role() = 'admin')
  );

-- ------------------------------------------------------------------------------
-- 13.3 WORKER PROFILES POLICIES
-- ------------------------------------------------------------------------------
-- Admin and Operator can view all workers in organization.
-- Worker can view their own worker profile.
CREATE POLICY "worker_profiles_select"
  ON public.worker_profiles
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR user_id = auth.uid()
    )
  );

-- Worker can update their own status (e.g. available/off-duty).
-- Admin and Operator can update worker records in their organization.
CREATE POLICY "worker_profiles_update"
  ON public.worker_profiles
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR user_id = auth.uid()
    )
  );

-- Admin and Operator can insert new worker profiles
CREATE POLICY "worker_profiles_insert"
  ON public.worker_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

-- ------------------------------------------------------------------------------
-- 13.4 VEHICLES POLICIES
-- ------------------------------------------------------------------------------
-- All authenticated users in the organization can view active fleet vehicles.
CREATE POLICY "vehicles_select_org"
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (organization_id = public.get_current_user_organization_id());

-- Only Admins and Operators can insert or update vehicles
CREATE POLICY "vehicles_insert_operator_admin"
  ON public.vehicles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

CREATE POLICY "vehicles_update_operator_admin"
  ON public.vehicles
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

-- ------------------------------------------------------------------------------
-- 13.5 WORKER VEHICLE ASSIGNMENTS POLICIES
-- ------------------------------------------------------------------------------
-- Admin & Operator: see all assignments in organization.
-- Worker: see assignments for their worker ID.
CREATE POLICY "wva_select"
  ON public.worker_vehicle_assignments
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR worker_id = public.get_current_worker_id()
    )
  );

CREATE POLICY "wva_insert_operator_admin"
  ON public.worker_vehicle_assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

CREATE POLICY "wva_update_operator_admin"
  ON public.worker_vehicle_assignments
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

-- ------------------------------------------------------------------------------
-- 13.6 INCIDENTS POLICIES
-- Core operational resource:
-- Admin & Operator: full access to organization incidents.
-- Worker: STRICTLY RESTRICTED to incidents assigned to this worker.
-- ------------------------------------------------------------------------------
CREATE POLICY "incidents_select"
  ON public.incidents
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.incident_id = incidents.id
          AND a.worker_id = public.get_current_worker_id()
      )
    )
  );

CREATE POLICY "incidents_insert_operator_admin"
  ON public.incidents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

CREATE POLICY "incidents_update"
  ON public.incidents
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.incident_id = incidents.id
          AND a.worker_id = public.get_current_worker_id()
      )
    )
  )
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR EXISTS (
        SELECT 1 FROM public.assignments a
        WHERE a.incident_id = incidents.id
          AND a.worker_id = public.get_current_worker_id()
      )
    )
  );

-- ------------------------------------------------------------------------------
-- 13.7 ASSIGNMENTS POLICIES
-- Admin & Operator: manage all assignments in organization.
-- Worker: see and update assignments bound to their worker ID.
-- ------------------------------------------------------------------------------
CREATE POLICY "assignments_select"
  ON public.assignments
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR worker_id = public.get_current_worker_id()
    )
  );

CREATE POLICY "assignments_insert_operator_admin"
  ON public.assignments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

CREATE POLICY "assignments_update"
  ON public.assignments
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR worker_id = public.get_current_worker_id()
    )
  )
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR worker_id = public.get_current_worker_id()
    )
  );

-- ------------------------------------------------------------------------------
-- 13.8 OPERATIONAL EVENTS POLICIES
-- Append-only audit:
-- Admin & Operator: view all events in organization.
-- Worker: view events where they are the actor.
-- Insert: all authenticated users can append events for their actions.
-- Update/Delete: NEVER PERMITTED (enforced by trigger + no policy defined).
-- ------------------------------------------------------------------------------
CREATE POLICY "events_select"
  ON public.operational_events
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND (
      public.get_current_user_role() IN ('admin', 'operator')
      OR actor_id = auth.uid()
    )
  );

CREATE POLICY "events_insert"
  ON public.operational_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.get_current_user_organization_id()
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );
