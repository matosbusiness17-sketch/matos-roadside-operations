-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- PHASE 9A: SECURE DATABASE FOUNDATION & SCHEMA EVOLUTION
-- Migration: 20261001120000_phase9_voice_intake_and_sms_gateway.sql
--
-- Objectives:
-- 1. Safely evolve Phase 8 customer_location_requests:
--    - Make created_by nullable to support automated integration requests (no fabricated human actor).
--    - Add composite uniqueness constraint (id, organization_id, incident_id) for tenant-safe child references.
-- 2. Create organization_integrations table for provider-scoped integration credentials (vapi, twilio):
--    - Enforces UNIQUE (organization_id, provider) and UNIQUE (provider, integration_token_hash).
--    - Integration token hashes stored; zero raw secrets persisted.
-- 3. Create intake_idempotency_keys table for exactly-once voice tool-call execution.
-- 4. Create customer_location_sms_dispatches table for Reserve-Before-Send idempotency & status tracking:
--    - Enforces E.164 phone format and MATOSROAD alphanumeric sender default.
--    - Check constraint: request_id required prior to provider-active states.
--    - ON DELETE RESTRICT on composite fk_sms_dispatches_profile_org to protect NOT NULL organization_id.
-- 5. Idempotently register customer_location_sms_dispatches in supabase_realtime publication.
-- 6. Strict privilege model & RLS:
--    - Tables completely mutation-locked from PUBLIC, anon, authenticated.
--    - SELECT granted on customer_location_sms_dispatches to authenticated operators only.
-- 7. Integration-only RPCs (REVOKE FROM PUBLIC, GRANT EXECUTE TO anon):
--    - create_voice_intake_incident (advisory lock + capability resolution + telephony_intake + stored status on duplicate)
--    - create_automated_customer_location_request (Phase 8 token reuse with created_by = NULL)
--    - reserve_customer_location_sms_integration (atomic Reserve-Before-Send)
--    - finalize_customer_location_sms_send_integration (stores real returned status, non-regressing, preserves terminal failure data)
--    - record_sms_status_callback (monotonic status progression + crash recovery by dispatch_id)
-- 8. Operator-facing RPCs (GRANT EXECUTE TO authenticated):
--    - reserve_customer_location_sms_operator (session-derived actor)
--    - attach_customer_location_request_to_sms_dispatch_operator (canonical incident-first lock discipline)
--    - finalize_customer_location_sms_send_operator (operator-triggered Twilio finalization, preserves terminal failure data)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EVOLVE PHASE 8 customer_location_requests
-- ------------------------------------------------------------------------------

-- Allow automated integration requests to truthfully record created_by = NULL
ALTER TABLE public.customer_location_requests
  ALTER COLUMN created_by DROP NOT NULL;

-- Composite uniqueness constraint for tenant-safe foreign key references from dispatches
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_cust_loc_req_id_org_inc'
  ) THEN
    ALTER TABLE public.customer_location_requests
      ADD CONSTRAINT uq_cust_loc_req_id_org_inc UNIQUE (id, organization_id, incident_id);
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. ORGANIZATION INTEGRATIONS TABLE
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organization_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('vapi', 'twilio')),
  integration_token_hash TEXT NOT NULL,
  inbound_phone_number TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One integration per provider per organization
  CONSTRAINT uq_org_integrations_org_provider UNIQUE (organization_id, provider),

  -- Token hash must map unambiguously to exactly one organization per provider
  CONSTRAINT uq_org_integrations_provider_token_hash UNIQUE (provider, integration_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_org_integrations_hash_prov
  ON public.organization_integrations(provider, integration_token_hash)
  WHERE is_active = true;

ALTER TABLE public.organization_integrations ENABLE ROW LEVEL SECURITY;

-- Explicit fail-closed privileges: no direct access granted to any client role
REVOKE ALL ON public.organization_integrations FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. INTAKE IDEMPOTENCY KEYS TABLE
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.intake_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('vapi')),
  idempotency_key TEXT NOT NULL,
  incident_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_intake_idempotency_org_prov_key UNIQUE (organization_id, provider, idempotency_key),
  CONSTRAINT fk_intake_idempotency_incident_org
    FOREIGN KEY (incident_id, organization_id)
    REFERENCES public.incidents(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_intake_idempotency_lookup
  ON public.intake_idempotency_keys(organization_id, provider, idempotency_key);

ALTER TABLE public.intake_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Explicit fail-closed privileges: no direct access granted to any client role
REVOKE ALL ON public.intake_idempotency_keys FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. CUSTOMER LOCATION SMS DISPATCHES TABLE
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.customer_location_sms_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL,
  request_id UUID NULL,
  idempotency_key TEXT NOT NULL,
  recipient_phone TEXT NOT NULL,
  sender_id TEXT NOT NULL DEFAULT 'MATOSROAD',
  provider_message_sid TEXT NULL,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed')),
  error_code TEXT NULL,
  error_message TEXT NULL,
  dispatched_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unique idempotency per organization
  CONSTRAINT uq_sms_dispatches_org_idempotency UNIQUE (organization_id, idempotency_key),

  -- Provider MessageSid must be unique when present
  CONSTRAINT uq_sms_dispatches_message_sid UNIQUE (provider_message_sid),

  -- Composite tenant boundary matching parent incident
  CONSTRAINT fk_sms_dispatches_incident_org
    FOREIGN KEY (incident_id, organization_id)
    REFERENCES public.incidents(id, organization_id)
    ON DELETE CASCADE,

  -- Composite tenant boundary matching Phase 8 customer location request
  CONSTRAINT fk_sms_dispatches_request_org_inc
    FOREIGN KEY (request_id, organization_id, incident_id)
    REFERENCES public.customer_location_requests(id, organization_id, incident_id)
    ON DELETE CASCADE,

  -- Creator profile must belong to the same organization (nullable for automated sends)
  -- ON DELETE RESTRICT protects the NOT NULL organization_id column from composite nullification
  CONSTRAINT fk_sms_dispatches_profile_org
    FOREIGN KEY (dispatched_by, organization_id)
    REFERENCES public.profiles(id, organization_id)
    ON DELETE RESTRICT,

  -- Database integrity: request_id must be attached prior to entering active provider states
  CONSTRAINT chk_sms_dispatches_request_required
    CHECK (status IN ('reserved', 'failed') OR request_id IS NOT NULL),

  -- Recipient phone must be an E.164-compliant international number (+ followed by 7 to 15 digits)
  CONSTRAINT chk_sms_dispatches_recipient_phone_e164
    CHECK (recipient_phone ~ '^\+[1-9][0-9]{6,14}$')
);

CREATE INDEX IF NOT EXISTS idx_sms_dispatches_incident
  ON public.customer_location_sms_dispatches(incident_id);

CREATE INDEX IF NOT EXISTS idx_sms_dispatches_sid
  ON public.customer_location_sms_dispatches(provider_message_sid)
  WHERE provider_message_sid IS NOT NULL;

ALTER TABLE public.customer_location_sms_dispatches ENABLE ROW LEVEL SECURITY;

