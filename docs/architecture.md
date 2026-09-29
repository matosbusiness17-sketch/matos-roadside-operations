# Matos Systems — Roadside Operations & Dispatch System
## Architecture Overview (Implementation Phase 5: Operational Mapping & Fleet Telemetry Foundation)

### 1. Architectural Philosophy

The Matos Systems Roadside Operations & Dispatch System is engineered as a mission-critical operational system for roadside assistance, vehicle towing, and recovery service operators managing mobile response units.

**Phase 2** established the core PostgreSQL data schema, organization multi-tenancy, authentication, role authorization, and Row Level Security (RLS) model.
**Phase 3** established the database spatial and capability data architecture: PostGIS spatial representation (`geography(Point, 4326)`), normalized roadside capability taxonomy (`service_capabilities` and `vehicle_capabilities`), incident structured vehicle and location fields, and tenant-safe, role-bounded spatial database functions.
**Phase 4** added controlled incident intake, an authoritative 10-state lifecycle state machine, atomic operational audit events, closed direct mutation RLS paths, database-guarded status transitions, and real database-backed operator queue, intake, and detail record inspection.
**Phase 5** adds the authoritative operational mapping workspace (`/operations`), an authoritative read-only operational snapshot RPC (`get_operations_map_snapshot()`) with aggregate-level deterministic ordering, PostGIS coordinate derivation, fail-closed data validation without data fabrication, real filter-driven selection clearing, and truthful last-known location fleet visualization.

**Security Principle: Fail Closed**
All authorization boundaries strictly fail closed. A protected route is permitted to render only after authentication and a valid, active profile with an authorized role have been positively established. In all other circumstances, execution fails closed and redirects to `/login`:
- Missing or invalid Supabase configuration => redirects protected routes to `/login`
- Unauthenticated requests => redirects to `/login`
- Failed profile lookup or missing/null profile => redirects to `/login?error=profile_missing`
- Inactive user profiles => signs out and redirects to `/login?error=account_inactive`
- Undefined, null, or unrecognized role => redirects to `/login?error=unauthorized_role`
- Unauthorized role for requested surface (e.g. non-admin accessing `/admin`, non-worker accessing `/worker`, or worker accessing operator routes) => redirects to the authorized surface or shows Access Denied

These controls are enforced in Next.js middleware (`src/middleware.ts`), backed by server component defenses in depth (`(operator)/layout.tsx`, `(operator)/admin/page.tsx`, `worker/layout.tsx`), and statically verified via `tests/security-verification.mjs`.

---

### 2. Core Technology Stack

- **Framework**: Next.js 16.3 (App Router, Turbopack, Server & Client Components)
- **Language**: TypeScript 5 (Strict typing enabled)
- **Styling**: Tailwind CSS v4
- **Backend & Database Platform**: Supabase (PostgreSQL 15+, PostGIS 3+, Row Level Security, Supabase Auth)
- **Spatial Engine**: PostGIS `geography(Point, 4326)` (authoritative spatial representation, distances calculated in metres)
- **Mapping**: Mapbox GL JS (Native vector map rendering)
- **Session Management**: `@supabase/ssr` (Cookie-based session refresh and middleware validation)
- **Deployment Platform**: Vercel

---

### 3. Database Schema & Entities

The database schema is defined across four sequential migrations:
- Phase 2: [supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql)
- Phase 3: [supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql)
- Phase 4: [supabase/migrations/20260929140000_phase4_incident_state_machine.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260929140000_phase4_incident_state_machine.sql)
- Phase 5: [supabase/migrations/20260929150000_phase5_operations_map_snapshot.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260929150000_phase5_operations_map_snapshot.sql)

#### 3.1 Entity Model & Relationships

```
organizations (Tenancy Root)
  ├── profiles (1:N, Auth Users bound to Organization with app_role)
  │     └── worker_profiles (1:1 extension for field workers)
  ├── vehicles (1:N, Mobile response units with last_known_location geography)
  │     ├── worker_vehicle_assignments (N:N, Shift bindings between workers and vehicles)
  │     └── vehicle_capabilities (N:N, Junction binding vehicles to service capabilities with composite FK)
  ├── incidents (1:N, Roadside assistance requests with location geography & vehicle details)
  │     ├── assignments (1:N, Dispatched worker & vehicle bindings)
  │     └── required_capability_id (FK -> service_capabilities)
  ├── service_capabilities (Controlled catalogue of roadside capabilities: towing, lockout, etc.)
  └── operational_events (1:N, Immutable append-only audit trail)
```

#### 3.2 Relational Integrity & Schema Hygiene
- Zero new database tables are created in Phase 5; the operational mapping surface functions entirely over existing verified Phase 2–4 tables.
- Zero duplicate coordinate columns are created; numeric coordinates are derived on read using PostGIS `ST_X` (longitude) and `ST_Y` (latitude) over authoritative `geography(Point, 4326)` columns.
- Composite foreign keys in junction tables strictly isolate tenant operations.

---

### 4. Role Authorization Model

Phases 2 through 5 enforce three application roles defined by the `app_role` PostgreSQL enum:

