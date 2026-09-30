-- ==============================================================================
-- MATOS SYSTEMS — ROADSIDE OPERATIONS & DISPATCH SYSTEM
-- PHASE 7D: SUPABASE REALTIME OPERATOR SYNC
-- Migration: 20260930200000_phase7d_operations_realtime.sql
--
-- Objectives:
-- 1. Ensure public.vehicles, public.incidents, and public.assignments are members
--    of the authoritative Supabase Realtime publication (supabase_realtime).
-- 2. Idempotently add each table only if not already present in pg_publication_tables.
-- 3. Fail clearly if the expected supabase_realtime publication does not exist in catalog.
-- 4. Preserve existing table schemas, RLS policies, and spatial/lifecycle functions.
-- ==============================================================================

DO $$
DECLARE
  v_pub_exists BOOLEAN;
  v_table_name TEXT;
  v_tables TEXT[] := ARRAY['vehicles', 'incidents', 'assignments'];
BEGIN
  -- Verify the standard Supabase Realtime publication exists in catalog
  SELECT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) INTO v_pub_exists;

  IF NOT v_pub_exists THEN
    RAISE EXCEPTION 'Expected Supabase Realtime publication "supabase_realtime" does not exist in catalog';
  END IF;

  -- Idempotently add each required operational table if not already included
  FOREACH v_table_name IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table_name
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table_name);
    END IF;
  END LOOP;
END;
$$;
