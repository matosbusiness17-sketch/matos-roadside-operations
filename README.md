# Matos Systems — Roadside Operations & Dispatch System

A portfolio-grade operational system for roadside assistance, vehicle towing, and recovery service operators managing mobile response units.

Developed by **Matos Systems** — *Customer Journeys + Business Workflows*.

---

## 1. Project Purpose

The system connects customer intake, incident structuring, capability-aware dispatch, mobile response units, and genuine GPS tracking into a unified operational workflow:

$$\text{Customer Request} \longrightarrow \text{Automated Intake} \longrightarrow \text{Structured Incident} \longrightarrow \text{Capability Dispatch} \longrightarrow \text{Response Worker} \longrightarrow \text{Completion}$$

---

## 2. Current Implementation Phase: Phase 2 (Database, Authentication & Authorization Foundation)

This repository is currently at **Implementation Phase 2: Database, Authentication & Authorization Foundation**.

### What Has Been Implemented & Enforced:
- **Core PostgreSQL Schema**: 8 foundational tables (`organizations`, `profiles`, `worker_profiles`, `vehicles`, `worker_vehicle_assignments`, `incidents`, `assignments`, `operational_events`) with strict relational integrity.
- **Organization Multi-Tenancy**: All operational entities are partitioned by `organization_id` with composite foreign keys guarding against cross-tenant unit/worker/incident leakage.
- **Explicit Role Authorization**: Three distinct roles defined via PostgreSQL enum `app_role`: `admin`, `operator`, `worker`.
- **Row Level Security (RLS)**: Enabled across all 8 tables with zero anonymous access; field workers strictly confined to viewing their own records and assigned incidents.
- **Fail-Closed Boundary Defense (Statically Verified)**:
  - **Middleware (`src/middleware.ts`)**: A protected route may continue only after positively establishing an active profile with a recognized role. Middleware explicitly rejects:
    1. Missing or placeholder Supabase configuration => redirects to `/login`
    2. Unauthenticated requests => redirects to `/login`
    3. Profile query errors or missing/null profiles => redirects to `/login?error=profile_missing`
    4. Inactive user profiles => signs out and redirects to `/login?error=account_inactive`
    5. Undefined, null, or unknown roles => redirects to `/login?error=unauthorized_role`
    6. Unauthorized role for the surface:
       - Worker attempting operator desktop routes => redirected to `/worker`
       - Operator attempting `/admin` => redirected to `/operations`
       - Admin or operator attempting `/worker` => redirected to `/operations` (must not be treated as authorized field workers)
    Public routes (`/`, `/login`, `/customer/location/...`, static assets) remain accessible.
  - **Server-Side Defense in Depth**: Server components in `(operator)/layout.tsx`, `(operator)/admin/page.tsx`, and `worker/layout.tsx` independently verify session credentials and profile activation via `getCurrentUser()`.
  - **Admin Surface (`/admin`)**: Admin role strictly required; authenticated operators receive an explicit Access Denied boundary; unauthenticated requests fail closed.
  - **Operator Navigation**: Dynamically filters out the Admin link unless the user has verified `admin` role (no default admin role).
  - **Worker Surface (`/worker`)**: Requires genuine authenticated worker credentials; renders authentic profile and organization data without fabricated fallback identities.
- **Authentication Hygiene**: Operational email/password authentication via Supabase Auth. Quick-fill buttons populate demo emails only; passwords must always be entered manually.
- **Database Triggers**:
  - `trg_protect_profile_role`: Blocks privilege escalation and self-promotion on `profiles`.
  - `trg_immutable_operational_events`: Enforces append-only immutability for the operational audit log.

### What is Deferred to Subsequent Phases:
Operational incident intake workflows, incident queues, Mapbox mapping, capability dispatch engines, PostGIS spatial queries, worker PWA GPS broadcasting, motorist SMS verification, and telephony integrations are **strictly deferred** to Phases 3–10.

---

