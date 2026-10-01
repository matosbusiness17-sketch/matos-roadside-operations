-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- PHASE 8: CUSTOMER LOCATION VERIFICATION & GPS FLOW
-- Migration: 20261001080000_phase8_customer_location_verification.sql
--
-- Objectives:
-- 1. Create public.customer_location_requests table for secure motorist location links.
-- 2. Store SHA-256 token hashes only; raw cryptographically secure tokens are never stored.
-- 3. Enforce tenant isolation via composite foreign key (incident_id, organization_id).
-- 4. Create operator RPC create_customer_location_request(p_incident_id UUID).
--    - Requires authenticated admin or operator
--    - Validates caller organization and non-terminal incident status
--    - Revokes previous active unused requests for that incident
--    - Generates 32-byte secure random token with 1-hour expiry
-- 5. Create public RPC get_customer_location_request_status(p_token TEXT).
--    - Rate-safe minimal status check (valid, expired, used, revoked, invalid)
--    - Zero leakage of incident, organization, or customer PII
-- 6. Create public RPC submit_customer_location(p_token, p_latitude, p_longitude, p_accuracy).
--    - Strict deadlock prevention: enforces canonical lock order (incident -> customer_location_request)
--    - Validates coordinate bounds and finite non-negative accuracy (rejects NaN/Infinity/negative/NULL)
--    - Consumes token (used_at = now()) to prevent replay
--    - Authoritatively updates public.incidents (location, location_accuracy, location_source = 'customer_link')
--    - Records immutable operational_events audit trail (CUSTOMER_LOCATION_CONFIRMED) with NULL actor
--    - Returns minimal public confirmation (success, confirmed_at) without leaking internal IDs
-- 7. Strict privilege management & RLS:
--    - REVOKE ALL ON public.customer_location_requests FROM PUBLIC, anon, authenticated;
--    - GRANT SELECT ON public.customer_location_requests TO authenticated;
--    - Anonymous callers receive ZERO direct table access.
-- ==============================================================================

-- 1. Enable pgcrypto extension for cryptographic random generation and hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. CUSTOMER LOCATION REQUESTS TABLE
CREATE TABLE IF NOT EXISTS public.customer_location_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce strict tenant boundary matching parent incident
  CONSTRAINT fk_cust_loc_req_incident_org
    FOREIGN KEY (incident_id, organization_id)
    REFERENCES public.incidents(id, organization_id)
    ON DELETE CASCADE,

  -- Creator profile must belong to the same organization
  CONSTRAINT fk_cust_loc_req_creator_org
    FOREIGN KEY (created_by, organization_id)
    REFERENCES public.profiles(id, organization_id)
    ON DELETE RESTRICT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cust_loc_req_token_hash
  ON public.customer_location_requests(token_hash);

