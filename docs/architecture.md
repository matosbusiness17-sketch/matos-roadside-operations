# Matos Systems — Roadside Operations & Dispatch System
## Architecture Overview (Implementation Phase 2: Tenancy, Auth & RLS)

### 1. Architectural Philosophy

The Matos Systems Roadside Operations & Dispatch System is engineered as a mission-critical operational system for roadside assistance, vehicle towing, and recovery service operators.

**Phase 2** establishes the core PostgreSQL data schema, organization multi-tenancy, authentication, role authorization, and Row Level Security (RLS) model.

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
- **Backend & Database Platform**: Supabase (PostgreSQL 15+, Row Level Security, Supabase Auth)
- **Session Management**: `@supabase/ssr` (Cookie-based session refresh and middleware validation)
- **Deployment Platform**: Vercel

---

### 3. Database Schema & Entities

The database schema is defined in [supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql](file:///c:/Users/Admin/OneDrive/Documents/Coding/matos-roadside-operations/supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql).

#### 3.1 Entity Model & Relationships

```
organizations (Tenancy Root)
  ├── profiles (1:N, Auth Users bound to Organization with app_role)
  │     └── worker_profiles (1:1 extension for field workers)
  ├── vehicles (1:N, Mobile response units)
  ├── worker_vehicle_assignments (N:N, Shift bindings between workers and vehicles)
  ├── incidents (1:N, Roadside assistance requests)
  │     └── assignments (1:N, Dispatched worker & vehicle bindings)
  └── operational_events (1:N, Immutable append-only audit trail)
```

#### 3.2 Relational Integrity & Cross-Tenant Guards
- All operational tables feature an `organization_id` foreign key referencing `organizations(id)`.
- Composite unique constraints (e.g. `(id, organization_id)`) are defined on `profiles`, `worker_profiles`, `vehicles`, and `incidents`.
- Dependent junction tables (`worker_vehicle_assignments` and `assignments`) use **composite foreign keys** ensuring that a worker, vehicle, and incident bound together **must strictly belong to the same organization**, preventing accidental cross-organization leakage.

---

### 4. Role Authorization Model

Phase 2 enforces three distinct application roles defined by the `app_role` PostgreSQL enum:

| Role | Permitted Application Surfaces | Database & Operational Permissions |
| :--- | :--- | :--- |
| **`admin`** | `/operations`, `/incidents`, `/fleet`, `/history`, `/admin` | Full read/write access to organization operational data, user management, and organizational configuration. |
| **`operator`** | `/operations`, `/incidents`, `/fleet`, `/history` | Full read/write access to organization operational data, fleet units, incidents, and dispatches. **Strictly blocked from `/admin`.** |
| **`worker`** | `/worker` | Restricted to own worker profile, active vehicle assignments, and **only incidents explicitly dispatched to this worker**. **Strictly blocked from desktop operator surfaces.** |

#### 4.1 Privilege Escalation Prevention
- A database trigger (`trg_protect_profile_role`) executes before any `UPDATE` on `public.profiles`:
  1. Forbids changing `organization_id` under all circumstances.
  2. Forbids changing `role` unless the calling user is an active `admin` within the same organization.
  3. Ordinary users cannot promote themselves or escalate privileges via direct Supabase API requests.

---

### 5. Row Level Security (RLS) Strategy

Row Level Security is enabled on **all 8 application tables**. Anonymous clients (`auth.role() != 'authenticated'`) have **zero access** to any table.

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
   - `SELECT`: Admins and operators can view all incidents in the organization. **Workers can strictly only view incidents where an assignment exists for their worker ID.**
   - `INSERT`: Restricted to admins and operators.
   - `UPDATE`: Admins/operators, plus assigned workers (for incident status progression).
7. **`assignments`**:
   - `SELECT`: Admins and operators can view all. Workers can only view assignments matching their worker ID.
   - `INSERT`: Restricted to admins and operators.
   - `UPDATE`: Admins/operators, plus assigned workers.
8. **`operational_events`**:
   - `SELECT`: Admins and operators can view all organization events. Workers can view events where they are the actor.
   - `INSERT`: Permitted for authenticated actions (`actor_id = auth.uid()`).
   - `UPDATE / DELETE`: **Strictly rejected by database trigger (`trg_immutable_operational_events`)** to guarantee audit trail immutability.

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

### 7. Static Security Verification

A static verification suite in `tests/security-verification.mjs` verifies code structure and security patterns:
- Confirms database migration schema, RLS enablement on all 8 tables, triggers, and composite foreign keys.
- Confirms absence of hardcoded demo passwords in source code.
- Confirms fail-closed logic in middleware for missing configuration, unauthenticated requests, profile errors, null profiles, inactive profiles, and unrecognized roles.
- Confirms role boundaries for workers, operators, and admins across middleware and server components.
- Confirms absence of default admin roles in navigation.
- Confirms absence of fabricated identity strings in worker components.

---

### 8. Development & Demo Account Provisioning

The seed file `supabase/seed.sql` sets up the demonstration environment:
1. Creates demo organization: `Matos Roadside Assistance (Demo Org)` (`00000000-0000-0000-0000-000000000001`).
2. Creates demo vehicles: `Unit 101 - Flatbed Heavy Tow` and `Unit 102 - Rapid Service & Lockout`.
3. Defines the stored procedure `public.provision_demo_user(email, role, display_name)` to bind Supabase Auth users to their operational profiles.

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

### 9. Phased Roadmap Boundaries

| Phase | Focus Area | Status |
| :--- | :--- | :--- |
| **Phase 1** | Application Foundation & Route Shells | **Completed** |
| **Phase 2** | Database Schema, Tenancy, Auth & RLS | **Completed (Statically Verified)** |
| Phase 3 | Core Data Schema & PostGIS Spatial Extensions | Deferred |
| Phase 4 | Incident Intake, Queues & Operational State Machine | Deferred |
| Phase 5 | Mapbox Live Operational Mapping & Fleet Telemetry | Deferred |
| Phase 6 | Capability-Aware Matching & Dispatch Engine | Deferred |
| Phase 7 | Field Worker PWA & Realtime Telemetry | Deferred |
| Phase 8 | Customer Location Verification & GPS Flow | Deferred |
| Phase 9 | Twilio / Vapi Telephony & Automated Intake | Deferred |
| Phase 10 | Hardening, Audit Logs & Production Deployment | Deferred |