## 3. Core Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 19)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict typing)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Backend & Database**: [Supabase](https://supabase.com/) (PostgreSQL 15+, Supabase Auth, Row Level Security)
- **Session Management**: `@supabase/ssr` (Cookie-based session management and middleware refresh)
- **Deployment Platform**: [Vercel](https://vercel.com/)

---

## 4. High-Level Route Structure & Access Boundaries

The application separates operational concerns into distinct surfaces with server-enforced, fail-closed access boundaries:

### System & General Surfaces
- `/` — System Index & Phase 2 Architecture Directory (Public)
- `/login` — Operational Authentication Portal (Public; email/password authentication; demo buttons populate email only)

### Operator Desktop Surfaces (`(operator)` Route Group)
Desktop-first layout shell with persistent header and dynamic navigation:
- `/operations` — Operational Workspace Shell (Authenticated `admin` & `operator`; workers redirected to `/worker`)
- `/incidents` — Incident Management Shell (Authenticated `admin` & `operator`)
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
- A Supabase project (free tier or local)

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
2. Execute the migration file:
   `supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql`
3. In the Supabase Dashboard under **Authentication → Users**, create three demo accounts:
   - `admin@matos.local`
   - `operator@matos.local`
   - `worker@matos.local`
   *(Set secure development passwords for each user; note passwords for manual entry at login).*
4. In the Supabase **SQL Editor**, execute `supabase/seed.sql` to seed the demo organization, vehicles, and run `provision_demo_user` bindings.

### 4. Run Static Security Verification
Validate that all database schema, RLS policies, middleware fail-closed boundaries, and authentication hygiene rules are satisfied:
```bash
node tests/security-verification.mjs
```

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
│   └── architecture.md                    # Phase 2 Tenancy, Auth & RLS architecture
├── src/
│   ├── app/                               # Next.js App Router routes & layouts
│   │   ├── (operator)/                    # Operator desktop shell route group
│   │   │   ├── layout.tsx                 # Server fail-closed operator layout
│   │   │   ├── operations/                # Operations workspace shell
│   │   │   ├── incidents/                 # Incident queues shell
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
│   │   └── page.tsx                       # Phase 2 Architecture index & route directory
│   ├── components/                        # Reusable UI & surface components
│   │   ├── customer/                      # Customer header components
│   │   ├── operator/                      # Operator header & fail-closed navigation tabs
│   │   ├── ui/                            # Base primitives (Button, Badge, Card, Panels)
│   │   └── worker/                        # Genuine worker header components
│   ├── lib/                               # Foundation utilities & integration
│   │   ├── auth/                          # Server-side auth context & actions
│   │   │   ├── actions.ts                 # Sign-out server action
│   │   │   └── get-user.ts                # Cached session & profile resolver
│   │   ├── supabase/                      # Supabase SSR client handlers
│   │   │   ├── client.ts                  # Browser client (@supabase/ssr)
│   │   │   └── server.ts                  # Server client (@supabase/ssr)
│   │   ├── env.ts                         # Anon & publishable key support
│   │   └── utils.ts                       # Classname merge helpers
│   ├── middleware.ts                      # Fail-closed route protection & role boundary middleware
│   └── types/                             # Shared TypeScript interfaces & DB types
│       └── index.ts
├── supabase/                              # Database migrations & seeds
│   ├── migrations/
│   │   └── 20260928190000_phase2_core_schema_and_rls.sql
│   └── seed.sql                           # Demo organization, vehicles & user provisioning
├── tests/                                 # Verification suites
│   └── security-verification.mjs          # Comprehensive static security test suite
├── .env.example                           # Environment variable specification
├── .gitignore                             # Excludes local secrets & build artifacts
├── package.json
└── tsconfig.json
```

---

## 7. Phased Roadmap

- **Phase 1**: Application Foundation & Route Shells (**Completed**)
- **Phase 2**: Database, Tenancy, Authentication & Authorization Foundation (**Completed - Statically Verified**)
- **Phase 3**: Core PostgreSQL Schema & PostGIS Spatial Extensions (Deferred)
- **Phase 4**: Incident Management & Operational State Machine (Deferred)
- **Phase 5**: Mapbox Operational Mapping & Live Fleet Telemetry (Deferred)
- **Phase 6**: Capability-Aware Matching & Dispatch Engine (Deferred)
- **Phase 7**: Response Worker PWA & GPS Tracking (Deferred)
- **Phase 8**: Motorist Temporary SMS Location Confirmation (Deferred)
- **Phase 9**: Twilio / Vapi Automated Voice Intake & SMS Gateway (Deferred)
- **Phase 10**: Hardening, Audit Logs & Production Deployment (Deferred)
