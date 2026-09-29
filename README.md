# Matos Systems — Roadside Operations & Dispatch System

A portfolio-grade operational system for roadside assistance, vehicle towing, and recovery service operators managing mobile response units.

Developed by **Matos Systems** — *Customer Journeys + Business Workflows*.

---

## 1. Project Purpose

The system is designed to connect customer intake, incident structuring, capability-aware dispatch, mobile response units, and genuine GPS tracking into a unified operational workflow:

$$\text{Customer Request} \longrightarrow \text{Automated Intake} \longrightarrow \text{Structured Incident} \longrightarrow \text{Capability Dispatch} \longrightarrow \text{Response Worker} \longrightarrow \text{Completion}$$

---

## 2. Current Implementation Phase: Phase 5 (Operational Mapping & Fleet Telemetry Foundation)

This repository is currently at **Implementation Phase 5: Operational Mapping & Fleet Telemetry Foundation**.

### What Has Been Implemented & Enforced:
- **Phase 2 Foundation (Locked & Preserved)**:
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
    - Zero-parameter contract: tenant organization and user role derived strictly from authenticated session context (`auth.uid()`, `get_current_user_organization_id()`, `get_current_user_role()`).
    - Role-restricted execution: permits `admin` and `operator` roles only; workers strictly rejected.
    - Read-only execution guarantee: executes strictly SELECT queries with zero data mutations.
    - Active incident scoping: returns exactly the 7 active operational statuses (`new`, `triaged`, `ready_for_dispatch`, `dispatched`, `en_route`, `on_scene`, `in_progress`) and excludes terminal statuses (`completed`, `cancelled`, `unable_to_complete`).
    - **Aggregate-Level Deterministic Ordering**:
      - Incidents ordered inside `jsonb_agg(...)` by priority (`critical > high > standard > low`), oldest `created_at ASC`, and `id ASC`.
      - Vehicles ordered inside `jsonb_agg(...)` by `callsign ASC, id ASC`.
    - Active fleet scoping: active vehicles (`is_active = true`) with last-known location timestamps and normalized service capabilities.
    - PostGIS coordinate derivation: numeric longitude (`ST_X`) and latitude (`ST_Y`) derived from geography points with missing-location tolerance (unmapped incidents and vehicles safely included with null coordinates).
    - Strict privilege model: execution revoked from `PUBLIC` and `anon`; granted to `authenticated`.
  - **Fail-Closed Application Data Layer (`src/lib/operations/data.ts`)**:
    - Validates required incident contract fields (`id`, `reference_number`, `status`, `priority`, `service_type`, `customer_name`, `customer_phone`, `location_address`, `created_at`, `updated_at`).
    - Zero timestamp fabrication: never falls back to `new Date().toISOString()`.
    - Zero phone fabrication: never substitutes empty string for required customer phone.
    - Fail closed: returns `INVALID_SNAPSHOT` on malformed payload structure without leaking raw database errors.
  - **Unified Three-Region Operational Workspace (`/operations`)**:
    - Left: Incident Queue with client-side status, priority, and service filters plus operational text search.
    - Center: Interactive Mapbox GL JS map with custom incident priority markers, vehicle callsign markers, and operational bounding.
    - Right: Operational Context Panel providing full record links and inspection.
    - **Real Filter-Driven Selection Clearing**: If a selected incident is hidden by a queue filter or search, actual selection state is cleared (`setSelection(null)`) rather than merely masked.
    - **Truthful Vehicle Position Semantics**: Vehicle positions display the latest stored location snapshot and are not a live GPS feed.
    - **Non-Destructive Manual Refresh**: Atomic snapshot update, selection reconciliation, error warning banner retention on failure, and zero automatic polling.

### What is Deferred to Subsequent Phases:
- **Phase 6**: Capability-matching dispatch engine, automatic assignment & scoring/ranking
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
- `/operations` — Unified Operational Workspace (Mapbox map, queue, context panel; authenticated `admin` & `operator`)
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
3. In the Supabase Dashboard under **Authentication → Users**, create three demo accounts:
   - `admin@matos.local`
   - `operator@matos.local`
   - `worker@matos.local`
   *(Set secure development passwords for each user; note passwords for manual entry at login).*
