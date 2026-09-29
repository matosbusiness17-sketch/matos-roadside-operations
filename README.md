# Matos Systems — Roadside Operations & Dispatch System

A portfolio-grade operational system for roadside assistance, vehicle towing, and recovery service operators managing mobile response units.

Developed by **Matos Systems** — *Customer Journeys + Business Workflows*.

---

## 1. Project Purpose

The system is designed to connect customer intake, incident structuring, capability-aware dispatch, mobile response units, and genuine GPS tracking into a unified operational workflow:

$$\text{Customer Request} \longrightarrow \text{Automated Intake} \longrightarrow \text{Structured Incident} \longrightarrow \text{Capability Dispatch} \longrightarrow \text{Response Worker} \longrightarrow \text{Completion}$$

---

## 2. Current Implementation Phase: Phase 4 (Incident Management & Operational State Machine)

This repository is currently at **Implementation Phase 4: Incident Management & Operational State Machine**.

### What Has Been Implemented & Enforced:
- **Phase 2 Foundation (Locked & Preserved)**:
  - Multi-tenant organization scoping (`organizations`)
  - Explicit role authorization (`admin`, `operator`, `worker`) via PostgreSQL enum `app_role`
  - Fail-closed route gating in middleware (`src/middleware.ts`) and server components
  - Row Level Security (RLS) across all core tables with zero anonymous access
- **Phase 3 Spatial & Capability Foundation (Database-Only Primitives — Statically Verified)**:
  - **PostGIS Spatial Extension**: Safe and idempotent enablement; `geography(Point, 4326)` used as the authoritative spatial representation for incident and vehicle coordinates (distances calculated natively in metres).
  - **GiST Spatial Indexing**: Spatial indexes on `incidents(location)` and `vehicles(last_known_location)` for efficient spatial lookups and radius searches (`ST_DWithin`).
  - **Normalized Roadside Capabilities**:
    - `service_capabilities`: Extensible catalogue of roadside capabilities (towing, flatbed recovery, jump start, tire assistance, lockout, fuel delivery, etc.) with unique, formatted codes.
    - `vehicle_capabilities`: Tenant-isolated junction table using **composite foreign keys** (`(vehicle_id, organization_id) REFERENCES vehicles(id, organization_id)`) to strictly prevent cross-tenant capability binding.
    - **Role-Aware vehicle_capabilities RLS**: Full visibility for admins and operators; workers strictly restricted to vehicles where an active `worker_vehicle_assignments` record exists.
    - **Explicit UPDATE Policy WITH CHECK**: Enforces both `USING` and `WITH CHECK` clauses ensuring row modifications cannot compromise organization isolation or role boundaries.
  - **Incident Roadside & Spatial Structure**:
    - PostGIS geography point, application-level location source conventions (`operator_manual`, `customer_link`, `telephony_intake`, `device_gps`), and accuracy metrics. The database column `incidents.location_source` remains `TEXT` without database-level enum or domain constraints.
    - Customer vehicle fields: registration, make, model, year, and color.
    - Authoritative relational foreign key `required_capability_id` referencing `service_capabilities(id)`.
  - **Vehicle Operational Location**:
    - Last known operational position `last_known_location geography(Point, 4326)` and timestamp `location_updated_at`.
  - **Secure Spatial Database Functions (SECURITY DEFINER)**:
    - `calculate_incident_vehicle_distance(incident_id, vehicle_id)`: returns geodesic distance in metres, strictly organization-bounded; field workers strictly restricted to assigned incidents and authorized vehicle.
    - `get_nearby_vehicles(lat, lon, radius_meters, required_capability_id, limit)`: retrieves response units within radius ordered by distance in metres; strictly validates finite coordinates and bounds search radius (strictly positive, max 200,000 metres / 200 km); strictly restricted to `admin` and `operator` roles; field workers strictly denied access to prevent fleet-wide visibility leakage.
    - `get_nearby_vehicles_for_incident(incident_id, radius_meters, limit)`: directly validates search radius before execution and retrieves nearby units for an incident's location with capability filtering.
    - Function execution revoked from `PUBLIC` and granted exclusively to `authenticated`.
  - **Strict Tenant Isolation**: All spatial queries derive organization identity strictly from the authenticated database session (`get_current_user_organization_id()`); client-supplied organization IDs are never accepted for authorization.
  - **Data Retrieval Only**: Spatial functions provide pure geometric query capability; they do NOT implement dispatch decisions, automated unit selection, worker assignment, or scoring algorithms.
