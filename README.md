# Matos Systems — Roadside Operations & Dispatch System

A portfolio-grade operational system for roadside assistance, vehicle towing, and recovery service operators managing mobile response units.

Developed by **Matos Systems** — *Customer Journeys + Business Workflows*.

---

## 1. Project Purpose

The system connects customer intake, incident structuring, capability-aware dispatch, mobile response units, and genuine GPS tracking into a unified operational workflow:

$$\text{Customer Request} \longrightarrow \text{Automated Intake} \longrightarrow \text{Structured Incident} \longrightarrow \text{Capability Dispatch} \longrightarrow \text{Response Worker} \longrightarrow \text{Completion}$$

---

## 2. Current Implementation Phase: Phase 6 (Capability-Aware Matching & Dispatch Engine)

This repository is currently at **Implementation Phase 6: Capability-Aware Matching & Dispatch Engine**.

### What Has Been Implemented & Enforced:
- **Phase 2 Foundation (Locked & Preserved — Statically Verified: 89 passed / 0 failed)**:
  - Multi-tenant organization scoping (`organizations`)
  - Explicit role authorization (`admin`, `operator`, `worker`) via PostgreSQL enum `app_role`
  - Fail-closed route gating in middleware (`src/middleware.ts`) and server components
  - Row Level Security (RLS) across all core tables with zero anonymous access
- **Phase 3 Spatial & Capability Foundation (Database Primitives — Statically Verified: 95 passed / 0 failed)**:
  - **PostGIS Spatial Extension**: `geography(Point, 4326)` used as the authoritative spatial representation for incident and vehicle coordinates (distances calculated natively in metres).
  - **GiST Spatial Indexing**: Spatial indexes on `incidents(location)` and `vehicles(last_known_location)` for efficient spatial lookups and radius searches (`ST_DWithin`).
  - **Normalized Roadside Capabilities**: `service_capabilities` catalogue and tenant-isolated `vehicle_capabilities` junction table with composite foreign keys.
  - **Secure Spatial Functions**: `calculate_incident_vehicle_distance`, `get_nearby_vehicles`, and `get_nearby_vehicles_for_incident` with strict finite parameter checks.
- **Phase 4 Incident Management & Operational State Machine (Statically Verified: 170 passed / 0 failed)**:
  - **Authoritative 10-State Lifecycle**: `new`, `triaged`, `ready_for_dispatch`, `dispatched`, `en_route`, `on_scene`, `in_progress`, `completed`, `cancelled`, `unable_to_complete`.
  - **Concurrency-Safe Incident Reference Number Generator**: `generate_incident_reference_number` with transaction-scoped advisory locks.
  - **Closed Direct Mutation RLS Paths**: Generic direct `INSERT` and `UPDATE` on incidents and `INSERT` on operational events dropped.
  - **Privileged RPCs**: `create_incident` and `transition_incident_status` with `FOR UPDATE` concurrency row locking.
- **Phase 5 Operational Mapping & Fleet Telemetry Foundation (Statically Verified: 257 passed / 0 failed)**:
  - **Authoritative Snapshot RPC (`public.get_operations_map_snapshot`)**:
    - Zero-parameter contract: session-derived tenant and role (admin/operator only; workers rejected).
    - Read-only execution guarantee over 7 active incident statuses.
    - Deterministic ordering inside `jsonb_agg`: incidents by priority, oldest `created_at ASC`, and `id ASC`; vehicles by `callsign ASC, id ASC`.
    - Unified three-region operational mapping workspace (`/operations`) with Mapbox GL JS map, queue, and detail panel.
    - Real filter-driven selection clearing and truthful last-known location fleet visualization.
