# Matos Systems — Roadside Operations & Dispatch System
## Architecture Overview (Implementation Phase 6: Capability-Aware Matching & Dispatch Engine)

### 1. Architectural Philosophy

The Matos Systems Roadside Operations & Dispatch System is engineered as a mission-critical operational system for roadside assistance, vehicle towing, and recovery service operators managing mobile response units.

**Phase 2** established the core PostgreSQL data schema, organization multi-tenancy, authentication, role authorization, and Row Level Security (RLS) model.
**Phase 3** established the database spatial and capability data architecture: PostGIS spatial representation (`geography(Point, 4326)`), normalized roadside capability taxonomy (`service_capabilities` and `vehicle_capabilities`), incident structured vehicle and location fields, and tenant-safe, role-bounded spatial database functions.
**Phase 4** added controlled incident intake, an authoritative 10-state lifecycle state machine, atomic operational audit events, closed direct mutation RLS paths, database-guarded status transitions, and real database-backed operator queue, intake, and detail record inspection.
**Phase 5** established the authoritative operational mapping workspace (`/operations`), an authoritative read-only operational snapshot RPC (`get_operations_map_snapshot()`) with aggregate-level deterministic ordering, PostGIS coordinate derivation, fail-closed data validation without data fabrication, real filter-driven selection clearing, and truthful last-known location fleet visualization.
**Phase 6** establishes the authoritative capability-aware matching and dispatch engine: deterministic PostGIS proximity ranking, concurrency protection via 5 partial unique indexes, atomic initial dispatch (`dispatch_incident`) and reassignment (`reassign_incident`) database transactions, fail-closed contract validation, and preserved stale-conflict and reassignment mutation notices.

**Security Principle: Fail Closed**
All authorization boundaries strictly fail closed. A protected route is permitted to render only after authentication and a valid, active profile with an authorized role have been positively established. In all other circumstances, execution fails closed and redirects to `/login`:
- Missing or invalid Supabase configuration => redirects protected routes to `/login`
- Unauthenticated requests => redirects to `/login`
- Failed profile lookup or missing/null profile => redirects to `/login?error=profile_missing`
- Inactive user profiles => signs out and redirects to `/login?error=account_inactive`
- Undefined, null, or unrecognized role => redirects to `/login?error=unauthorized_role`
- Unauthorized role for requested surface (e.g. non-admin accessing `/admin`, non-worker accessing `/worker`, or worker accessing operator routes) => redirects to the authorized surface or shows Access Denied

These controls are enforced in Next.js middleware (`src/middleware.ts`), backed by server component defenses in depth (`(operator)/layout.tsx`, `(operator)/admin/page.tsx`, `worker/layout.tsx`), and statically verified across all test suites.

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

The database schema is defined across five sequential migrations:
- Phase 2: [supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql)
- Phase 3: [supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql)
- Phase 4: [supabase/migrations/20260929140000_phase4_incident_state_machine.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260929140000_phase4_incident_state_machine.sql)
- Phase 5: [supabase/migrations/20260929150000_phase5_operations_map_snapshot.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260929150000_phase5_operations_map_snapshot.sql)
- Phase 6: [supabase/migrations/20260930060000_phase6_dispatch_engine.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260930060000_phase6_dispatch_engine.sql)

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

#### 3.2 Relational Integrity & Concurrency Architecture
- Zero new database tables were created in Phase 6; the dispatch engine operates entirely over existing verified Phase 2–5 tables.
- Zero duplicate coordinate columns exist; numeric coordinates are derived on read using PostGIS `ST_X` (longitude) and `ST_Y` (latitude) over authoritative `geography(Point, 4326)` columns.
- **Partial Unique Indexes for Concurrency Invariants**:
  1. `idx_uq_wva_active_worker`: `ON public.worker_vehicle_assignments(organization_id, worker_id) WHERE status = 'active'`
  2. `idx_uq_wva_active_vehicle`: `ON public.worker_vehicle_assignments(organization_id, vehicle_id) WHERE status = 'active'`
  3. `idx_uq_assignments_active_incident`: `ON public.assignments(organization_id, incident_id) WHERE status IN ('assigned', 'accepted', 'en_route', 'on_scene')`
  4. `idx_uq_assignments_active_worker`: `ON public.assignments(organization_id, worker_id) WHERE status IN ('assigned', 'accepted', 'en_route', 'on_scene')`
  5. `idx_uq_assignments_active_vehicle`: `ON public.assignments(organization_id, vehicle_id) WHERE vehicle_id IS NOT NULL AND status IN ('assigned', 'accepted', 'en_route', 'on_scene')`