CREATE INDEX IF NOT EXISTS idx_cust_loc_req_incident_org
  ON public.customer_location_requests(incident_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_cust_loc_req_status_lookup
  ON public.customer_location_requests(incident_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

-- 3. ROW LEVEL SECURITY & EXPLICIT TABLE PRIVILEGES
ALTER TABLE public.customer_location_requests ENABLE ROW LEVEL SECURITY;

-- Explicit fail-closed privilege setup: revoke ALL privileges from all roles
REVOKE ALL ON public.customer_location_requests FROM PUBLIC, anon, authenticated;

-- Grant ONLY SELECT to authenticated (auditing); zero mutation privileges granted
GRANT SELECT ON public.customer_location_requests TO authenticated;

-- Authenticated operator read-only policy for their organization (auditing)
CREATE POLICY cust_loc_req_select_operator_admin
  ON public.customer_location_requests
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_current_user_organization_id()
    AND public.get_current_user_role() IN ('admin', 'operator')
  );

-- ------------------------------------------------------------------------------
-- 4. OPERATOR RPC: CREATE CUSTOMER LOCATION REQUEST
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_customer_location_request(
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
  v_profile_active BOOLEAN;
  v_incident_id UUID;
  v_incident_status TEXT;
  v_raw_token TEXT;
  v_token_hash TEXT;
  v_expires_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Derive authenticated caller identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to create customer location link';
  END IF;

  SELECT p.organization_id, p.role, p.is_active
  INTO v_caller_org, v_caller_role, v_profile_active
  FROM public.profiles p
  WHERE p.id = v_caller_uid;

  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'Profile not found for authenticated caller';
  END IF;

  IF NOT v_profile_active THEN
    RAISE EXCEPTION 'Profile is deactivated';
  END IF;

  IF v_caller_role NOT IN ('admin', 'operator') THEN
    RAISE EXCEPTION 'Unauthorized: only admins and operators can generate customer location links';
  END IF;

  -- 2. Lock target incident first (Lock Order: 1. Incident -> 2. Customer Location Requests)
  SELECT i.id, i.status
  INTO v_incident_id, v_incident_status
  FROM public.incidents i
  WHERE i.id = p_incident_id
    AND i.organization_id = v_caller_org
  FOR UPDATE;

  IF v_incident_id IS NULL THEN
    RAISE EXCEPTION 'Incident not found in caller organization';
  END IF;

  IF v_incident_status IN ('completed', 'cancelled', 'unable_to_complete') THEN
    RAISE EXCEPTION 'Cannot generate location link for terminal incident (%)', v_incident_status;
  END IF;

  -- 3. Invalidate/revoke previous still-valid unused requests for this incident
  UPDATE public.customer_location_requests
  SET revoked_at = v_now
  WHERE incident_id = p_incident_id
    AND organization_id = v_caller_org
    AND used_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > v_now;

  -- 4. Generate 32 cryptographically secure random bytes (64 hex characters)
  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
  v_expires_at := v_now + interval '1 hour';

  -- 5. Store request with SHA-256 hash only (never raw token)
  INSERT INTO public.customer_location_requests (
    organization_id,
    incident_id,
    token_hash,
    expires_at,
    created_by,
    created_at
  ) VALUES (
    v_caller_org,
    p_incident_id,
    v_token_hash,
    v_expires_at,
    v_caller_uid,
    v_now
  );

  -- 6. Return raw token once to the generating operator
  RETURN jsonb_build_object(
    'success', true,
    'token', v_raw_token,
    'expires_at', v_expires_at,
    'relative_path', '/customer/location/' || v_raw_token
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_location_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_location_request(UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. PUBLIC RPC: GET CUSTOMER LOCATION REQUEST STATUS
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_customer_location_request_status(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_hash TEXT;
  v_expires_at TIMESTAMPTZ;
  v_used_at TIMESTAMPTZ;
  v_revoked_at TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Validate format: exactly 64 hexadecimal characters
  IF p_token IS NULL OR length(trim(p_token)) != 64 OR NOT (p_token ~ '^[0-9a-fA-F]{64}$') THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'invalid'
    );
  END IF;

  -- Compute SHA-256 hash
  v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  -- Lookup request record
  SELECT expires_at, used_at, revoked_at
  INTO v_expires_at, v_used_at, v_revoked_at
  FROM public.customer_location_requests
  WHERE token_hash = v_token_hash;

  IF v_expires_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'invalid'
    );
  END IF;

  IF v_used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'used'
    );
  END IF;

  IF v_revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'revoked'
    );
  END IF;

  IF v_expires_at <= v_now THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'expired'
    );
  END IF;

  -- Token is valid and available for GPS submission
  RETURN jsonb_build_object(
    'success', true,
    'status', 'valid',
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_customer_location_request_status(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_location_request_status(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 6. PUBLIC RPC: SUBMIT CUSTOMER LOCATION
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_customer_location(
  p_token TEXT,
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_accuracy DOUBLE PRECISION
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token_hash TEXT;
  v_req_id UUID;
  v_org_id UUID;
  v_incident_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_used_at TIMESTAMPTZ;
  v_revoked_at TIMESTAMPTZ;
  v_incident_status TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Validate token format
  IF p_token IS NULL OR length(trim(p_token)) != 64 OR NOT (p_token ~ '^[0-9a-fA-F]{64}$') THEN
    RAISE EXCEPTION 'Invalid or malformed location link token';
  END IF;

  -- 2. Validate geographic coordinates
  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RAISE EXCEPTION 'Latitude and longitude coordinates are required';
  END IF;

  IF p_latitude < -90.0 OR p_latitude > 90.0
     OR p_longitude < -180.0 OR p_longitude > 180.0
     OR p_latitude = 'NaN'::double precision
     OR p_longitude = 'NaN'::double precision
     OR p_latitude = 'Infinity'::double precision
     OR p_latitude = '-Infinity'::double precision
     OR p_longitude = 'Infinity'::double precision
     OR p_longitude = '-Infinity'::double precision THEN
    RAISE EXCEPTION 'Coordinates out of valid range: latitude [-90, 90], longitude [-180, 180]';
  END IF;

  -- 3. Validate accuracy: reject NULL, negative, NaN, and Infinity values
  IF p_accuracy IS NULL
     OR p_accuracy < 0.0
     OR p_accuracy = 'NaN'::double precision
     OR p_accuracy = 'Infinity'::double precision
     OR p_accuracy = '-Infinity'::double precision THEN
    RAISE EXCEPTION 'Location accuracy must be a valid, finite, non-negative number';
  END IF;

  -- 4. Initial NON-LOCKING lookup of hashed token to identify incident and organization keys
  v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  SELECT id, organization_id, incident_id
  INTO v_req_id, v_org_id, v_incident_id
  FROM public.customer_location_requests
  WHERE token_hash = v_token_hash;

  IF v_req_id IS NULL THEN
    RAISE EXCEPTION 'Location request not found or invalid';
  END IF;

  -- 5. CANONICAL LOCK ORDER: Lock 1 — Target Incident FOR UPDATE
  SELECT status
  INTO v_incident_status
  FROM public.incidents
  WHERE id = v_incident_id
    AND organization_id = v_org_id
  FOR UPDATE;

  IF v_incident_status IS NULL THEN
    RAISE EXCEPTION 'Associated incident not found';
  END IF;

  IF v_incident_status IN ('completed', 'cancelled', 'unable_to_complete') THEN
    RAISE EXCEPTION 'Cannot update location for terminal incident (%)', v_incident_status;
  END IF;

  -- 6. CANONICAL LOCK ORDER: Lock 2 — Customer Location Request Row FOR UPDATE
  -- Re-read and revalidate authoritative request state after acquiring lock
  SELECT expires_at, used_at, revoked_at
  INTO v_expires_at, v_used_at, v_revoked_at
  FROM public.customer_location_requests
  WHERE id = v_req_id
  FOR UPDATE;

  IF v_expires_at IS NULL THEN
    RAISE EXCEPTION 'Location request not found or invalid';
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

  -- 7. Authoritatively update incident location (PostGIS Point: longitude first, then latitude)
  UPDATE public.incidents
  SET location = ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
      location_accuracy = p_accuracy,
      location_source = 'customer_link',
      updated_at = v_now
  WHERE id = v_incident_id;

  -- 8. Mark request as consumed
  UPDATE public.customer_location_requests
  SET used_at = v_now
  WHERE id = v_req_id;

  -- 9. Record immutable operational audit event (unauthenticated actor truthfully represented as NULL)
  INSERT INTO public.operational_events (
    organization_id,
    event_type,
    actor_id,
    entity_type,
    entity_id,
    metadata,
    created_at
  ) VALUES (
    v_org_id,
    'CUSTOMER_LOCATION_CONFIRMED',
    NULL,
    'incident',
    v_incident_id,
    jsonb_build_object(
      'source', 'customer_link',
      'accuracy_metres', p_accuracy,
      'request_id', v_req_id
    ),
    v_now
  );

  -- 10. Return minimal public confirmation payload (zero internal IDs or hashes exposed)
  RETURN jsonb_build_object(
    'success', true,
    'confirmed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_customer_location(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_customer_location(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;