-- Explicit fail-closed privileges
REVOKE ALL ON public.customer_location_sms_dispatches FROM PUBLIC, anon, authenticated;

-- Grant read-only SELECT to authenticated operators for auditing their organization
GRANT SELECT ON public.customer_location_sms_dispatches TO authenticated;

CREATE POLICY sms_dispatches_select_operator_admin
  ON public.customer_location_sms_dispatches
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

-- ------------------------------------------------------------------------------
-- 5. REALTIME PUBLICATION REGISTRATION (IDEMPOTENT)
-- ------------------------------------------------------------------------------

DO $$
DECLARE
  v_pub_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) INTO v_pub_exists;

  IF v_pub_exists THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'customer_location_sms_dispatches'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_location_sms_dispatches;
    END IF;
  END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. INTEGRATION RPC: CREATE VOICE INTAKE INCIDENT
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_voice_intake_incident(
  p_integration_secret TEXT,
  p_idempotency_key TEXT,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_location_address TEXT,
  p_service_type TEXT,
  p_priority TEXT,
  p_notes TEXT,
  p_vehicle_make TEXT,
  p_vehicle_model TEXT,
  p_vehicle_year INTEGER,
  p_vehicle_color TEXT,
  p_vehicle_registration TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret_hash TEXT;
  v_org_id UUID;
  v_clean_key TEXT;
  v_existing_incident_id UUID;
  v_existing_ref TEXT;
  v_existing_status TEXT;
  v_service_type TEXT;
  v_priority TEXT;
  v_cap_code TEXT;
  v_required_capability_id UUID;
  v_reference_number TEXT;
  v_incident_id UUID;
  v_created_at TIMESTAMPTZ;
  v_event_id UUID;
BEGIN
  -- 1. Validate integration secret parameter
  IF p_integration_secret IS NULL OR length(trim(p_integration_secret)) = 0 THEN
    RAISE EXCEPTION 'Integration secret is required';
  END IF;

  v_secret_hash := encode(extensions.digest(trim(p_integration_secret), 'sha256'), 'hex');

  -- 2. Authenticate provider='vapi' and derive authoritative organization (guaranteed unique by uq_org_integrations_provider_token_hash)
  SELECT organization_id
  INTO v_org_id
  FROM public.organization_integrations
  WHERE provider = 'vapi'
    AND integration_token_hash = v_secret_hash
    AND is_active = true;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: invalid or inactive Vapi integration credential';
  END IF;

  -- 3. Validate idempotency key format
  v_clean_key := trim(p_idempotency_key);
  IF v_clean_key IS NULL OR length(v_clean_key) = 0 THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;

  -- 4. Exactly-once concurrency: transaction-scoped advisory lock based on org + provider + key
  PERFORM pg_advisory_xact_lock(hashtext(v_org_id::text || ':vapi:' || v_clean_key));

  -- 5. Re-check idempotency table inside the exclusive lock: retrieve ACTUAL stored incident.status
  SELECT k.incident_id, i.reference_number, i.status
  INTO v_existing_incident_id, v_existing_ref, v_existing_status
  FROM public.intake_idempotency_keys k
  JOIN public.incidents i ON i.id = k.incident_id
  WHERE k.organization_id = v_org_id
    AND k.provider = 'vapi'
    AND k.idempotency_key = v_clean_key;

  IF v_existing_incident_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'incident_id', v_existing_incident_id,
      'reference_number', v_existing_ref,
      'status', v_existing_status,
      'is_duplicate', true
    );
  END IF;

  -- 6. Validate mandatory caller fields
  IF p_customer_name IS NULL OR length(trim(p_customer_name)) = 0 THEN
    RAISE EXCEPTION 'Customer name is required';
  END IF;

  IF p_customer_phone IS NULL OR length(trim(p_customer_phone)) = 0 THEN
    RAISE EXCEPTION 'Customer phone is required';
  END IF;

  IF p_location_address IS NULL OR length(trim(p_location_address)) = 0 THEN
    RAISE EXCEPTION 'Location address is required';
  END IF;

  -- 7. Validate and normalize service_type to locked Phase 2 types
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

  -- 8. Validate and normalize priority to locked Phase 2 priorities
  v_priority := COALESCE(NULLIF(trim(p_priority), ''), 'standard');
  IF v_priority NOT IN ('low', 'standard', 'high', 'critical') THEN
    RAISE EXCEPTION 'Invalid priority: %', v_priority;
  END IF;

  -- 9. Validate vehicle year if provided
  IF p_vehicle_year IS NOT NULL THEN
    IF p_vehicle_year < 1900 OR p_vehicle_year > 2100 THEN
      RAISE EXCEPTION 'Vehicle year must be between 1900 and 2100';
    END IF;
  END IF;

  -- 10. Canonical capability mapping to Phase 3 catalogue for Phase 6 dispatch engine
  v_cap_code := CASE v_service_type
    WHEN 'towing'             THEN 'towing'
    WHEN 'jump_start'         THEN 'jump_start'
    WHEN 'lockout'            THEN 'lockout'
    WHEN 'fuel_delivery'      THEN 'fuel_delivery'
    WHEN 'winch_recovery'     THEN 'winch_recovery'
    WHEN 'general_assistance' THEN 'general_assistance'
    WHEN 'tire_change'        THEN 'tire_assistance'
    ELSE NULL
  END;

  SELECT id INTO v_required_capability_id
  FROM public.service_capabilities
  WHERE code = v_cap_code AND is_active = true;

  IF v_required_capability_id IS NULL THEN
    RAISE EXCEPTION 'Active required capability could not be resolved for service type: %', v_service_type;
  END IF;

  -- 11. Generate human-readable reference number
  v_reference_number := public.generate_incident_reference_number(v_org_id);

  -- 12. Insert incident (status = 'new', location_source = 'telephony_intake', created_by = NULL)
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
    v_org_id,
    v_reference_number,
    'new',
    v_priority,
    v_service_type,
    trim(p_customer_name),
    trim(p_customer_phone),
    trim(p_location_address),
    NULL,
    NULL,
    'telephony_intake',
    nullif(trim(p_vehicle_registration), ''),
    nullif(trim(p_vehicle_make), ''),
    nullif(trim(p_vehicle_model), ''),
    p_vehicle_year,
    nullif(trim(p_vehicle_color), ''),
    v_required_capability_id,
    nullif(trim(p_notes), ''),
    NULL
  ) RETURNING id, created_at INTO v_incident_id, v_created_at;

  -- 13. Atomically record idempotency key
  INSERT INTO public.intake_idempotency_keys (
    organization_id,
    provider,
    idempotency_key,
    incident_id
  ) VALUES (
    v_org_id,
    'vapi',
    v_clean_key,
    v_incident_id
  );

  -- 14. Atomically write operational event
  INSERT INTO public.operational_events (
    organization_id,
    entity_type,
    entity_id,
    event_type,
    actor_id,
    metadata
  ) VALUES (
    v_org_id,
    'incident',
    v_incident_id,
    'VOICE_INCIDENT_CREATED',
    NULL,
    jsonb_build_object(
      'intake_channel', 'vapi_voice',
      'reference_number', v_reference_number,
      'service_type', v_service_type,
      'priority', v_priority,
      'location_source', 'telephony_intake',
      'required_capability_id', v_required_capability_id,
      'idempotency_key', v_clean_key
    )
  ) RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'success', true,
    'incident_id', v_incident_id,
    'reference_number', v_reference_number,
    'status', 'new',
    'is_duplicate', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_voice_intake_incident(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_voice_intake_incident(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT
) TO anon;

-- ------------------------------------------------------------------------------
-- 7. INTEGRATION RPC: CREATE AUTOMATED CUSTOMER LOCATION REQUEST
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_automated_customer_location_request(
  p_integration_secret TEXT,
  p_incident_id UUID,
  p_dispatch_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret_hash TEXT;
  v_org_id UUID;
  v_incident_status TEXT;
  v_disp_id UUID;
  v_disp_status TEXT;
  v_disp_req_id UUID;
  v_raw_token TEXT;
  v_token_hash TEXT;
  v_expires_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_request_id UUID;
BEGIN
  -- 1. Validate integration secret and derive organization
  IF p_integration_secret IS NULL OR length(trim(p_integration_secret)) = 0 THEN
    RAISE EXCEPTION 'Integration secret is required';
  END IF;

  v_secret_hash := encode(extensions.digest(trim(p_integration_secret), 'sha256'), 'hex');

  SELECT organization_id
  INTO v_org_id
  FROM public.organization_integrations
  WHERE provider = 'vapi'
    AND integration_token_hash = v_secret_hash
    AND is_active = true;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: invalid or inactive Vapi integration credential';
  END IF;

  -- 2. Lock target incident first (enforces canonical lock order)
  SELECT status
  INTO v_incident_status
  FROM public.incidents
  WHERE id = p_incident_id
    AND organization_id = v_org_id
  FOR UPDATE;

  IF v_incident_status IS NULL THEN
    RAISE EXCEPTION 'Incident not found in organization';
  END IF;

  IF v_incident_status IN ('completed', 'cancelled', 'unable_to_complete') THEN
    RAISE EXCEPTION 'Cannot generate location link for terminal incident (%)', v_incident_status;
  END IF;

  -- 3. Lock SMS dispatch reservation row FOR UPDATE
  SELECT id, status, request_id
  INTO v_disp_id, v_disp_status, v_disp_req_id
  FROM public.customer_location_sms_dispatches
  WHERE id = p_dispatch_id
    AND organization_id = v_org_id
    AND incident_id = p_incident_id
  FOR UPDATE;

  IF v_disp_id IS NULL THEN
    RAISE EXCEPTION 'Matching SMS dispatch reservation not found';
  END IF;

  IF v_disp_status <> 'reserved' THEN
    RAISE EXCEPTION 'Dispatch reservation is not in reserved status (current: %)', v_disp_status;
  END IF;

  IF v_disp_req_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dispatch reservation already has a location request attached';
  END IF;

  -- 4. Revoke previous active unused requests for this incident
  UPDATE public.customer_location_requests
  SET revoked_at = v_now
  WHERE incident_id = p_incident_id
    AND organization_id = v_org_id
    AND used_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > v_now;

  -- 5. Generate 32 secure random bytes (64 hex characters) and hash with SHA-256
  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := v_now + interval '1 hour';

  -- 6. Insert into customer_location_requests with created_by = NULL (no human actor fabrication)
  INSERT INTO public.customer_location_requests (
    organization_id,
    incident_id,
    token_hash,
    expires_at,
    created_by,
    created_at
  ) VALUES (
    v_org_id,
    p_incident_id,
    v_token_hash,
    v_expires_at,
    NULL,
    v_now
  ) RETURNING id INTO v_request_id;

  -- 7. Atomically attach the newly created request to the reserved dispatch
  UPDATE public.customer_location_sms_dispatches
  SET request_id = v_request_id,
      updated_at = v_now
  WHERE id = p_dispatch_id;

  -- 8. Return server-only link payload (raw token returned once only, never persisted)
  RETURN jsonb_build_object(
    'success', true,
    'token', v_raw_token,
    'request_id', v_request_id,
    'expires_at', v_expires_at,
    'relative_path', '/customer/location/' || v_raw_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_automated_customer_location_request(TEXT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_automated_customer_location_request(TEXT, UUID, UUID) TO anon;

-- ------------------------------------------------------------------------------
-- 8. INTEGRATION RPC: RESERVE CUSTOMER LOCATION SMS (INTEGRATION)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reserve_customer_location_sms_integration(
  p_integration_secret TEXT,
  p_incident_id UUID,
  p_idempotency_key TEXT,
  p_recipient_phone TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret_hash TEXT;
  v_org_id UUID;
  v_incident_status TEXT;
  v_clean_key TEXT;
  v_clean_phone TEXT;
  v_dispatch_id UUID;
  v_existing_id UUID;
  v_existing_status TEXT;
  v_existing_sid TEXT;
BEGIN
  -- 1. Validate integration secret and derive organization
  IF p_integration_secret IS NULL OR length(trim(p_integration_secret)) = 0 THEN
    RAISE EXCEPTION 'Integration secret is required';
  END IF;

  v_secret_hash := encode(extensions.digest(trim(p_integration_secret), 'sha256'), 'hex');

  SELECT organization_id
  INTO v_org_id
  FROM public.organization_integrations
  WHERE provider = 'vapi'
    AND integration_token_hash = v_secret_hash
    AND is_active = true;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: invalid or inactive Vapi integration credential';
  END IF;

  -- 2. Validate incident exists and is non-terminal
  SELECT status INTO v_incident_status
  FROM public.incidents
  WHERE id = p_incident_id
    AND organization_id = v_org_id;

  IF v_incident_status IS NULL THEN
    RAISE EXCEPTION 'Incident not found in organization';
  END IF;

  IF v_incident_status IN ('completed', 'cancelled', 'unable_to_complete') THEN
    RAISE EXCEPTION 'Cannot dispatch SMS for terminal incident (%)', v_incident_status;
  END IF;

  -- 3. Validate phone and idempotency key
  v_clean_key := trim(p_idempotency_key);
  v_clean_phone := trim(p_recipient_phone);

  IF v_clean_key IS NULL OR length(v_clean_key) = 0 THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;

  IF v_clean_phone IS NULL OR NOT (v_clean_phone ~ '^\+[1-9][0-9]{6,14}$') THEN
    RAISE EXCEPTION 'Recipient phone must be a valid E.164 number (e.g. +35699123456)';
  END IF;

  -- 4. Atomic Reserve-Before-Send: INSERT ... ON CONFLICT DO NOTHING
  INSERT INTO public.customer_location_sms_dispatches (
    organization_id,
    incident_id,
    request_id,
    idempotency_key,
    recipient_phone,
    sender_id,
    status,
    dispatched_by
  ) VALUES (
    v_org_id,
    p_incident_id,
    NULL,
    v_clean_key,
    v_clean_phone,
    'MATOSROAD',
    'reserved',
    NULL
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_dispatch_id;

  -- 5. If new reservation owner: proceed to token generation and outbound API call
  IF v_dispatch_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reserved', true,
      'dispatch_id', v_dispatch_id
    );
  END IF;

  -- 6. If reservation conflict occurred: select existing dispatch and prevent duplicate send
  SELECT id, status, provider_message_sid
  INTO v_existing_id, v_existing_status, v_existing_sid
  FROM public.customer_location_sms_dispatches
  WHERE organization_id = v_org_id
    AND idempotency_key = v_clean_key;

  RETURN jsonb_build_object(
    'reserved', false,
    'dispatch_id', v_existing_id,
    'existing_status', v_existing_status,
    'message_sid', v_existing_sid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_customer_location_sms_integration(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_customer_location_sms_integration(TEXT, UUID, TEXT, TEXT) TO anon;

-- ------------------------------------------------------------------------------
-- 9. OPERATOR RPC: RESERVE CUSTOMER LOCATION SMS (OPERATOR)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reserve_customer_location_sms_operator(
  p_incident_id UUID,
  p_idempotency_key TEXT,
  p_recipient_phone TEXT
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
  v_incident_status TEXT;
  v_clean_key TEXT;
  v_clean_phone TEXT;
  v_dispatch_id UUID;
  v_existing_id UUID;
  v_existing_status TEXT;
  v_existing_sid TEXT;
BEGIN
  -- 1. Derive authenticated caller identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to reserve SMS dispatch';
  END IF;

  SELECT p.organization_id, p.role, p.is_active
  INTO v_caller_org, v_caller_role, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_caller_uid;

  IF v_caller_org IS NULL OR NOT v_profile_active THEN
    RAISE EXCEPTION 'Active operator profile not found';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Unauthorized: only admins and operators can dispatch location SMS';
  END IF;

  -- 2. Validate incident exists in caller organization and is non-terminal
  SELECT status INTO v_incident_status
  FROM public.incidents
  WHERE id = p_incident_id
    AND organization_id = v_caller_org;

  IF v_incident_status IS NULL THEN
    RAISE EXCEPTION 'Incident not found in organization';
  END IF;

  IF v_incident_status IN ('completed', 'cancelled', 'unable_to_complete') THEN
    RAISE EXCEPTION 'Cannot dispatch SMS for terminal incident (%)', v_incident_status;
  END IF;

  -- 3. Validate phone and idempotency key
  v_clean_key := trim(p_idempotency_key);
  v_clean_phone := trim(p_recipient_phone);

  IF v_clean_key IS NULL OR length(v_clean_key) = 0 THEN
    RAISE EXCEPTION 'Idempotency key is required';
  END IF;

  IF v_clean_phone IS NULL OR NOT (v_clean_phone ~ '^\+[1-9][0-9]{6,14}$') THEN
    RAISE EXCEPTION 'Recipient phone must be a valid E.164 number (e.g. +35699123456)';
  END IF;

  -- 4. Atomic Reserve-Before-Send: INSERT ... ON CONFLICT DO NOTHING
  INSERT INTO public.customer_location_sms_dispatches (
    organization_id,
    incident_id,
    request_id,
    idempotency_key,
    recipient_phone,
    sender_id,
    status,
    dispatched_by
  ) VALUES (
    v_caller_org,
    p_incident_id,
    NULL,
    v_clean_key,
    v_clean_phone,
    'MATOSROAD',
    'reserved',
    v_caller_uid
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_dispatch_id;

  -- 5. If new reservation owner: proceed
  IF v_dispatch_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reserved', true,
      'dispatch_id', v_dispatch_id
    );
  END IF;

  -- 6. If duplicate: return existing reservation state
  SELECT id, status, provider_message_sid
  INTO v_existing_id, v_existing_status, v_existing_sid
  FROM public.customer_location_sms_dispatches
  WHERE organization_id = v_caller_org
    AND idempotency_key = v_clean_key;

  RETURN jsonb_build_object(
    'reserved', false,
    'dispatch_id', v_existing_id,
    'existing_status', v_existing_status,
    'message_sid', v_existing_sid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_customer_location_sms_operator(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_customer_location_sms_operator(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. OPERATOR RPC: ATTACH CUSTOMER LOCATION REQUEST TO SMS DISPATCH
-- Canonical lock order: 1. Incident -> 2. Customer Location Request -> 3. SMS Dispatch
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.attach_customer_location_request_to_sms_dispatch_operator(
  p_dispatch_id UUID,
  p_token TEXT
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
  v_token_hash TEXT;
  v_req_id UUID;
  v_incident_id UUID;
  v_incident_status TEXT;
  v_expires_at TIMESTAMPTZ;
  v_used_at TIMESTAMPTZ;
  v_revoked_at TIMESTAMPTZ;
  v_created_by UUID;
  v_req_incident_id UUID;
  v_disp_id UUID;
  v_disp_incident_id UUID;
  v_disp_status TEXT;
  v_disp_req_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Validate caller session & operator authorization
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.organization_id, p.role, p.is_active
  INTO v_caller_org, v_caller_role, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_caller_uid;

  IF v_caller_org IS NULL OR NOT v_profile_active THEN
    RAISE EXCEPTION 'Active profile not found';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Unauthorized: only admins and operators can attach location links to dispatches';
  END IF;

  -- 2. Validate token format (64 hex characters) and compute SHA-256 hash
  IF p_token IS NULL OR length(trim(p_token)) != 64 OR NOT (p_token ~ '^[0-9a-fA-F]{64}$') THEN
    RAISE EXCEPTION 'Invalid location link token';
  END IF;

  v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  -- 3. Non-locking lookup to identify request id and incident id
  SELECT id, incident_id
  INTO v_req_id, v_incident_id
  FROM public.customer_location_requests
  WHERE token_hash = v_token_hash
    AND organization_id = v_caller_org;

  IF v_req_id IS NULL THEN
    RAISE EXCEPTION 'Location request not found';
  END IF;

  -- 4. CANONICAL LOCK ORDER: Lock 1 — INCIDENT row FOR UPDATE first
  SELECT status
  INTO v_incident_status
  FROM public.incidents
  WHERE id = v_incident_id
    AND organization_id = v_caller_org
  FOR UPDATE;

  IF v_incident_status IS NULL THEN
    RAISE EXCEPTION 'Associated incident not found in caller organization';
  END IF;

  IF v_incident_status IN ('completed', 'cancelled', 'unable_to_complete') THEN
    RAISE EXCEPTION 'Cannot attach location link for terminal incident (%)', v_incident_status;
  END IF;

  -- 5. CANONICAL LOCK ORDER: Lock 2 — customer_location_requests row FOR UPDATE
  SELECT expires_at, used_at, revoked_at, created_by, incident_id
  INTO v_expires_at, v_used_at, v_revoked_at, v_created_by, v_req_incident_id
  FROM public.customer_location_requests
  WHERE id = v_req_id
    AND organization_id = v_caller_org
    AND token_hash = v_token_hash
  FOR UPDATE;

  -- 6. Revalidate request state AFTER acquiring lock
  IF v_expires_at IS NULL THEN
    RAISE EXCEPTION 'Location request not found or invalid';
  END IF;

  IF v_created_by IS NULL OR v_created_by <> v_caller_uid THEN
    RAISE EXCEPTION 'Location request does not belong to current operator';
  END IF;

  IF v_used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Location request has already been used';
  END IF;

  IF v_revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Location request has been revoked';
  END IF;

  IF v_expires_at <= v_now THEN
    RAISE EXCEPTION 'Location request has expired';
  END IF;

  -- 7. CANONICAL LOCK ORDER: Lock 3 — SMS dispatch reservation row FOR UPDATE
  SELECT id, incident_id, status, request_id
  INTO v_disp_id, v_disp_incident_id, v_disp_status, v_disp_req_id
  FROM public.customer_location_sms_dispatches
  WHERE id = p_dispatch_id
    AND organization_id = v_caller_org
  FOR UPDATE;

  IF v_disp_id IS NULL THEN
    RAISE EXCEPTION 'SMS dispatch reservation not found';
  END IF;

  -- 8. Validate dispatch integrity
  IF v_disp_incident_id <> v_incident_id THEN
    RAISE EXCEPTION 'Incident mismatch between dispatch and location request';
  END IF;

  IF v_disp_status <> 'reserved' THEN
    RAISE EXCEPTION 'Dispatch is not in reserved status (current: %)', v_disp_status;
  END IF;

  IF v_disp_req_id IS NOT NULL THEN
    RAISE EXCEPTION 'Dispatch already has a location request attached';
  END IF;

  -- 9. Attach request_id to dispatch
  UPDATE public.customer_location_sms_dispatches
  SET request_id = v_req_id,
      updated_at = v_now
  WHERE id = p_dispatch_id;

  RETURN jsonb_build_object(
    'success', true,
    'request_id', v_req_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attach_customer_location_request_to_sms_dispatch_operator(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_customer_location_request_to_sms_dispatch_operator(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 11. INTEGRATION RPC: FINALIZE CUSTOMER LOCATION SMS SEND (INTEGRATION)
-- Non-regressing, idempotent finalization for automated Vapi flow
-- Preserves terminal Twilio failure and delivery status and error metadata
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_customer_location_sms_send_integration(
  p_integration_secret TEXT,
  p_dispatch_id UUID,
  p_message_sid TEXT,
  p_status TEXT,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret_hash TEXT;
  v_org_id UUID;
  v_disp_id UUID;
  v_disp_req_id UUID;
  v_disp_status TEXT;
  v_disp_sid TEXT;
  v_incident_id UUID;
  v_clean_sid TEXT;
  v_clean_status TEXT;
  v_current_rank INTEGER;
  v_new_rank INTEGER;
  v_final_status TEXT;
  v_event_exists BOOLEAN;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Validate integration secret and derive organization
  IF p_integration_secret IS NULL OR length(trim(p_integration_secret)) = 0 THEN
    RAISE EXCEPTION 'Integration secret is required';
  END IF;

  v_secret_hash := encode(extensions.digest(trim(p_integration_secret), 'sha256'), 'hex');

  SELECT organization_id
  INTO v_org_id
  FROM public.organization_integrations
  WHERE provider = 'vapi'
    AND integration_token_hash = v_secret_hash
    AND is_active = true;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: invalid or inactive Vapi integration credential';
  END IF;

  -- 2. Validate status parameter against whitelist
  v_clean_status := trim(p_status);
  IF v_clean_status NOT IN ('accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed') THEN
    RAISE EXCEPTION 'Invalid SMS status: %', v_clean_status;
  END IF;

  v_clean_sid := nullif(trim(p_message_sid), '');

  -- 3. Lock dispatch row FOR UPDATE
  SELECT id, incident_id, request_id, status, provider_message_sid
  INTO v_disp_id, v_incident_id, v_disp_req_id, v_disp_status, v_disp_sid
  FROM public.customer_location_sms_dispatches
  WHERE id = p_dispatch_id
    AND organization_id = v_org_id
  FOR UPDATE;

  IF v_disp_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch record not found';
  END IF;

  -- 4. Calculate monotonic ranks
  v_current_rank := CASE v_disp_status
    WHEN 'reserved'    THEN 0
    WHEN 'accepted'    THEN 1
    WHEN 'queued'      THEN 2
    WHEN 'sending'     THEN 3
    WHEN 'sent'        THEN 4
    WHEN 'delivered'   THEN 100
    WHEN 'undelivered' THEN 100
    WHEN 'failed'      THEN 100
    ELSE -1
  END;

  v_new_rank := CASE v_clean_status
    WHEN 'accepted'    THEN 1
    WHEN 'queued'      THEN 2
    WHEN 'sending'     THEN 3
    WHEN 'sent'        THEN 4
    WHEN 'delivered'   THEN 100
    WHEN 'undelivered' THEN 100
    WHEN 'failed'      THEN 100
    ELSE -1
  END;

  -- ----------------------------------------------------------------------------
  -- BRANCH A: FAILED FINALIZATION (p_status = 'failed')
  -- ----------------------------------------------------------------------------
  IF v_clean_status = 'failed' THEN
    -- If already failed: idempotent return without duplicate audit event
    IF v_disp_status = 'failed' THEN
      RETURN jsonb_build_object(
        'success', true,
        'is_duplicate', true,
        'status', 'failed'
      );
    END IF;

    -- If provider_message_sid is already present OR current state has progressed beyond reserved:
    -- DO NOT overwrite with failed (handles race where Twilio accepted message before HTTP loss)
    IF v_disp_sid IS NOT NULL OR v_current_rank > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'is_duplicate', true,
        'status', v_disp_status,
        'reason', 'already_progressed_beyond_reserved'
      );
    END IF;

    -- Transition once to failed (from reserved with provider_message_sid IS NULL)
    UPDATE public.customer_location_sms_dispatches
    SET status = 'failed',
        error_code = nullif(trim(p_error_code), ''),
        error_message = nullif(trim(p_error_message), ''),
        updated_at = v_now
    WHERE id = p_dispatch_id;

    -- Ensure CUSTOMER_LOCATION_SMS_FAILED is emitted AT MOST ONCE per dispatch
    SELECT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE organization_id = v_org_id
        AND entity_type = 'incident'
        AND entity_id = v_incident_id
        AND event_type = 'CUSTOMER_LOCATION_SMS_FAILED'
        AND (metadata->>'dispatch_id') = p_dispatch_id::text
    ) INTO v_event_exists;

    IF NOT v_event_exists THEN
      INSERT INTO public.operational_events (
        organization_id,
        entity_type,
        entity_id,
        event_type,
        actor_id,
        metadata
      ) VALUES (
        v_org_id,
        'incident',
        v_incident_id,
        'CUSTOMER_LOCATION_SMS_FAILED',
        NULL,
        jsonb_build_object(
          'provider', 'twilio',
          'sender_id', 'MATOSROAD',
          'dispatch_id', p_dispatch_id,
          'error_code', nullif(trim(p_error_code), ''),
          'error_message', nullif(trim(p_error_message), '')
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'failed'
    );
  END IF;

  -- ----------------------------------------------------------------------------
  -- BRANCH B: SUCCESSFUL FINALIZATION (p_status <> 'failed')
  -- ----------------------------------------------------------------------------
  IF v_clean_sid IS NULL THEN
    RAISE EXCEPTION 'MessageSid is required for non-failed SMS finalization';
  END IF;

  -- Conflicting MessageSid fails closed
  IF v_disp_sid IS NOT NULL AND v_disp_sid <> v_clean_sid THEN
    RAISE EXCEPTION 'Conflicting MessageSid already recorded for dispatch %: expected %, received %',
      p_dispatch_id, v_disp_sid, v_clean_sid;
  END IF;

  IF v_disp_req_id IS NULL THEN
    RAISE EXCEPTION 'Cannot finalize active SMS send without request_id attached';
  END IF;

  -- If current stored status is terminal (delivered, undelivered, failed):
  -- MUST NOT change status, MUST NOT clear error_code/error_message, MUST NOT regress terminal state.
  IF v_current_rank = 100 THEN
    -- If MessageSid was not recorded yet (e.g. callback arrived before REST return), attach it safely
    IF v_disp_sid IS NULL THEN
      UPDATE public.customer_location_sms_dispatches
      SET provider_message_sid = v_clean_sid,
          updated_at = v_now
      WHERE id = p_dispatch_id;
    END IF;

    -- Ensure CUSTOMER_LOCATION_SMS_ACCEPTED is emitted AT MOST ONCE per dispatch
    SELECT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE organization_id = v_org_id
        AND entity_type = 'incident'
        AND entity_id = v_incident_id
        AND event_type = 'CUSTOMER_LOCATION_SMS_ACCEPTED'
        AND (
          (metadata->>'dispatch_id') = p_dispatch_id::text
          OR (metadata->>'message_sid') = v_clean_sid
        )
    ) INTO v_event_exists;

    IF NOT v_event_exists THEN
      INSERT INTO public.operational_events (
        organization_id,
        entity_type,
        entity_id,
        event_type,
        actor_id,
        metadata
      ) VALUES (
        v_org_id,
        'incident',
        v_incident_id,
        'CUSTOMER_LOCATION_SMS_ACCEPTED',
        NULL,
        jsonb_build_object(
          'provider', 'twilio',
          'sender_id', 'MATOSROAD',
          'dispatch_id', p_dispatch_id,
          'message_sid', v_clean_sid,
          'request_id', v_disp_req_id,
          'initial_status', v_clean_status
        )
      );
    END IF;

    -- Return the existing terminal state truthfully
    RETURN jsonb_build_object(
      'success', true,
      'status', v_disp_status,
      'message_sid', v_clean_sid,
      'is_duplicate', true
    );
  END IF;

  -- Monotonic state preservation for non-terminal states:
  -- If callback already advanced status beyond the API-return status, preserve the callback-advanced status.
  -- Otherwise advance to v_clean_status.
  IF v_current_rank >= v_new_rank AND v_current_rank > 0 THEN
    v_final_status := v_disp_status;
  ELSE
    v_final_status := v_clean_status;
  END IF;

  UPDATE public.customer_location_sms_dispatches
  SET provider_message_sid = v_clean_sid,
      status = v_final_status,
      error_code = NULL,
      error_message = NULL,
      updated_at = v_now
  WHERE id = p_dispatch_id;

  -- Ensure CUSTOMER_LOCATION_SMS_ACCEPTED is emitted AT MOST ONCE per dispatch
  SELECT EXISTS (
    SELECT 1 FROM public.operational_events
    WHERE organization_id = v_org_id
      AND entity_type = 'incident'
      AND entity_id = v_incident_id
      AND event_type = 'CUSTOMER_LOCATION_SMS_ACCEPTED'
      AND (
        (metadata->>'dispatch_id') = p_dispatch_id::text
        OR (metadata->>'message_sid') = v_clean_sid
      )
  ) INTO v_event_exists;

  IF NOT v_event_exists THEN
    INSERT INTO public.operational_events (
      organization_id,
      entity_type,
      entity_id,
      event_type,
      actor_id,
      metadata
    ) VALUES (
      v_org_id,
      'incident',
      v_incident_id,
      'CUSTOMER_LOCATION_SMS_ACCEPTED',
      NULL,
      jsonb_build_object(
        'provider', 'twilio',
        'sender_id', 'MATOSROAD',
        'dispatch_id', p_dispatch_id,
        'message_sid', v_clean_sid,
        'request_id', v_disp_req_id,
        'initial_status', v_clean_status
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_final_status,
    'message_sid', v_clean_sid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_customer_location_sms_send_integration(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_customer_location_sms_send_integration(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO anon;

-- ------------------------------------------------------------------------------
-- 12. OPERATOR RPC: FINALIZE CUSTOMER LOCATION SMS SEND (OPERATOR)
-- Non-regressing, idempotent finalization for operator UI flow
-- Preserves terminal Twilio failure and delivery status and error metadata
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.finalize_customer_location_sms_send_operator(
  p_dispatch_id UUID,
  p_message_sid TEXT,
  p_status TEXT,
  p_error_code TEXT,
  p_error_message TEXT
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
  v_disp_id UUID;
  v_disp_req_id UUID;
  v_disp_status TEXT;
  v_disp_sid TEXT;
  v_incident_id UUID;
  v_clean_sid TEXT;
  v_clean_status TEXT;
  v_current_rank INTEGER;
  v_new_rank INTEGER;
  v_final_status TEXT;
  v_event_exists BOOLEAN;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Derive authenticated operator identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT p.organization_id, p.role, p.is_active
  INTO v_caller_org, v_caller_role, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_caller_uid;

  IF v_caller_org IS NULL OR NOT v_profile_active THEN
    RAISE EXCEPTION 'Active profile not found';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Validate status parameter against whitelist
  v_clean_status := trim(p_status);
  IF v_clean_status NOT IN ('accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed') THEN
    RAISE EXCEPTION 'Invalid SMS status: %', v_clean_status;
  END IF;

  v_clean_sid := nullif(trim(p_message_sid), '');

  -- 3. Lock dispatch row FOR UPDATE
  SELECT id, incident_id, request_id, status, provider_message_sid
  INTO v_disp_id, v_incident_id, v_disp_req_id, v_disp_status, v_disp_sid
  FROM public.customer_location_sms_dispatches
  WHERE id = p_dispatch_id
    AND organization_id = v_caller_org
  FOR UPDATE;

  IF v_disp_id IS NULL THEN
    RAISE EXCEPTION 'Dispatch record not found';
  END IF;

  -- 4. Calculate monotonic ranks
  v_current_rank := CASE v_disp_status
    WHEN 'reserved'    THEN 0
    WHEN 'accepted'    THEN 1
    WHEN 'queued'      THEN 2
    WHEN 'sending'     THEN 3
    WHEN 'sent'        THEN 4
    WHEN 'delivered'   THEN 100
    WHEN 'undelivered' THEN 100
    WHEN 'failed'      THEN 100
    ELSE -1
  END;

  v_new_rank := CASE v_clean_status
    WHEN 'accepted'    THEN 1
    WHEN 'queued'      THEN 2
    WHEN 'sending'     THEN 3
    WHEN 'sent'        THEN 4
    WHEN 'delivered'   THEN 100
    WHEN 'undelivered' THEN 100
    WHEN 'failed'      THEN 100
    ELSE -1
  END;

  -- ----------------------------------------------------------------------------
  -- BRANCH A: FAILED FINALIZATION (p_status = 'failed')
  -- ----------------------------------------------------------------------------
  IF v_clean_status = 'failed' THEN
    -- If already failed: idempotent return without duplicate audit event
    IF v_disp_status = 'failed' THEN
      RETURN jsonb_build_object(
        'success', true,
        'is_duplicate', true,
        'status', 'failed'
      );
    END IF;

    -- If provider_message_sid is already present OR current state has progressed beyond reserved:
    -- DO NOT overwrite with failed
    IF v_disp_sid IS NOT NULL OR v_current_rank > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'is_duplicate', true,
        'status', v_disp_status,
        'reason', 'already_progressed_beyond_reserved'
      );
    END IF;

    -- Transition once to failed
    UPDATE public.customer_location_sms_dispatches
    SET status = 'failed',
        error_code = nullif(trim(p_error_code), ''),
        error_message = nullif(trim(p_error_message), ''),
        updated_at = v_now
    WHERE id = p_dispatch_id;

    -- Ensure CUSTOMER_LOCATION_SMS_FAILED is emitted AT MOST ONCE per dispatch
    SELECT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE organization_id = v_caller_org
        AND entity_type = 'incident'
        AND entity_id = v_incident_id
        AND event_type = 'CUSTOMER_LOCATION_SMS_FAILED'
        AND (metadata->>'dispatch_id') = p_dispatch_id::text
    ) INTO v_event_exists;

    IF NOT v_event_exists THEN
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
        'CUSTOMER_LOCATION_SMS_FAILED',
        v_caller_uid,
        jsonb_build_object(
          'provider', 'twilio',
          'sender_id', 'MATOSROAD',
          'dispatch_id', p_dispatch_id,
          'error_code', nullif(trim(p_error_code), ''),
          'error_message', nullif(trim(p_error_message), '')
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'failed'
    );
  END IF;

  -- ----------------------------------------------------------------------------
  -- BRANCH B: SUCCESSFUL FINALIZATION (p_status <> 'failed')
  -- ----------------------------------------------------------------------------
  IF v_clean_sid IS NULL THEN
    RAISE EXCEPTION 'MessageSid is required';
  END IF;

  -- Conflicting MessageSid fails closed
  IF v_disp_sid IS NOT NULL AND v_disp_sid <> v_clean_sid THEN
    RAISE EXCEPTION 'Conflicting MessageSid already recorded for dispatch %: expected %, received %',
      p_dispatch_id, v_disp_sid, v_clean_sid;
  END IF;

  IF v_disp_req_id IS NULL THEN
    RAISE EXCEPTION 'Cannot finalize active SMS send without request_id attached';
  END IF;

  -- If current stored status is terminal (delivered, undelivered, failed):
  -- MUST NOT change status, MUST NOT clear error_code/error_message, MUST NOT regress terminal state.
  IF v_current_rank = 100 THEN
    -- If MessageSid was not recorded yet, attach it safely without touching terminal status or error metadata
    IF v_disp_sid IS NULL THEN
      UPDATE public.customer_location_sms_dispatches
      SET provider_message_sid = v_clean_sid,
          updated_at = v_now
      WHERE id = p_dispatch_id;
    END IF;

    -- Ensure CUSTOMER_LOCATION_SMS_ACCEPTED is emitted AT MOST ONCE per dispatch
    SELECT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE organization_id = v_caller_org
        AND entity_type = 'incident'
        AND entity_id = v_incident_id
        AND event_type = 'CUSTOMER_LOCATION_SMS_ACCEPTED'
        AND (
          (metadata->>'dispatch_id') = p_dispatch_id::text
          OR (metadata->>'message_sid') = v_clean_sid
        )
    ) INTO v_event_exists;

    IF NOT v_event_exists THEN
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
        'CUSTOMER_LOCATION_SMS_ACCEPTED',
        v_caller_uid,
        jsonb_build_object(
          'provider', 'twilio',
          'sender_id', 'MATOSROAD',
          'dispatch_id', p_dispatch_id,
          'message_sid', v_clean_sid,
          'request_id', v_disp_req_id,
          'initial_status', v_clean_status
        )
      );
    END IF;

    -- Return the existing terminal state truthfully
    RETURN jsonb_build_object(
      'success', true,
      'status', v_disp_status,
      'message_sid', v_clean_sid,
      'is_duplicate', true
    );
  END IF;

  -- Monotonic state preservation: preserve callback-advanced/terminal state
  IF v_current_rank >= v_new_rank AND v_current_rank > 0 THEN
    v_final_status := v_disp_status;
  ELSE
    v_final_status := v_clean_status;
  END IF;

  UPDATE public.customer_location_sms_dispatches
  SET provider_message_sid = v_clean_sid,
      status = v_final_status,
      error_code = NULL,
      error_message = NULL,
      updated_at = v_now
  WHERE id = p_dispatch_id;

  -- Ensure CUSTOMER_LOCATION_SMS_ACCEPTED is emitted AT MOST ONCE per dispatch
  SELECT EXISTS (
    SELECT 1 FROM public.operational_events
    WHERE organization_id = v_caller_org
      AND entity_type = 'incident'
      AND entity_id = v_incident_id
      AND event_type = 'CUSTOMER_LOCATION_SMS_ACCEPTED'
      AND (
        (metadata->>'dispatch_id') = p_dispatch_id::text
        OR (metadata->>'message_sid') = v_clean_sid
      )
  ) INTO v_event_exists;

  IF NOT v_event_exists THEN
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
      'CUSTOMER_LOCATION_SMS_ACCEPTED',
      v_caller_uid,
      jsonb_build_object(
        'provider', 'twilio',
        'sender_id', 'MATOSROAD',
        'dispatch_id', p_dispatch_id,
        'message_sid', v_clean_sid,
        'request_id', v_disp_req_id,
        'initial_status', v_clean_status
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_final_status,
    'message_sid', v_clean_sid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_customer_location_sms_send_operator(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_customer_location_sms_send_operator(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 13. INTEGRATION RPC: RECORD SMS STATUS CALLBACK (TWILIO WEBHOOK)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_sms_status_callback(
  p_integration_secret TEXT,
  p_dispatch_id UUID,
  p_message_sid TEXT,
  p_status TEXT,
  p_error_code TEXT,
  p_error_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret_hash TEXT;
  v_org_id UUID;
  v_disp_id UUID;
  v_incident_id UUID;
  v_current_status TEXT;
  v_current_sid TEXT;
  v_current_rank INTEGER;
  v_new_rank INTEGER;
  v_clean_status TEXT;
  v_clean_sid TEXT;
  v_delivered_event_exists BOOLEAN;
  v_failed_event_exists BOOLEAN;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Validate Twilio integration secret and derive organization (guaranteed unique by uq_org_integrations_provider_token_hash)
  IF p_integration_secret IS NULL OR length(trim(p_integration_secret)) = 0 THEN
    RAISE EXCEPTION 'Integration secret is required';
  END IF;

  v_secret_hash := encode(extensions.digest(trim(p_integration_secret), 'sha256'), 'hex');

  SELECT organization_id
  INTO v_org_id
  FROM public.organization_integrations
  WHERE provider = 'twilio'
    AND integration_token_hash = v_secret_hash
    AND is_active = true;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: invalid or inactive Twilio integration credential';
  END IF;

  -- 2. Validate status parameter against whitelist
  v_clean_status := trim(p_status);
  IF v_clean_status NOT IN ('accepted', 'queued', 'sending', 'sent', 'delivered', 'undelivered', 'failed') THEN
    RAISE EXCEPTION 'Invalid SMS callback status: %', v_clean_status;
  END IF;

  v_clean_sid := nullif(trim(p_message_sid), '');
  IF v_clean_sid IS NULL THEN
    RAISE EXCEPTION 'MessageSid is required';
  END IF;

  -- 3. Lock dispatch by p_dispatch_id (supports recovery if crash happened before MessageSid was stored)
  SELECT id, incident_id, status, provider_message_sid
  INTO v_disp_id, v_incident_id, v_current_status, v_current_sid
  FROM public.customer_location_sms_dispatches
  WHERE id = p_dispatch_id
    AND organization_id = v_org_id
  FOR UPDATE;

  IF v_disp_id IS NULL THEN
    RAISE EXCEPTION 'SMS dispatch record % not found in organization', p_dispatch_id;
  END IF;

  -- 4. Check or attach MessageSid
  IF v_current_sid IS NULL THEN
    UPDATE public.customer_location_sms_dispatches
    SET provider_message_sid = v_clean_sid
    WHERE id = p_dispatch_id;
  ELSIF v_current_sid <> v_clean_sid THEN
    RAISE EXCEPTION 'MessageSid mismatch for dispatch %: expected %, received %', p_dispatch_id, v_current_sid, v_clean_sid;
  END IF;

  -- 5. Monotonic State Machine Calculation
  -- Ranks: reserved:0, accepted:1, queued:2, sending:3, sent:4, terminal(delivered/undelivered/failed):100
  v_current_rank := CASE v_current_status
    WHEN 'reserved'    THEN 0
    WHEN 'accepted'    THEN 1
    WHEN 'queued'      THEN 2
    WHEN 'sending'     THEN 3
    WHEN 'sent'        THEN 4
    WHEN 'delivered'   THEN 100
    WHEN 'undelivered' THEN 100
    WHEN 'failed'      THEN 100
    ELSE -1
  END;

  v_new_rank := CASE v_clean_status
    WHEN 'accepted'    THEN 1
    WHEN 'queued'      THEN 2
    WHEN 'sending'     THEN 3
    WHEN 'sent'        THEN 4
    WHEN 'delivered'   THEN 100
    WHEN 'undelivered' THEN 100
    WHEN 'failed'      THEN 100
    ELSE -1
  END;

  -- Rule A: Terminal states NEVER regress under any circumstance
  IF v_current_rank = 100 THEN
    RETURN jsonb_build_object(
      'success', true,
      'mutated', false,
      'reason', 'terminal_state_locked',
      'status', v_current_status
    );
  END IF;

  -- Rule B: Duplicate same-state callback is a no-op
  IF v_clean_status = v_current_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'mutated', false,
      'reason', 'duplicate_status',
      'status', v_current_status
    );
  END IF;

  -- Rule C: Out-of-order older status callback cannot regress non-terminal state
  IF v_new_rank < v_current_rank THEN
    RETURN jsonb_build_object(
      'success', true,
      'mutated', false,
      'reason', 'older_state_ignored',
      'status', v_current_status
    );
  END IF;

  -- 6. Mutate status
  UPDATE public.customer_location_sms_dispatches
  SET status = v_clean_status,
      error_code = COALESCE(nullif(trim(p_error_code), ''), error_code),
      error_message = COALESCE(nullif(trim(p_error_message), ''), error_message),
      updated_at = v_now
  WHERE id = p_dispatch_id;

  -- 7. Audit event emission: strictly on first transition to terminal states (deduplicated by dispatch_id)
  IF v_clean_status = 'delivered' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE organization_id = v_org_id
        AND entity_type = 'incident'
        AND entity_id = v_incident_id
        AND event_type = 'CUSTOMER_LOCATION_SMS_DELIVERED'
        AND (metadata->>'dispatch_id') = p_dispatch_id::text
    ) INTO v_delivered_event_exists;

    IF NOT v_delivered_event_exists THEN
      INSERT INTO public.operational_events (
        organization_id,
        entity_type,
        entity_id,
        event_type,
        actor_id,
        metadata
      ) VALUES (
        v_org_id,
        'incident',
        v_incident_id,
        'CUSTOMER_LOCATION_SMS_DELIVERED',
        NULL,
        jsonb_build_object(
          'provider', 'twilio',
          'sender_id', 'MATOSROAD',
          'dispatch_id', p_dispatch_id,
          'message_sid', v_clean_sid,
          'status', 'delivered',
          'delivered_at', v_now
        )
      );
    END IF;
  ELSIF v_clean_status IN ('undelivered', 'failed') THEN
    SELECT EXISTS (
      SELECT 1 FROM public.operational_events
      WHERE organization_id = v_org_id
        AND entity_type = 'incident'
        AND entity_id = v_incident_id
        AND event_type = 'CUSTOMER_LOCATION_SMS_FAILED'
        AND (metadata->>'dispatch_id') = p_dispatch_id::text
    ) INTO v_failed_event_exists;

    IF NOT v_failed_event_exists THEN
      INSERT INTO public.operational_events (
        organization_id,
        entity_type,
        entity_id,
        event_type,
        actor_id,
        metadata
      ) VALUES (
        v_org_id,
        'incident',
        v_incident_id,
        'CUSTOMER_LOCATION_SMS_FAILED',
        NULL,
        jsonb_build_object(
          'provider', 'twilio',
          'sender_id', 'MATOSROAD',
          'dispatch_id', p_dispatch_id,
          'message_sid', v_clean_sid,
          'status', v_clean_status,
          'error_code', nullif(trim(p_error_code), ''),
          'error_message', nullif(trim(p_error_message), '')
        )
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'mutated', true,
    'status', v_clean_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_sms_status_callback(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sms_status_callback(TEXT, UUID, TEXT, TEXT, TEXT, TEXT) TO anon;