| Role | Permitted Application Surfaces | Database & Operational Permissions |
| :--- | :--- | :--- |
| **`admin`** | `/operations`, `/incidents`, `/fleet`, `/history`, `/admin` | Organization-scoped reads; operational snapshot RPC; incident intake via controlled `create_incident` RPC, lifecycle transitions via controlled `transition_incident_status` RPC; user management, capabilities, and organizational configuration. |
| **`operator`** | `/operations`, `/incidents`, `/fleet`, `/history` | Organization-scoped reads; operational snapshot RPC; incident intake via controlled `create_incident` RPC, lifecycle transitions via controlled `transition_incident_status` RPC; fleet units and capabilities. **Strictly blocked from `/admin`.** |
| **`worker`** | `/worker` | Restricted to own worker profile, active vehicle assignments, actively assigned vehicle capabilities, and **only incidents explicitly dispatched to this worker** under existing assignment-based SELECT RLS. **Worker is strictly blocked from `get_operations_map_snapshot` RPC and desktop operator surfaces.** |

---

### 5. Row Level Security (RLS) Strategy

Row Level Security is enabled on **all application tables**. Anonymous clients (`auth.role() != 'authenticated'`) have **zero access** to any table.

1. **`incidents`**: Controlled mutation via privileged RPCs (`create_incident`, `transition_incident_status`). Read access scoped to organization for operators and admins.
2. **`operational_events`**: Append-only via privileged stored procedures; updates and deletes strictly rejected by `trg_immutable_operational_events`.
3. **`vehicles` & `service_capabilities`**: Tenant-isolated reads and management.
4. **`get_operations_map_snapshot()`**: Authoritative `SECURITY DEFINER` function with internal role authorization check ensuring field workers and anonymous callers cannot read the operational snapshot.

---

### 6. Phase 5 Operational Mapping & Fleet Telemetry Architecture

#### 6.1 Authoritative Snapshot RPC Contract (`get_operations_map_snapshot`)
- **Zero Parameters**: Accepts zero arguments. Caller UID, tenant organization, and role are derived strictly from authenticated session context via `auth.uid()`, `public.get_current_user_organization_id()`, and `public.get_current_user_role()`.
- **Role Boundary**: Restricts execution strictly to `admin` and `operator` roles; worker access is rejected with an exception.
- **Read-Only Guarantee**: Contains zero INSERT, UPDATE, or DELETE statements against operational tables.
- **Active Incident Scoping**: Returns incidents in active operational statuses (`new`, `triaged`, `ready_for_dispatch`, `dispatched`, `en_route`, `on_scene`, `in_progress`). Strictly excludes terminal statuses (`completed`, `cancelled`, `unable_to_complete`).
- **Aggregate-Level Deterministic Ordering**:
  - Enforced directly inside the final `jsonb_agg(...)` call for incidents:
    ```sql
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
    ```
  - Enforced directly inside the final `jsonb_agg(...)` call for vehicles:
    ```sql
    ORDER BY
      vr.callsign ASC,
      vr.id ASC
    ```
- **PostGIS Coordinate Extraction**: Longitude and latitude extracted via `ST_X(location::geometry)` and `ST_Y(location::geometry)`.
- **Missing-Location Tolerance**: Incidents and vehicles without spatial coordinates are retained with `null` latitude and longitude.
- **Privilege Revocation**: Execution revoked from `PUBLIC` and `anon`; granted exclusively to `authenticated`.

#### 6.2 Application Data Layer & Validation Hygiene (`src/lib/operations/data.ts`)
- **Session Verification**: Verifies session and active profile role using `getCurrentUser()`.
- **Fail-Closed Validation**: Validates required contract primitives (`id`, `reference_number`, `status`, `priority`, `service_type`, `customer_name`, `customer_phone`, `location_address`, `created_at`, `updated_at`).
- **Zero Fabrication**:
  - No fallback to `new Date().toISOString()` for operational timestamps.
  - No fallback to empty strings for required `customer_phone`.
  - Malformed or incomplete required fields cause `validateAndNormalizeSnapshot` to fail closed and return `INVALID_SNAPSHOT`.
- **Defensive Coordinate Normalization**: If either coordinate is invalid, non-finite, or out of bounds ([-90, 90] / [-180, 180]), both coordinates normalize truthfully to `null`.
- **Error Shielding**: Database errors are caught and transformed into typed `OperationsSnapshotResult` error codes (`UNAUTHORIZED`, `FORBIDDEN`, `SNAPSHOT_UNAVAILABLE`, `INVALID_SNAPSHOT`) without exposing raw database error messages to clients.

#### 6.3 Unified Three-Region Operational Workspace
- **Layout Synchronization**:
  - Left: Incident Queue with client-side filters (status, priority, service) and text search.
  - Center: Mapbox GL JS map with incident priority markers, vehicle callsign markers, and operational area bounding.
  - Right: Context Panel providing full incident record links (`/incidents/[id]`) and unit inspection.
- **Real Filter-Driven Selection State Clearing**:
  - If a selected incident is hidden by an applied filter or search query, the actual selection state is cleared (`setSelection(null)`) rather than merely masked.
  - Vehicle selection is independent of incident filtering.