- **Phase 4 Incident Management & Operational State Machine (Statically Verified)**:
  - **Authoritative 10-State Incident Lifecycle**: `new`, `triaged`, `ready_for_dispatch`, `dispatched`, `en_route`, `on_scene`, `in_progress`, `completed`, `cancelled`, `unable_to_complete`.
  - **Safe Migration Sequencing**: Migration drops the legacy `incidents_status_check` constraint first, migrates existing `'created'` rows to `'new'`, sets the column default to `'new'`, and finally adds the 10-state CHECK constraint to ensure zero constraint violations.
  - **Concurrency-Safe Incident Reference Number Generator**: `generate_incident_reference_number(p_org_id UUID)` uses transaction-scoped advisory locking (`pg_advisory_xact_lock`) scoped by organization and calendar year to serialize concurrent allocations and prevent duplicate reference generation within that scope. Strictly internal helper; revoked from `PUBLIC`, `authenticated`, and `anon`.
  - **Closed Direct Mutation RLS Paths**: Generic direct `INSERT` and `UPDATE` policies on `public.incidents` are dropped, and direct `INSERT` on `public.operational_events` is dropped. All operational mutations are strictly mediated through `SECURITY DEFINER` stored procedures.
  - **State Machine Guard Trigger**: `trg_protect_incident_status` prevents bypassing the state machine via direct UPDATEs.
  - **Privileged Intake RPC (`create_incident`)**: Exact 16-parameter identity, `RETURNS JSONB`. Validates locked Phase 2 TEXT service types (`towing`, `jump_start`, `lockout`, `tire_change`, `fuel_delivery`, `winch_recovery`, `general_assistance`) and priorities (`low`, `standard`, `high`, `critical`) without enum casts, validates coordinates and accuracy, enforces `operator_manual` provenance, atomically logs `INCIDENT_CREATED` event, and returns JSONB payload (`success`, `incident_id`, `reference_number`, `status`, `event_id`, `created_at`).
  - **Authoritative Transition RPC (`transition_incident_status`)**: Enforces locked transition matrix with `FOR UPDATE` concurrency row locking, sets transaction-scoped GUC flag `matos.authorized_status_transition`, and atomically logs `INCIDENT_STATUS_CHANGED` operational events.
  - **Real Database Queue & Intake UI**: Database-backed operational incident queue with status filters, intake form with required validation, and detail inspection view with operational event audit timeline.

### What is Deferred to Subsequent Phases:
- **Phase 5**: Mapbox live operational map, visual fleet telemetry
- **Phase 6**: Automated matching, dispatch scoring, dispatch decision engine
- **Phase 7**: Worker PWA, live GPS broadcasting, realtime telemetry
- **Phase 8**: Customer GPS / location capture workflow
- **Phase 9**: Twilio / Vapi automated intake
- **Phase 10**: Final hardening and production deployment

---

## 3. Core Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 19)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict typing)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Backend & Database**: [Supabase](https://supabase.com/) (PostgreSQL 15+, PostGIS 3+, Supabase Auth, Row Level Security)
- **Spatial Engine**: PostGIS `geography(Point, 4326)`
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
- `/operations` — Operational Workspace Shell (Authenticated `admin` & `operator`; workers redirected to `/worker`)
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

Configure your Supabase credentials in `.env.local`:
```ini
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co

# Public client key: Either NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 3. Database Schema Migration & Seeding
1. Open the **SQL Editor** in your Supabase project dashboard.
2. Execute the migrations in order:
   - `supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql`
   - `supabase/migrations/20260929120000_phase3_spatial_and_capabilities.sql`
   - `supabase/migrations/20260929140000_phase4_incident_state_machine.sql`
3. In the Supabase Dashboard under **Authentication → Users**, create three demo accounts:
   - `admin@matos.local`
   - `operator@matos.local`
   - `worker@matos.local`
   *(Set secure development passwords for each user; note passwords for manual entry at login).*
4. In the Supabase **SQL Editor**, execute `supabase/seed.sql` to seed the demo organization, vehicles with synthetic coordinates, standard service capabilities, vehicle capability bindings, synthetic demo incident (`location_source = 'device_gps'`), and run `provision_demo_user` bindings.

### 4. Run Verification Suites
Validate that all database schema, spatial types, RLS policies, middleware fail-closed boundaries, authentication hygiene rules, and state machine transitions are satisfied:

```bash
# Phase 2 Security & Authentication verification (89 checks)
node tests/security-verification.mjs

# Phase 3 Spatial Schema, Capabilities & Security verification (95 checks)
node tests/phase3-spatial-verification.mjs