- **Assignment Mutation Lockdown**: Direct `INSERT` and `UPDATE` policies (`assignments_insert_operator_admin`, `assignments_update`) are dropped; direct table mutations (`INSERT`, `UPDATE`, `DELETE`) are revoked from `authenticated` and `anon`; `SELECT` policy `assignments_select` is preserved for operator and worker reads.

---

### 4. Role Authorization Model

Phases 2 through 6 enforce three application roles defined by the `app_role` PostgreSQL enum:

| Role | Permitted Application Surfaces | Database & Operational Permissions |
| :--- | :--- | :--- |
| **`admin`** | `/operations`, `/incidents`, `/fleet`, `/history`, `/admin` | Organization-scoped reads; operational snapshot RPC; candidate evaluation via `get_dispatch_candidates`; dispatch mutations via `dispatch_incident` and `reassign_incident`; incident intake via `create_incident`, lifecycle transitions via `transition_incident_status`; user management, capabilities, and organizational configuration. |
| **`operator`** | `/operations`, `/incidents`, `/fleet`, `/history` | Organization-scoped reads; operational snapshot RPC; candidate evaluation via `get_dispatch_candidates`; dispatch mutations via `dispatch_incident` and `reassign_incident`; incident intake via `create_incident`, lifecycle transitions via `transition_incident_status`. **Strictly blocked from `/admin`.** |
| **`worker`** | `/worker` | Restricted to own worker profile, active vehicle assignments, actively assigned vehicle capabilities, and **only incidents explicitly dispatched to this worker** under existing assignment-based SELECT RLS. **Worker is strictly blocked from `get_dispatch_candidates`, `dispatch_incident`, `reassign_incident`, `get_operations_map_snapshot` RPCs, and desktop operator surfaces.** |

---

### 5. Phase 6 Capability-Aware Matching & Dispatch Engine Architecture

#### 5.1 Authoritative Candidate Generation RPC (`get_dispatch_candidates`)
- **Signature**: `public.get_dispatch_candidates(p_incident_id UUID) RETURNS JSONB`
- **Session-Derived Security**: Caller UID, tenant organization, and role are derived strictly from authenticated session context via `auth.uid()`, `public.get_current_user_organization_id()`, and `public.get_current_user_role()`.
- **Role Boundary**: Restricts execution strictly to `admin` and `operator` roles; worker callers are rejected with an exception.
- **Fail-Closed Multi-Active Handling**: If the incident is in `dispatched` status, the query verifies that the count of active assignments is exactly 1 (`v_active_assignments_count = 1`). If corrupted with multiple active assignments, it fails closed to `dispatch_state = 'unavailable'` without masking corruption via `ORDER BY ... LIMIT 1`.
- **Worker-Vehicle Pair Eligibility Invariants**:
  1. Active shift binding: `wva.status = 'active'`
  2. Available worker: `wp.availability_status = 'available'`
  3. Active worker profile: `p.is_active = true`
  4. Active vehicle: `v.is_active = true`
  5. **Capability Matching Semantics**: If the incident specifies `required_capability_id`, the vehicle must have a matching row in `vehicle_capabilities` and the referenced `service_capabilities` record must be active (`service_capabilities.is_active = true`). Note: `vehicle_capabilities` is a junction table and does not have an `is_active` column.
  6. Target incident conflict check: no active assignments exist on target incident (except during reassignment where the current assignment being replaced is excluded).
  7. Worker conflict check: worker has no active assignment.
  8. Vehicle conflict check: vehicle has no active assignment.
  9. Reassignment exclusion: does not offer the identical active pair (`wp.id = v_exclude_worker_id AND v.id = v_exclude_vehicle_id`) as a replacement.
- **Deterministic Proximity Ordering**:
  - Distance is calculated using PostGIS: `ST_Distance(v_inc.location, v.last_known_location)`
  - Results are precomputed into `distance_meters` in the candidate CTE.
  - Ranked candidates are ordered inside `jsonb_agg(...)` by:
    ```sql
    ORDER BY r.distance_meters ASC, r.callsign ASC, r.worker_id ASC
    ```
  - Unranked candidates are ordered inside `jsonb_agg(...)` by:
    ```sql
    ORDER BY u.callsign ASC, u.worker_id ASC
    ```
- **Unranked Tolerance**: Candidates with unmapped vehicles or unmapped incidents are retained as unranked candidates with explicit `ranking_reason` (`vehicle_location_unavailable` or `incident_location_unavailable`), without fabricating coordinates.

