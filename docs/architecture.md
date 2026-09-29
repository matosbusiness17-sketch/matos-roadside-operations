# Matos Systems — Roadside Operations & Dispatch System
## Architecture Overview (Implementation Phase 4: Incident Management & Operational State Machine)

### 1. Architectural Philosophy

The Matos Systems Roadside Operations & Dispatch System is engineered as a mission-critical operational system for roadside assistance, vehicle towing, and recovery service operators managing mobile response units.

**Phase 2** established the core PostgreSQL data schema, organization multi-tenancy, authentication, role authorization, and Row Level Security (RLS) model.
**Phase 3** established the database spatial and capability data architecture: PostGIS spatial representation (`geography(Point, 4326)`), normalized roadside capability taxonomy (`service_capabilities` and `vehicle_capabilities`), incident structured vehicle and location fields, and tenant-safe, role-bounded spatial database functions.
**Phase 4** adds controlled incident intake, an authoritative 10-state lifecycle state machine, atomic operational audit events, closed direct mutation RLS paths, database-guarded status transitions, and real database-backed operator queue, intake, and detail record inspection.

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
- **Session Management**: `@supabase/ssr` (Cookie-based session refresh and middleware validation)
- **Deployment Platform**: Vercel

---

### 3. Database Schema & Entities

The database schema is defined across three sequential migrations:
- Phase 2: [supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql)
- Phase 3: [supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql)
- Phase 4: [supabase/migrations/20260929140000_phase4_incident_state_machine.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260929140000_phase4_incident_state_machine.sql)

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

#### 3.2 Relational Integrity & Cross-Tenant Guards
- All operational tables feature an `organization_id` foreign key referencing `organizations(id)`.
- Composite unique constraints (e.g. `(id, organization_id)`) are defined on `profiles`, `worker_profiles`, `vehicles`, and `incidents`.
- Dependent junction tables (`worker_vehicle_assignments`, `assignments`, and `vehicle_capabilities`) use **composite foreign keys** ensuring that related entities **must strictly belong to the same organization**, preventing accidental cross-organization leakage.

#### 3.3 Phase 3 Spatial & Capability Extensions
- **Authoritative Spatial Types**: All spatial coordinates are stored as `geography(Point, 4326)`. Numeric lat/long pairs are not used as authoritative database storage. Distances are calculated natively in metres using PostGIS geodesic calculations.
- **Spatial GiST Indexes**: High-performance spatial indexing on `incidents(location)` and `vehicles(last_known_location)` for accelerated proximity queries (`ST_DWithin`, `ST_Distance`).
- **Normalized Capability Model**: Controlled catalogue (`service_capabilities`) and a tenant-isolated junction table (`vehicle_capabilities`).
- **Composite Tenant FK**: `vehicle_capabilities` enforces `FOREIGN KEY (vehicle_id, organization_id) REFERENCES public.vehicles(id, organization_id)` on delete cascade.
- **Role-Aware vehicle_capabilities RLS**:
  - `vehicle_capabilities_select`: Admins and operators can view all capabilities across the organization. Field workers are strictly restricted to capabilities of vehicles for which they hold an active shift assignment (`worker_vehicle_assignments`). Anonymous clients have zero access.
  - `vehicle_capabilities_insert`: Admins and operators only with caller organization binding.
  - `vehicle_capabilities_update`: Admins and operators only with caller organization binding in both `USING` and `WITH CHECK`.
  - `vehicle_capabilities_delete`: Admins and operators only with caller organization binding.
- **Structured Incident Vehicle Fields**: Structured `vehicle_registration`, `vehicle_make`, `vehicle_model`, `vehicle_year`, and `vehicle_color` columns on `incidents`.
- **Location Fields**:
  - `location` (`geography(Point, 4326)`): Geodesic coordinate point.
  - `location_accuracy` (`DOUBLE PRECISION`): Horizontal accuracy estimate in metres.
  - `location_source` (`TEXT`): Application-level source convention currently uses `operator_manual`, `customer_link`, `telephony_intake`, and `device_gps`. The database column remains `TEXT` and does not enforce these values as an enum/domain.

---

### 4. Role Authorization Model

Phases 2 through 4 enforce three application roles defined by the `app_role` PostgreSQL enum:

| Role | Permitted Application Surfaces | Database & Operational Permissions |
| :--- | :--- | :--- |
| **`admin`** | `/operations`, `/incidents`, `/fleet`, `/history`, `/admin` | Organization-scoped reads; incident intake via controlled `create_incident` RPC, lifecycle transitions via controlled `transition_incident_status` RPC; user management, capabilities, and organizational configuration. |
| **`operator`** | `/operations`, `/incidents`, `/fleet`, `/history` | Organization-scoped reads; incident intake via controlled `create_incident` RPC, lifecycle transitions via controlled `transition_incident_status` RPC; fleet units and capabilities. **Strictly blocked from `/admin`.** |
| **`worker`** | `/worker` | Restricted to own worker profile, active vehicle assignments, actively assigned vehicle capabilities, and **only incidents explicitly dispatched to this worker** under existing assignment-based SELECT RLS. **Worker does not hold Phase 4 operator lifecycle mutation authority (worker state progression is deferred to subsequent worker functionality). Strictly blocked from desktop operator surfaces.** |

#### 4.1 Privilege Escalation Prevention
- A database trigger (`trg_protect_profile_role`) executes before any `UPDATE` on `public.profiles`:
  1. Forbids changing `organization_id` under all circumstances.
  2. Forbids changing `role` unless the calling user is an active `admin` within the same organization.
  3. Ordinary users cannot promote themselves or escalate privileges via direct Supabase API requests.

---

### 5. Row Level Security (RLS) Strategy

Row Level Security is enabled on **all 10 application tables** (8 from Phase 2 + `service_capabilities` and `vehicle_capabilities` from Phase 3). Anonymous clients (`auth.role() != 'authenticated'`) have **zero access** to any table.

1. **`organizations`**:
   - `SELECT`: Users can only read their own organization (`id = get_current_user_organization_id()`).
   - `UPDATE`: Only organization admins.
2. **`profiles`**:
   - `SELECT`: Users can view member profiles in their organization.
   - `UPDATE`: Users can update their own display name (trigger guards role escalation). Admins can update roles and activation status.
3. **`worker_profiles`**:
   - `SELECT`: Admins and operators can view all workers in the organization. Workers can only view their own record.
   - `UPDATE`: Workers can toggle their own `availability_status`. Admins/operators can update worker records.
4. **`vehicles`**:
   - `SELECT`: All authenticated organization members.
   - `INSERT / UPDATE`: Restricted to admins and operators.
5. **`worker_vehicle_assignments`**:
   - `SELECT`: Admins and operators can view all. Workers can only view their own unit assignments.
   - `INSERT / UPDATE`: Restricted to admins and operators.
6. **`incidents`**:
   - `SELECT`: Admins and operators can view all incidents in the organization. Workers can strictly only view incidents where an assignment exists for their worker ID according to existing SELECT RLS.
   - `INSERT`: Generic direct INSERT policy dropped (`incidents_insert_operator_admin` dropped in Phase 4). Incident creation occurs exclusively via the `create_incident` SECURITY DEFINER RPC, restricted internally to admins and operators.
   - `UPDATE`: Generic direct UPDATE policies dropped (`incidents_update` and `incidents_update_operator_admin` dropped in Phase 4). Phase 4 lifecycle transitions occur exclusively via the `transition_incident_status` SECURITY DEFINER RPC, restricted internally to admins and operators.
   - **Status Protection**: Database trigger `trg_protect_incident_status` guards the `status` column, rejecting direct UPDATE statements that attempt status modifications outside of the authorized state machine function.
7. **`assignments`**:
   - `SELECT`: Admins and operators can view all. Workers can only view assignments matching their worker ID.
   - `INSERT`: Restricted to admins and operators.
   - `UPDATE`: Admins/operators, plus assigned workers.
8. **`operational_events`**:
   - `SELECT`: Admins and operators can view all organization events. Workers can view events where they are the actor.
   - `INSERT`: Generic direct INSERT policy closed in Phase 4 (`events_insert` dropped). Operational events are generated exclusively through controlled privileged RPC transactions.
   - `UPDATE / DELETE`: **Strictly rejected by database trigger (`trg_immutable_operational_events`)** to guarantee audit trail immutability.