- **Phase 6 Capability-Aware Matching & Dispatch Engine (Statically Verified: 145 passed / 0 failed)**:
  - **Concurrency Protection via 5 Partial Unique Indexes**:
    - `idx_uq_wva_active_worker` on `worker_vehicle_assignments(organization_id, worker_id) WHERE status = 'active'`
    - `idx_uq_wva_active_vehicle` on `worker_vehicle_assignments(organization_id, vehicle_id) WHERE status = 'active'`
    - `idx_uq_assignments_active_incident` on `assignments(organization_id, incident_id) WHERE status IN ('assigned', 'accepted', 'en_route', 'on_scene')`
    - `idx_uq_assignments_active_worker` on `assignments(organization_id, worker_id) WHERE status IN ('assigned', 'accepted', 'en_route', 'on_scene')`
    - `idx_uq_assignments_active_vehicle` on `assignments(organization_id, vehicle_id) WHERE vehicle_id IS NOT NULL AND status IN ('assigned', 'accepted', 'en_route', 'on_scene')`
  - **Assignment Mutation Lockdown**: Generic direct `INSERT` and `UPDATE` policies dropped; direct table mutation (`INSERT`, `UPDATE`, `DELETE`) revoked from `authenticated` and `anon`; `SELECT` visibility preserved.
  - **Authoritative Candidate Evaluation RPC (`public.get_dispatch_candidates(UUID)`)**:
    - Session-derived tenant and role check (admin/operator only; workers rejected).
    - Strict eligibility: active shift binding (`status = 'active'`), available worker (`availability_status = 'available'`), active profile (`is_active = true`), active vehicle (`is_active = true`), and no active assignment conflicts.
    - Accurate capability matching: if incident specifies `required_capability_id`, vehicle must have a matching row in `vehicle_capabilities` and the referenced `service_capabilities` record must be active (`service_capabilities.is_active = true`).
    - Deterministic PostGIS proximity ordering: `ST_Distance(v_inc.location, v.last_known_location)` with ordering `distance_meters ASC, callsign ASC, worker_id ASC` inside final `jsonb_agg`.
    - Missing-location tolerance: candidates with unmapped vehicles or unmapped incidents safely categorized as unranked with explicit `ranking_reason` and zero coordinate fabrication.
  - **Atomic Initial Dispatch RPC (`public.dispatch_incident(UUID, UUID, UUID)`)**:
    - Row-level locking (`FOR UPDATE`) on incident, worker, vehicle, and shift binding.
    - Transaction-time re-validation of eligibility and active conflict checks.
    - Reuses Phase 4 `transition_incident_status` (`ready_for_dispatch` -> `dispatched`).
    - Creates assignment record in status `assigned` and records `ASSIGNMENT_CREATED` operational audit event.
  - **Atomic Reassignment RPC (`public.reassign_incident(UUID, UUID, UUID, UUID)`)**:
    - Row-level locking (`FOR UPDATE`) on incident and current assignment.
    - Validates incident is in `dispatched` status and current assignment is still in status `assigned`.
    - Cancels prior assignment (`status = 'cancelled'`) without fabricating `completed_at` timestamps.
    - Creates replacement assignment (`status = 'assigned'`) and records `INCIDENT_REASSIGNED` operational event.
    - Reassignment exclusion ignores only the exact current assignment being replaced during conflict validation.
  - **Fail-Closed Application Data Layer (`src/lib/dispatch/data.ts`)**:
    - Required property presence checks for contract keys (e.g. `required_capability`, `current_assignment`).
    - Strict nullable field validation: malformed non-null values for `registration_number` or `vehicle_location_updated_at` reject the payload rather than silently coercing to `null`.
    - Authoritative operational timestamp validation: enforces non-empty, finite ISO timestamps via `Date.parse` and `Number.isFinite`.
  - **Operational Frontend Integration (`DispatchPanel` & `OperationsWorkspace`)**:
    - Stale mutation notice preservation: if a candidate becomes unavailable, the notice *"Dispatch could not be completed. This unit is no longer available. Candidates have been refreshed."* persists across the subsequent workspace and candidate refresh.
    - Reassignment progression notice: *"Reassignment is no longer allowed. The current assignment may have already progressed."* is preserved and displayed in the Assigned Response state.
    - Truthful unranked telemetry: displays vehicle last-known position when incident coordinates are not recorded.
    - Defensive date formatting preventing `NaNd ago` or `Invalid Date`.
    - Serialized queued workspace refresh guaranteeing post-mutation state reconciliation.