#### 5.2 Atomic Initial Dispatch RPC (`dispatch_incident`)
- **Signature**: `public.dispatch_incident(p_incident_id UUID, p_worker_id UUID, p_vehicle_id UUID) RETURNS JSONB`
- **Row-Level Locking**: Acquires `FOR UPDATE` locks on target incident, worker profile (`FOR UPDATE OF wp`), vehicle, and shift binding (`wva`).
- **Prerequisites**: Target incident status must be `ready_for_dispatch`.
- **Transaction-Time Conflict Checks**: Re-evaluates active assignment conflicts on incident, worker, and vehicle to guarantee zero race-condition collisions.
- **State Transition**: Calls authoritative Phase 4 `transition_incident_status(p_incident_id, 'dispatched', 'Operational dispatch')`.
- **Audit Logging**: Inserts assignment record with status `assigned` and atomically creates an `ASSIGNMENT_CREATED` operational audit event.

#### 5.3 Atomic Reassignment RPC (`reassign_incident`)
- **Signature**: `public.reassign_incident(p_incident_id UUID, p_current_assignment_id UUID, p_new_worker_id UUID, p_new_vehicle_id UUID) RETURNS JSONB`
- **Row-Level Locking**: Acquires `FOR UPDATE` locks on target incident and current assignment.
- **Prerequisites**: Incident must be in `dispatched` status and current assignment must be in `assigned` status (reassignment is locked once the unit progresses to `en_route` or beyond).
- **Non-Identical Pair Enforcement**: Rejects reassignment if new worker and new vehicle match the current assignment.
- **Cancelled Assignment Semantics**: Updates prior assignment status to `cancelled` without fabricating a `completed_at` timestamp.
- **Replacement Creation**: Inserts new assignment with status `assigned`.
- **Audit Logging**: Retains `dispatched` status on incident and atomically creates an `INCIDENT_REASSIGNED` operational audit event.

#### 5.4 Fail-Closed Application Data Layer (`src/lib/dispatch/data.ts`)
- **Property-Presence Enforcement**: Strictly checks that contract keys exist on returned objects using `hasOwnProperty` (e.g. `required_capability` on incident, `current_assignment` on context).
- **Strict Nullable Validation**:
  - `registration_number`: valid if `string` or `null`. Any malformed non-null value (e.g. `number`, `object`) fails validation.
  - `vehicle_location_updated_at`: valid if `null` or finite ISO timestamp string via `Date.parse`. Malformed values fail validation.
- **Zero Fabrication**:
  - Does not use fallback `|| 'dispatched'` or `?? 'dispatched'` to fabricate status.
  - Enforces `validateRequiredTimestamp` on all authoritative timestamps.