- **Non-Destructive Manual Refresh**:
  - Triggered manually by operator; no automatic polling or WebSockets.
  - Atomically replaces snapshot data and reconciles selection.
  - If refresh fails, retains the existing snapshot, timestamp, and selection, displaying an informative notice banner.
- **Truthful Telemetry Semantics**:
  - Vehicle locations represent the latest stored database snapshot ("Last known location").
  - Explicitly disclaims live GPS: *"Vehicle positions show the latest stored location and are not a live GPS feed."*

---

### 7. Verification Status & Security Inspection

Verification across Phase 2, Phase 3, Phase 4, and Phase 5 is structured into separate, clear categories:

1. **Phase 2 Security Verification (Static)**:
   - Script: `tests/security-verification.mjs`
   - Result: **89 passed / 0 failed**
   - Covers: Core schema, 8 tables RLS, triggers, password hygiene, middleware fail-closed checks, role boundaries.

2. **Phase 3 Spatial & Capability Verification (Static)**:
   - Script: `tests/phase3-spatial-verification.mjs`
   - Result: **95 passed / 0 failed**
   - Covers: PostGIS extensions, spatial columns, GiST indexing, `service_capabilities` RLS, `vehicle_capabilities` role-aware SELECT RLS, write policies, spatial function security, parameter validation, and later-phase boundary guards.

3. **Phase 3 Database Structural Verification (SQL Script)**:
   - Script: `supabase/verify_phase3.sql`
   - Status: Database structural verification script provided for manual Supabase execution; not executed live in this environment.

4. **Phase 4 Incident State Machine & Management Verification (Static)**:
   - Script: `tests/phase4-incident-verification.mjs`
   - Result: **170 passed / 0 failed**
   - Covers: Exact 10-state lifecycle CHECK constraint, concurrency-safe reference generator with transaction advisory lock, mutation policy closure, authoritative transition RPC with locked transition matrix, privileged intake RPC, locked Phase 2 service types, and real database queue.

5. **Phase 4 Database Structural Verification (SQL Script)**:
   - Script: `supabase/verify_phase4.sql`
   - Status: Database structural verification script provided for manual Supabase execution; not executed live in this environment.

6. **Phase 5 Operational Mapping & Fleet Telemetry Verification (Static)**:
   - Script: `tests/phase5-operations-map-verification.mjs`
   - Result: **257 passed / 0 failed**
   - Covers: Zero-parameter RPC signature, session-derived tenancy and role check, role restriction (admin/operator only, workers rejected), privilege model (revoked from PUBLIC and anon, granted to authenticated), exact 7 active statuses (terminal states excluded), aggregate-level deterministic incident ordering (priority critical > high > standard > low, oldest created_at ASC, id ASC inside jsonb_agg), aggregate-level vehicle ordering (callsign ASC, id ASC inside jsonb_agg), active fleet scoping, unmapped incident and vehicle tolerance, PostGIS ST_X/ST_Y coordinate derivation, zero new tables, zero duplicate coordinate columns, read-only guarantee, payload hygiene, server component page, Mapbox GL JS integration, fail-closed data validation without data fabrication (no `new Date().toISOString()`, no `''` phone fallback), real filter-driven selection clearing (hidden incident is cleared via `setSelection(null)`), truthful last-known location telemetry without live GPS claims, and strict Phase 6-9 boundary enforcement.

7. **Phase 5 Database Structural Verification (SQL Script)**:
   - Script: `supabase/verify_phase5.sql`
   - Status: Database structural verification script provided for manual Supabase execution; not executed live in this environment.
   - Purpose: Non-destructive catalog inspection of `get_operations_map_snapshot()` signature, SECURITY DEFINER declaration, search_path, authenticated/anon privileges, and catalog `aclexplode` inspection verifying that role PUBLIC (grantee 0) does not retain EXECUTE privilege.

---

### 8. Phased Roadmap Boundaries

| Phase | Focus Area | Status |
| :--- | :--- | :--- |
| **Phase 1** | Application Foundation & Route Shells | **Completed** |
| **Phase 2** | Database Schema, Tenancy, Auth & RLS | **Completed (Statically Verified: 89 passed / 0 failed)** |
| **Phase 3** | Core Data Schema & PostGIS Spatial Extensions | **Completed (Statically Verified: 95 passed / 0 failed; DB verification script provided)** |
| **Phase 4** | Incident Intake, Queues & Operational State Machine | **Completed (Statically Verified: 170 passed / 0 failed; DB verification script provided)** |
| **Phase 5** | Operational Mapping & Fleet Telemetry Foundation | **Completed (Statically Verified: 257 passed / 0 failed; DB verification script provided for manual execution)** |
| Phase 6 | Capability-Aware Matching & Dispatch Engine | Deferred |
| Phase 7 | Field Worker PWA & Realtime Telemetry | Deferred |
| Phase 8 | Customer Location Verification & GPS Flow | Deferred |
| Phase 9 | Twilio / Vapi Telephony & Automated Intake | Deferred |
| Phase 10 | Hardening, Audit Logs & Production Deployment | Deferred |