### What is Deferred to Subsequent Phases:
- **Phase 7**: Worker PWA, live GPS broadcasting, realtime telemetry
- **Phase 8**: Motorist breakdown location verification & GPS capture
- **Phase 9**: Twilio / Vapi automated voice intake & SMS gateway
- **Phase 10**: Final hardening, audit log exports & production deployment

---

## 3. Core Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 19)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict typing)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Backend & Database**: [Supabase](https://supabase.com/) (PostgreSQL 15+, PostGIS 3+, Supabase Auth, Row Level Security)
- **Spatial Engine**: PostGIS `geography(Point, 4326)`
- **Mapping**: [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) (Native vector map rendering)
- **Session Management**: `@supabase/ssr` (Cookie-based session management and middleware refresh)
- **Deployment Platform**: [Vercel](https://vercel.com/)

---

## 4. High-Level Route Structure & Access Boundaries

The application separates operational concerns into distinct surfaces with server-enforced, fail-closed access boundaries:

### System & General Surfaces
- `/` — System Index & Architecture Directory (Public)
- `/login` — Operational Authentication Portal (Public; email/password authentication; demo buttons populate email only)

### Operator Desktop Surfaces (`(operator)` Route Group)
Desktop-first layout shell with persistent header and dynamic navigation:
- `/operations` — Unified Operational Workspace (Mapbox map, queue, context panel, DispatchPanel; authenticated `admin` & `operator`)
- `/incidents` — Operational Incidents Queue (Real database-backed queue with lifecycle and status filters; authenticated `admin` & `operator`)
- `/incidents/new` — Roadside Incident Intake (Validated manual intake form; authenticated `admin` & `operator`)
- `/incidents/[id]` — Incident Detail & State Machine Transition Record (Detail view and transition controls; authenticated `admin` & `operator`)
- `/fleet` — Fleet & Response Units Shell (Authenticated `admin` & `operator`)
- `/history` — Operational History & Audit Shell (Authenticated `admin` & `operator`)
- `/admin` — System & Organization Administration Shell (**Admin role strictly required**; authenticated operators receive Access Denied; unauthenticated redirected to `/login`)

### Mobile Worker Surface
Mobile-first layout container isolated from desktop operator navigation:
- `/worker` — Mobile Response Worker Shell (Authenticated `worker` role strictly required; non-workers redirected to `/operations`; unauthenticated redirected to `/login`)

### Customer Temporary Interaction Surface
Focused, isolated interaction container accessed via temporary dispatch links:
- `/customer/location/[token]` — Motorist Location Confirmation Shell (Token-isolated; awaiting Phase 8 GPS verification)

---

## 5. Local Setup & Installation

### Prerequisites
- Node.js (v20+ recommended; verified on Node v24)
- npm (v10+)
- A Supabase project with PostGIS extension enabled
- A Mapbox access token (public token with styles:read scope)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/matosbusiness17-sketch/matos-roadside-operations.git
cd matos-roadside-operations
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env.local` located at the **Next.js PROJECT ROOT**:
```bash
cp .env.example .env.local
```

> **IMPORTANT:** Ensure `.env.local` is placed at `matos-roadside-operations/.env.local`, **NOT** inside `/supabase`.

Configure your credentials in `.env.local`:
```ini
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=pk.your_mapbox_public_token
```

### 3. Database Schema Migration & Seeding
1. Open the **SQL Editor** in your Supabase project dashboard.
2. Execute the migrations in order:
   - `supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql`
   - `supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql`
   - `supabase/migrations/20260929140000_phase4_incident_state_machine.sql`
   - `supabase/migrations/20260929150000_phase5_operations_map_snapshot.sql`
   - `supabase/migrations/20260930060000_phase6_dispatch_engine.sql`
3. In the Supabase Dashboard under **Authentication → Users**, create three demo accounts:
   - `admin@matos.local`
   - `operator@matos.local`
   - `worker@matos.local`
   *(Set secure development passwords for each user; note passwords for manual entry at login).*
4. In the Supabase **SQL Editor**, execute `supabase/seed.sql` to seed demo organization, vehicles with coordinates, capabilities, and synthetic demo incident.

### 4. Run Verification Suites
Validate all security, spatial schema, state machine, mapping, and dispatch engine rules:

```bash
# Phase 2 Security & Authentication verification (89 checks)
node tests/security-verification.mjs

# Phase 3 Spatial Schema, Capabilities & Security verification (95 checks)
node tests/phase3-spatial-verification.mjs

# Phase 4 Incident Management & State Machine verification (170 checks)
node tests/phase4-incident-verification.mjs

# Phase 5 Operational Mapping & Fleet Telemetry verification (257 checks)
node tests/phase5-operations-map-verification.mjs

# Phase 6 Capability-Aware Matching & Dispatch Engine verification (145 checks)
node tests/phase6-dispatch-verification.mjs
```

> **Note on Database Structural Verification Scripts**:
> `supabase/verify_phase3.sql`, `supabase/verify_phase4.sql`, `supabase/verify_phase5.sql`, and `supabase/verify_phase6.sql` are non-destructive catalog inspection scripts provided for manual execution in the Supabase SQL Editor. In this implementation environment, `verify_phase6.sql` has been updated with catalog privilege assertions across all Phase 6 RPCs but has not been executed live.

### 5. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Verification Quality Gates & Build Status
To validate code quality, TypeScript types, and compilation:
```bash
# Code Style & Linting (0 errors, 0 warnings)
npm run lint

# TypeScript Typecheck (0 errors)
npx tsc --noEmit

# Standard Next.js Production Build
npm run build
```

> **Build Status Clarification**:
> Static verification (756 checks total across Phases 2–6), linting (`0 errors, 0 warnings`), and TypeScript type checking (`0 errors`) all pass cleanly.
> The standard `npm run build` (`next build` with Turbopack) passed successfully during final verification.
> `package.json` retains the standard `"build": "next build"` command.

---

## 6. Project Directory Layout

```
matos-roadside-operations/
├── docs/                                  # Architectural documentation
│   └── architecture.md                    # Tenancy, Auth, Spatial, State Machine, Mapping & Dispatch Architecture
├── src/
│   ├── app/                               # Next.js App Router routes & layouts
│   │   ├── (operator)/                    # Operator desktop shell route group
│   │   │   ├── layout.tsx                 # Server fail-closed operator layout
│   │   │   ├── operations/                # Unified operational mapping & dispatch workspace
│   │   │   │   └── page.tsx               # Server Component loading operational snapshot
│   │   │   ├── incidents/                 # Database-backed incident queues & inspection
│   │   │   │   ├── page.tsx               # Operational queue with lifecycle/status filters
│   │   │   │   ├── new/                   # Roadside incident intake form
│   │   │   │   └── [id]/                  # Incident detail record & transition controls
│   │   │   ├── fleet/                     # Response units shell
│   │   │   ├── history/                   # Event audit log shell
│   │   │   └── admin/                     # Admin shell (Admin role strictly required)
│   │   ├── customer/                      # Customer interaction surface
│   │   │   └── location/
│   │   │       └── [token]/               # Motorist location verification shell
│   │   ├── worker/                        # Mobile response worker surface
│   │   │   ├── layout.tsx                 # Mobile-first fail-closed worker layout
│   │   │   └── page.tsx                   # Authentic worker status & session
│   │   ├── login/                         # Authentication portal
│   │   │   ├── page.tsx                   # Sign-in page shell
│   │   │   └── login-form.tsx             # Email-only demo fill; manual password entry
│   │   ├── globals.css                    # Tailwind CSS imports & theme
│   │   ├── layout.tsx                     # Root HTML layout
│   │   └── page.tsx                       # Phase 6 Architecture index & route directory
│   ├── components/                        # Reusable UI & surface components
│   │   ├── operations/                    # Phase 5 & 6 Operational workspace components
│   │   │   ├── operations-workspace.tsx   # Client coordinator & serialized queued refresh
│   │   │   ├── incident-queue.tsx         # Incident queue panel with filters & search
│   │   │   ├── operations-map.tsx         # Mapbox GL JS map component with custom markers
│   │   │   ├── operations-context-panel.tsx # Context detail panel with dispatch integration
│   │   │   └── dispatch-panel.tsx         # DispatchPanel with candidate list & confirmation
│   │   ├── incidents/                     # Incident management components
│   │   ├── operator/                      # Operator header & fail-closed navigation tabs
│   │   ├── ui/                            # Base primitives (Button, Badge, Card, Panels)
│   │   └── worker/                        # Genuine worker header components
│   ├── lib/                               # Foundation utilities & integration
│   │   ├── dispatch/                      # Phase 6 Dispatch engine actions & data loader
│   │   │   ├── actions.ts                 # Server actions for dispatch and reassignment
│   │   │   └── data.ts                    # Candidate loader, execution RPC callers & fail-closed validation
│   │   ├── operations/                    # Operational mapping actions and data loader
│   │   │   ├── actions.ts                 # Server action for manual snapshot refresh
│   │   │   └── data.ts                    # Authoritative snapshot loader & fail-closed validation
│   │   ├── auth/                          # Server-side auth context & actions
│   │   ├── incidents/                     # Incident server actions
│   │   ├── supabase/                      # Supabase SSR client handlers
│   │   ├── env.ts                         # Anon, publishable key & Mapbox token validator
│   │   └── utils.ts                       # Classname merge helpers
│   ├── middleware.ts                      # Fail-closed route protection & role boundary middleware
│   └── types/                             # Shared TypeScript interfaces & DB types
├── supabase/                              # Database migrations & seeds
│   ├── migrations/
│   │   ├── 20260928190000_phase2_core_schema_and_rls.sql
│   │   ├── 20260929120000_phase3_spatial_and_capabilities.sql
│   │   ├── 20260929140000_phase4_incident_state_machine.sql
│   │   ├── 20260929150000_phase5_operations_map_snapshot.sql
│   │   └── 20260930060000_phase6_dispatch_engine.sql
│   ├── seed.sql                           # Demo org, vehicles, capabilities & synthetic incident
│   ├── verify_phase3.sql                  # Phase 3 structural verification script
│   ├── verify_phase4.sql                  # Phase 4 structural verification script
│   ├── verify_phase5.sql                  # Phase 5 structural verification script
│   └── verify_phase6.sql                  # Phase 6 structural verification script (ACL catalog check)
├── tests/                                 # Verification suites
│   ├── security-verification.mjs          # Phase 2 security verification (89 checks)
│   ├── phase3-spatial-verification.mjs    # Phase 3 spatial & capability verification (95 checks)
│   ├── phase4-incident-verification.mjs   # Phase 4 incident state machine verification (170 checks)
│   ├── phase5-operations-map-verification.mjs # Phase 5 operational mapping verification (257 checks)
│   └── phase6-dispatch-verification.mjs   # Phase 6 dispatch engine verification (145 checks)
├── .env.example                           # Environment variable specification
├── package.json
└── tsconfig.json
```

---

## 7. Phased Roadmap

- **Phase 1**: Application Foundation & Route Shells (**Completed**)
- **Phase 2**: Database, Tenancy, Authentication & Authorization Foundation (**Completed — Statically Verified: 89 passed / 0 failed**)
- **Phase 3**: Core PostgreSQL Schema & PostGIS Spatial Extensions (**Completed — Statically Verified: 95 passed / 0 failed; DB verification script provided**)
- **Phase 4**: Incident Management & Operational State Machine (**Completed — Statically Verified: 170 passed / 0 failed; DB verification script provided**)
- **Phase 5**: Operational Mapping & Fleet Telemetry Foundation (**Completed — Statically Verified: 257 passed / 0 failed; DB verification script provided**)
- **Phase 6**: Capability-Aware Matching & Dispatch Engine (**Completed — Statically Verified: 145 passed / 0 failed; DB verification script provided for manual execution**)
- **Phase 7**: Response Worker PWA & GPS Tracking (Deferred)
- **Phase 8**: Motorist Temporary SMS Location Confirmation (Deferred)
- **Phase 9**: Twilio / Vapi Automated Voice Intake & SMS Gateway (Deferred)
- **Phase 10**: Hardening, Audit Logs & Production Deployment (Deferred)