4. In the Supabase **SQL Editor**, execute `supabase/seed.sql` to seed demo organization, vehicles with coordinates, capabilities, and synthetic demo incident.

### 4. Run Verification Suites
Validate all security, spatial schema, state machine, and operational mapping rules:

```bash
# Phase 2 Security & Authentication verification (89 checks)
node tests/security-verification.mjs

# Phase 3 Spatial Schema, Capabilities & Security verification (95 checks)
node tests/phase3-spatial-verification.mjs

# Phase 4 Incident Management & State Machine verification (170 checks)
node tests/phase4-incident-verification.mjs

# Phase 5 Operational Mapping & Fleet Telemetry verification (257 checks)
node tests/phase5-operations-map-verification.mjs
```

> **Note on Database Structural Verification Scripts**:
> `supabase/verify_phase3.sql`, `supabase/verify_phase4.sql`, and `supabase/verify_phase5.sql` are provided for manual execution in the Supabase SQL Editor for catalog-level expression and privilege inspection. In this implementation environment, static and build verifications have been executed green; `verify_phase5.sql` is provided for manual SQL Editor verification and has not been executed live.

### 5. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Build for Production
To validate TypeScript types, linting, and compile the production bundle:
```bash
npm run lint
npx tsc --noEmit
npm run build
```

---

## 6. Project Directory Layout

```
matos-roadside-operations/
├── docs/                                  # Architectural documentation
│   └── architecture.md                    # Tenancy, Auth, Spatial, State Machine & Mapping Architecture
├── src/
│   ├── app/                               # Next.js App Router routes & layouts
│   │   ├── (operator)/                    # Operator desktop shell route group
│   │   │   ├── layout.tsx                 # Server fail-closed operator layout
│   │   │   ├── operations/                # Unified operational mapping workspace
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
│   │   └── page.tsx                       # Phase 5 Architecture index & route directory
│   ├── components/                        # Reusable UI & surface components
│   │   ├── operations/                    # Phase 5 Operational workspace components
│   │   │   ├── operations-workspace.tsx   # Client coordinator & filter-selection reconciliation
│   │   │   ├── incident-queue.tsx         # Incident queue panel with filters & search
│   │   │   ├── operations-map.tsx         # Mapbox GL JS map component with custom markers
│   │   │   └── operations-context-panel.tsx # Context detail panel with truthful last-known telemetry
│   │   ├── incidents/                     # Incident management components
│   │   ├── operator/                      # Operator header & fail-closed navigation tabs
│   │   ├── ui/                            # Base primitives (Button, Badge, Card, Panels)
│   │   └── worker/                        # Genuine worker header components
│   ├── lib/                               # Foundation utilities & integration
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
│   │   └── 20260929150000_phase5_operations_map_snapshot.sql
│   ├── seed.sql                           # Demo org, vehicles, capabilities & synthetic incident
│   ├── verify_phase3.sql                  # Phase 3 structural verification script
│   ├── verify_phase4.sql                  # Phase 4 structural verification script
│   └── verify_phase5.sql                  # Phase 5 structural verification script (ACL catalog check)
├── tests/                                 # Verification suites
│   ├── security-verification.mjs          # Phase 2 security verification (89 checks)
│   ├── phase3-spatial-verification.mjs    # Phase 3 spatial & capability verification (95 checks)
│   ├── phase4-incident-verification.mjs   # Phase 4 incident state machine verification (170 checks)
│   └── phase5-operations-map-verification.mjs # Phase 5 operational mapping verification (257 checks)
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
- **Phase 5**: Operational Mapping & Fleet Telemetry Foundation (**Completed — Statically Verified: 257 passed / 0 failed; DB verification script provided for manual execution**)
- **Phase 6**: Capability-Aware Matching & Dispatch Engine (Deferred)
- **Phase 7**: Response Worker PWA & GPS Tracking (Deferred)
- **Phase 8**: Motorist Temporary SMS Location Confirmation (Deferred)
- **Phase 9**: Twilio / Vapi Automated Voice Intake & SMS Gateway (Deferred)
- **Phase 10**: Hardening, Audit Logs & Production Deployment (Deferred)