9. **`service_capabilities`**:
   - `SELECT`: Authenticated users can view active capabilities (`is_active = true`).
   - `INSERT / UPDATE / DELETE`: Restricted to admins and operators.
10. **`vehicle_capabilities`**:
    - `SELECT`: Admins/operators view all in caller organization; workers restricted to vehicles where an active `worker_vehicle_assignments` binding exists in caller organization.
    - `INSERT`: Admins/operators only with caller organization binding.
    - `UPDATE`: Admins/operators only with caller organization binding in both `USING` and `WITH CHECK`.
    - `DELETE`: Admins/operators only with caller organization binding.

---

### 6. Authentication, Session & Boundary Handling

- **Supabase Auth**: Authenticates users using email and password credentials.
- **Fail-Closed Middleware (`src/middleware.ts`)**:
  - Automatically refreshes session tokens via `@supabase/ssr` cookies on all incoming requests.
  - Rejects unconfigured or placeholder Supabase credentials by redirecting protected requests to `/login`.
  - Rejects unauthenticated requests to protected routes by redirecting to `/login`.
  - Rejects failed profile queries or null profiles by redirecting to `/login?error=profile_missing`.
  - Rejects inactive user accounts by signing out and redirecting to `/login?error=account_inactive`.
  - Rejects undefined, null, or unrecognized roles by redirecting to `/login?error=unauthorized_role`.
  - Enforces role boundaries:
    - Workers attempting operator desktop routes are redirected to `/worker`.
    - Operators attempting `/admin` are redirected to `/operations`.
    - Admins/operators attempting `/worker` are redirected to `/operations` (must not be treated as authorized field workers).
- **Server-Side Defense in Depth**:
  - `src/app/(operator)/layout.tsx`: Verifies `getCurrentUser()`. If missing or inactive, redirects to `/login`. If role is `worker`, redirects to `/worker`.
  - `src/app/(operator)/admin/page.tsx`: Verifies `getCurrentUser()`. If missing or inactive, redirects to `/login`. If role is not `admin`, renders Access Denied.
  - `src/app/worker/layout.tsx` & `src/app/worker/page.tsx`: Verifies `getCurrentUser()`. If missing, inactive, or non-worker, redirects out. No mock or fallback identities are rendered.
  - `src/components/operator/operator-nav.tsx`: Dynamically filters navigation so that the Admin link is rendered **only** when `userRole === 'admin'`. No default admin role exists.

---

### 7. Verification Status & Security Inspection

Verification across Phase 2, Phase 3, and Phase 4 is structured into separate, clear categories:

1. **Phase 2 Security Verification (Static)**:
   - Script: `tests/security-verification.mjs`
   - Result: **89 passed / 0 failed**
   - Covers: Core schema, 8 tables RLS, triggers, password hygiene, middleware fail-closed checks, role boundaries.

2. **Phase 3 Spatial & Capability Verification (Static)**:
   - Script: `tests/phase3-spatial-verification.mjs`
   - Result: **95 passed / 0 failed**
   - Covers: PostGIS extensions, spatial columns, GiST indexing, `service_capabilities` RLS, `vehicle_capabilities` role-aware SELECT RLS, write policies (INSERT/UPDATE/DELETE with USING and WITH CHECK), spatial function security, parameter validation (NaN, Infinity, bounds), and later-phase boundary guards.

3. **Phase 3 Database Structural Verification (SQL Script)**:
   - Script: `supabase/verify_phase3.sql`
   - Status: Database structural verification script provided for manual Supabase execution; not executed in this workspace.
   - Purpose: Non-destructive catalog and policy expression checks in Supabase SQL Editor. Does not constitute authenticated runtime cross-tenant integration testing.