# Phase 4 Incident Management & State Machine verification (170 checks)
node tests/phase4-incident-verification.mjs
```

> **Note on Database Structural Verification Scripts**:
> `supabase/verify_phase3.sql` and `supabase/verify_phase4.sql` are provided for manual execution in the Supabase SQL Editor for catalog-level expression and index checks. They do not replace authenticated runtime cross-tenant integration testing.

### 5. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Build for Production
To validate TypeScript types, linting, and compile the production bundle:
```bash
npm run build
```

---

## 6. Project Directory Layout

```
matos-roadside-operations/
├── docs/                                  # Architectural documentation
│   └── architecture.md                    # Tenancy, Auth, Spatial & Operational State Machine Architecture
├── src/
│   ├── app/                               # Next.js App Router routes & layouts
│   │   ├── (operator)/                    # Operator desktop shell route group
│   │   │   ├── layout.tsx                 # Server fail-closed operator layout
│   │   │   ├── operations/                # Operations workspace shell
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
│   │   ├── auth/                          # Auth route handlers
│   │   │   ├── callback/route.ts          # OAuth/PKCE exchange handler
│   │   │   └── signout/route.ts           # Server-side sign-out handler
│   │   ├── error.tsx                      # Application error boundary
│   │   ├── globals.css                    # Tailwind CSS imports & theme
│   │   ├── layout.tsx                     # Root HTML layout
│   │   ├── loading.tsx                    # Framework loading state
│   │   ├── not-found.tsx                  # 404 page handler
│   │   └── page.tsx                       # Phase 4 Architecture index & route directory
│   ├── components/                        # Reusable UI & surface components
│   │   ├── customer/                      # Customer header components
│   │   ├── incidents/                     # Incident management components
│   │   │   ├── incident-intake-form.tsx   # Structured operator intake form
│   │   │   └── incident-transition-controls.tsx # State machine transition buttons
│   │   ├── operator/                      # Operator header & fail-closed navigation tabs
│   │   ├── ui/                            # Base primitives (Button, Badge, Card, Panels)
│   │   └── worker/                        # Genuine worker header components
│   ├── lib/                               # Foundation utilities & integration
│   │   ├── auth/                          # Server-side auth context & actions
│   │   │   ├── actions.ts                 # Sign-out server action
│   │   │   └── get-user.ts                # Cached session & profile resolver
│   │   ├── incidents/                     # Incident server actions
│   │   │   └── actions.ts                 # Server actions invoking privileged RPCs
│   │   ├── supabase/                      # Supabase SSR client handlers
│   │   │   ├── client.ts                  # Browser client (@supabase/ssr)
│   │   │   └── server.ts                  # Server client (@supabase/ssr)
│   │   ├── env.ts                         # Anon & publishable key support
│   │   └── utils.ts                       # Classname merge helpers
│   ├── middleware.ts                      # Fail-closed route protection & role boundary middleware
│   └── types/                             # Shared TypeScript interfaces & DB types
│       └── index.ts                       # Core entities, spatial, capability & state machine models
├── supabase/                              # Database migrations & seeds
│   ├── migrations/
│   │   ├── 20260928190000_phase2_core_schema_and_rls.sql
│   │   ├── 20260929120000_phase3_spatial_and_capabilities.sql
│   │   └── 20260929140000_phase4_incident_state_machine.sql
│   ├── seed.sql                           # Demo org, vehicles, capabilities & synthetic incident
│   ├── verify_phase3.sql                  # Phase 3 structural database verification script for SQL editor
│   └── verify_phase4.sql                  # Phase 4 structural database verification script for SQL editor
├── tests/                                 # Verification suites
│   ├── security-verification.mjs          # Phase 2 security verification (89 checks)
│   ├── phase3-spatial-verification.mjs    # Phase 3 spatial & capability verification (95 checks)
│   └── phase4-incident-verification.mjs   # Phase 4 incident state machine verification (170 checks)
├── .env.example                           # Environment variable specification
├── .gitignore                             # Excludes local secrets & build artifacts
├── package.json
└── tsconfig.json
```

---

## 7. Phased Roadmap

- **Phase 1**: Application Foundation & Route Shells (**Completed**)
- **Phase 2**: Database, Tenancy, Authentication & Authorization Foundation (**Completed — Statically Verified: 89 passed / 0 failed**)
- **Phase 3**: Core PostgreSQL Schema & PostGIS Spatial Extensions (**Completed — Statically Verified: 95 passed / 0 failed; database structural verification script provided for manual execution**)
- **Phase 4**: Incident Management & Operational State Machine (**Completed — Statically Verified: 170 passed / 0 failed; database structural verification script provided for manual execution**)
- **Phase 5**: Mapbox Operational Mapping & Live Fleet Telemetry (Deferred)
- **Phase 6**: Capability-Aware Matching & Dispatch Engine (Deferred)
- **Phase 7**: Response Worker PWA & GPS Tracking (Deferred)
- **Phase 8**: Motorist Temporary SMS Location Confirmation (Deferred)
- **Phase 9**: Twilio / Vapi Automated Voice Intake & SMS Gateway (Deferred)
- **Phase 10**: Hardening, Audit Logs & Production Deployment (Deferred)