- **Error Shielding**: Maps database errors into domain error codes (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_DISPATCHABLE`, `CANDIDATE_NO_LONGER_ELIGIBLE`, `DISPATCH_CONFLICT`, `REASSIGNMENT_NOT_ALLOWED`, `INVALID_RESPONSE`, `DISPATCH_UNAVAILABLE`) without leaking raw PostgreSQL errors.

#### 5.5 Operational Frontend UX (`DispatchPanel`)
- **Preserved Stale-Conflict Notice**: When a candidate conflict occurs (`CANDIDATE_NO_LONGER_ELIGIBLE` or `DISPATCH_CONFLICT`), the notice *"Dispatch could not be completed. This unit is no longer available. Candidates have been refreshed."* is preserved across the subsequent workspace and candidate refresh via `fetchCandidates({ clearMutationNotice: false })`.
- **Preserved Reassignment Progression Notice**: When reassignment fails because the current unit has progressed (`REASSIGNMENT_NOT_ALLOWED`), the message *"Reassignment is no longer allowed. The current assignment may have already progressed."* is preserved and rendered in the Assigned Response view.
- **Truthful Unranked Telemetry**: For unranked candidates where `ranking_reason === 'incident_location_unavailable'`, the vehicle last-known position timestamp is truthfully displayed if recorded, with label *"Incident coordinates not recorded"*.
- **Defensive Date Formatters**: `formatTime` and `formatRelativeTime` explicitly validate `Number.isFinite(Date.parse(isoString))` to prevent `NaNd ago` or `Invalid Date`.
- **Serialized Queued Workspace Refresh**: `OperationsWorkspace` coordinates post-mutation refreshes with a serialized queue loop (`while(true)` over `pendingQueuedRefreshRef`), ensuring mutations immediately reconcile workspace and map state without race conditions.

---

### 6. Verification Status & Security Inspection

Verification across Phases 2 through 6 is structured into separate, clear categories:

1. **Phase 2 Security Verification (Static)**:
   - Script: `tests/security-verification.mjs`
   - Result: **89 passed / 0 failed**
   - Covers: Core schema, 8 tables RLS, triggers, password hygiene, middleware fail-closed checks, role boundaries.

2. **Phase 3 Spatial & Capability Verification (Static)**:
   - Script: `tests/phase3-spatial-verification.mjs`
   - Result: **95 passed / 0 failed**
   - Covers: PostGIS extensions, spatial columns, GiST indexing, `service_capabilities` RLS, `vehicle_capabilities` role-aware SELECT RLS, write policies, spatial function security, parameter validation, and later-phase boundary guards.

3. **Phase 4 Incident State Machine & Management Verification (Static)**:
   - Script: `tests/phase4-incident-verification.mjs`
   - Result: **170 passed / 0 failed**
   - Covers: Exact 10-state lifecycle CHECK constraint, concurrency-safe reference generator with transaction advisory lock, mutation policy closure, authoritative transition RPC with locked transition matrix, privileged intake RPC, locked Phase 2 service types, and real database queue.

4. **Phase 5 Operational Mapping & Fleet Telemetry Verification (Static)**:
   - Script: `tests/phase5-operations-map-verification.mjs`
   - Result: **257 passed / 0 failed**
   - Covers: Zero-parameter snapshot RPC signature, session-derived tenancy and role check, role restriction, privilege model, exact 7 active statuses, aggregate-level deterministic incident and vehicle ordering, active fleet scoping, unmapped incident/vehicle tolerance, PostGIS coordinate derivation, zero new tables, read-only guarantee, fail-closed data validation without data fabrication, real filter-driven selection clearing, truthful last-known telemetry, and Phase 6-9 boundary enforcement.

5. **Phase 6 Capability-Aware Matching & Dispatch Engine Verification (Static)**:
   - Script: `tests/phase6-dispatch-verification.mjs`
   - Result: **145 passed / 0 failed**
   - Covers: Partial unique indexes (5 indexes), preflight duplicate validation, assignment mutation lockdown, read-only candidate evaluation RPC, candidate eligibility and capability matching, deterministic aggregate PostGIS proximity ranking, atomic dispatch RPC with row-level locking, atomic reassignment RPC with cancelled state handling, RPC ACL revocations and authenticated grants, data layer fail-closed property-presence and strict nullable validation, UI confirmation view, stale-conflict notice preservation, reassignment notice display, truthful unranked telemetry, defensive date formatting, and serialized workspace queued refresh.

6. **Total Static Check Count**:
   - **756 passed / 0 failed** across all 5 verification suites.

7. **Code Quality & Type Checking**:
   - ESLint: **0 errors, 0 warnings** (`npm run lint`)
   - TypeScript: **0 errors** (`npx tsc --noEmit`)

8. **Build & Compilation Status**:
   - Standard Production Build (`npm run build` / `next build`): Passed successfully during final verification.
   - Webpack Diagnostic Build (`npx next build --webpack`): **Compiled successfully**; all 12 routes generated and verified. `package.json` retains standard `"build": "next build"`.

9. **Database Structural Verification Scripts**:
   - `supabase/verify_phase3.sql`, `supabase/verify_phase4.sql`, `supabase/verify_phase5.sql`, `supabase/verify_phase6.sql`: Provided for manual SQL Editor execution against target Supabase databases. In this implementation environment, `supabase/verify_phase6.sql` has been updated with catalog privilege assertions across all Phase 6 RPCs but has not been executed live.

---

### 7. Phased Roadmap Boundaries

| Phase | Focus Area | Status |
| :--- | :--- | :--- |
| **Phase 1** | Application Foundation & Route Shells | **Completed** |
| **Phase 2** | Database Schema, Tenancy, Auth & RLS | **Completed (Statically Verified: 89 passed / 0 failed)** |
| **Phase 3** | Core Data Schema & PostGIS Spatial Extensions | **Completed (Statically Verified: 95 passed / 0 failed; DB verification script provided)** |
| **Phase 4** | Incident Intake, Queues & Operational State Machine | **Completed (Statically Verified: 170 passed / 0 failed; DB verification script provided)** |
| **Phase 5** | Operational Mapping & Fleet Telemetry Foundation | **Completed (Statically Verified: 257 passed / 0 failed; DB verification script provided)** |
| **Phase 6** | Capability-Aware Matching & Dispatch Engine | **Completed (Statically Verified: 145 passed / 0 failed; DB verification script provided for manual execution)** |
| Phase 7 | Field Worker PWA & Realtime Telemetry | Deferred |
| Phase 8 | Customer Location Verification & GPS Flow | Deferred |
| Phase 9 | Twilio / Vapi Telephony & Automated Intake | Deferred |
| Phase 10 | Hardening, Audit Logs & Production Deployment | Deferred |