4. **Phase 4 Incident State Machine & Management Verification (Static)**:
   - Script: `tests/phase4-incident-verification.mjs`
   - Result: **170 passed / 0 failed**
   - Covers: Migration order (DROP < UPDATE < DEFAULT < ADD CONSTRAINT), exact 10-state lifecycle CHECK constraint, concurrency-safe reference generator with transaction advisory lock (scoped by organization and calendar year), internal helper privilege revoking (PUBLIC, anon, authenticated), mutation policy closure by polcmd (direct INSERT/UPDATE on incidents dropped, direct INSERT on events dropped), authoritative transition function (`transition_incident_status`) with locked transition matrix and terminal state blocking, privileged intake function (`create_incident`) returning JSONB with required keys and operational event ID, locked Phase 2 service types (7 types; no winching or other), locked priorities (4 types), no nonexistent enum casts, direct TEXT insert, session derivation, finite coordinates and accuracy bounds, vehicle year bounds (1900-2100), operator_manual provenance contract, real database queue with error hygiene, seed execution order, and strict Phase 5+ boundaries.

5. **Phase 4 Database Structural Verification (SQL Script)**:
   - Script: `supabase/verify_phase4.sql`
   - Status: Database structural verification script provided for manual Supabase execution; not executed in this workspace.
   - Purpose: Non-destructive catalog and structural verification in Supabase SQL Editor. Does not replace authenticated runtime cross-tenant integration testing.

---

### 8. Development & Demo Account Provisioning

The seed file `supabase/seed.sql` sets up the demonstration environment:
1. Creates demo organization: `Matos Roadside Assistance (Demo Org)` (`00000000-0000-0000-0000-000000000001`).
2. Creates demo vehicles with synthetic spatial coordinates (Dublin metropolitan area):
   - `Unit 101 - Flatbed Heavy Tow` (Dublin City Centre, `[-6.2603, 53.3498]`)
   - `Unit 102 - Rapid Service & Lockout` (Ballsbridge, `[-6.2230, 53.3280]`)
3. Seeds standard service capability catalogue and synthetic vehicle capability bindings.
4. Creates a synthetic demonstration incident:
   - Location: St Stephen's Green South, Dublin 2 (`[-6.2550, 53.3400]`)
   - Accuracy: 12.5m
   - Location source: `location_source = 'device_gps'` (valid synthetic seed value conforming to application-level convention)
   - Vehicle: 2021 Volkswagen Golf Silver Metallic (`211-D-12345`)
   - Required capability: Flatbed Recovery
5. Defines the stored procedure `public.provision_demo_user(email, role, display_name)` to bind Supabase Auth users to operational profiles. For workers, it also binds an active shift assignment to Unit 101.

#### Provisioning Steps:
1. In the Supabase Dashboard, create three users under **Authentication $\rightarrow$ Users $\rightarrow$ Add User**:
   - `admin@matos.local`
   - `operator@matos.local`
   - `worker@matos.local`
2. In the Supabase **SQL Editor**, run:
   ```sql
   SELECT public.provision_demo_user('admin@matos.local', 'admin', 'Alex Admin');
   SELECT public.provision_demo_user('operator@matos.local', 'operator', 'Morgan Operator');
   SELECT public.provision_demo_user('worker@matos.local', 'worker', 'Taylor Worker');
   ```
3. Login via `/login` by selecting the demo email and manually entering the password set during user creation.

---

### 9. Spatial Database Functions & Parameter Validation (Phase 3 Primitives)

Phase 3 implements reusable spatial primitives directly in PostgreSQL with `SECURITY DEFINER` and strict tenant boundaries:

1. **`calculate_incident_vehicle_distance(incident_id, vehicle_id)`**:
   - Calculates geographic distance in **metres** between an incident and vehicle using `ST_Distance`.
   - Derives organization ID from authenticated session.
   - Workers may only calculate distance for incidents and vehicles assigned to them.
   - Admins/operators may calculate distance within their organization.

2. **`get_nearby_vehicles(latitude, longitude, radius_meters, required_capability_id, limit)`**:
   - Retrieves active response vehicles within radius ordered by distance in **metres** (`ST_DWithin` & `ST_Distance`).
   - Supports optional capability filtering via `vehicle_capabilities`.
   - **Strict Parameter Validation**:
     - Validates latitude (-90 to 90) and longitude (-180 to 180); rejects NULL and non-finite / NaN values.
     - Validates search radius: rejects NULL, non-positive (`<= 0`), non-finite (`NaN`, `Infinity`, `-Infinity`), and values exceeding the maximum operational search radius of **200,000 metres (200 km)**.
     - Safely bounds result limit (`LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)`).
   - Derives organization strictly from authenticated session (`get_current_user_organization_id()`); client-supplied organization IDs are never accepted.
   - Restricted to `admin` and `operator` roles; field workers are strictly denied access to prevent fleet-wide visibility leakage.

