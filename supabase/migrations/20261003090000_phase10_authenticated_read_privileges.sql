-- MATOS SYSTEMS — PHASE 10 HARDENING: authenticated read privileges
-- RLS remains authoritative; this migration only restores required table-level SELECT grants.

GRANT SELECT ON TABLE
  public.organizations,
  public.profiles,
  public.worker_profiles,
  public.vehicles,
  public.worker_vehicle_assignments,
  public.incidents,
  public.assignments,
  public.operational_events,
  public.service_capabilities,
  public.vehicle_capabilities,
  public.customer_location_requests,
  public.customer_location_sms_dispatches
TO authenticated;