3. **`get_nearby_vehicles_for_incident(incident_id, radius_meters, limit)`**:
   - Directly validates search radius before execution (same strict bounds: finite, `> 0`, `<= 200,000 metres`).
   - Retrieves nearby units for an incident's location with automatic capability filtering.
   - Organization derived from session; validates incident belongs to caller organization.

4. **Security Discipline**:
   - `EXECUTE` revoked from `PUBLIC` on all spatial functions; granted exclusively to `authenticated`.
   - `SET search_path = public, extensions` prevents search path hijacking.
   - **Data retrieval only**: NO automated dispatch, ranking, scoring, or worker assignment.

---

### 10. Phase 4 Incident Lifecycle & Operational State Machine

1. **Authoritative 10-State Machine**:
   - States: `new`, `triaged`, `ready_for_dispatch`, `dispatched`, `en_route`, `on_scene`, `in_progress`, `completed`, `cancelled`, `unable_to_complete`.
   - Terminal states: `completed`, `cancelled`, `unable_to_complete`.
   - Migration order guarantees zero constraint violations: DROP old constraint -> UPDATE existing 'created' rows to 'new' -> SET DEFAULT 'new' -> ADD authoritative 10-state CHECK constraint.

2. **Concurrency-Safe Reference Generator**:
   - `public.generate_incident_reference_number(p_org_id UUID)`
   - Uses transaction-scoped advisory locking (`pg_advisory_xact_lock`) scoped by organization and calendar year to serialize concurrent allocations and prevent duplicate reference generation within that scope.
   - Strictly internal helper: execution revoked from `PUBLIC`, `authenticated`, and `anon`.

3. **Controlled RPC Mutations & RLS Policy Closures**:
   - Direct INSERT and UPDATE policies on `public.incidents` are dropped. Mutations are exclusively performed via SECURITY DEFINER RPCs.
   - Direct INSERT policy on `public.operational_events` is dropped; events are appended exclusively through privileged RPC transactions.
   - Status updates are guarded by `trg_protect_incident_status` trigger, which blocks any direct UPDATE attempting to alter `status` outside of the authorized transition function.

4. **Privileged Functions**:
   - `create_incident`: Exact 16-parameter identity, `RETURNS JSONB`. Validates locked Phase 2 TEXT service types and priorities without enum casts, validates coordinates and accuracy, enforces `operator_manual` provenance, atomically logs `INCIDENT_CREATED` event, and returns JSONB payload (`success`, `incident_id`, `reference_number`, `status`, `event_id`, `created_at`).
   - `transition_incident_status`: Row-locks incident via `FOR UPDATE`, enforces the locked transition matrix, blocks terminal state jumps, sets GUC flag `matos.authorized_status_transition`, atomically updates status, and logs `INCIDENT_STATUS_CHANGED` operational event.

---

### 11. Phased Roadmap Boundaries

| Phase | Focus Area | Status |
| :--- | :--- | :--- |
| **Phase 1** | Application Foundation & Route Shells | **Completed** |
| **Phase 2** | Database Schema, Tenancy, Auth & RLS | **Completed (Statically Verified: 89 passed / 0 failed)** |
| **Phase 3** | Core Data Schema & PostGIS Spatial Extensions | **Completed (Statically Verified: 95 passed / 0 failed; DB verification script provided)** |
| **Phase 4** | Incident Intake, Queues & Operational State Machine | **Completed (Statically Verified: 170 passed / 0 failed; DB verification script provided)** |
| Phase 5 | Mapbox Live Operational Mapping & Fleet Telemetry | Deferred |
| Phase 6 | Capability-Aware Matching & Dispatch Engine | Deferred |
| Phase 7 | Field Worker PWA & Realtime Telemetry | Deferred |
| Phase 8 | Customer Location Verification & GPS Flow | Deferred |
| Phase 9 | Twilio / Vapi Telephony & Automated Intake | Deferred |
| Phase 10 | Hardening, Audit Logs & Production Deployment | Deferred |
