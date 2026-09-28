# Matos Systems — Roadside Operations & Dispatch System

A portfolio-grade operational system for roadside assistance, vehicle towing, and recovery service operators managing mobile response units.

Developed by **Matos Systems** — *Customer Journeys + Business Workflows*.

---

## 1. Project Purpose

The system connects customer intake, incident structuring, capability-aware dispatch, mobile response units, and genuine GPS tracking into a unified operational workflow:

$$\text{Customer Request} \longrightarrow \text{Automated Intake} \longrightarrow \text{Structured Incident} \longrightarrow \text{Capability Dispatch} \longrightarrow \text{Response Worker} \longrightarrow \text{Completion}$$

---

## 2. Current Implementation Phase: Phase 2 (Database, Tenancy, Auth & RLS)

This repository is currently at **Implementation Phase 2: Database, Authentication & Authorization Foundation**.

Delivered in this phase:
- **Reproducible PostgreSQL Database Migrations**: 8 core tables with multi-tenant organization scoping, explicit `app_role` (`admin`, `operator`, `worker`), and composite relational integrity.
- **Row Level Security (RLS)**: Enforced across all tables. Zero access for anonymous users; strict isolation between organizations; restricted visibility for workers (confined strictly to their assigned incidents).
- **Privilege Escalation Prevention**: Database trigger prevents ordinary users from altering their role or transferring organizations.
- **Working Authentication & Session Management**: Supabase Email/Password authentication with `@supabase/ssr` cookies and Next.js middleware route protection.
- **Role-Aware Surface Routing**: Protected operator workspace for Admins and Operators; mobile worker shell for Workers; access-denied handling for unauthorized routes.
- **Development Seed & User Provisioning**: Automated seed script for demo organization, response units, and user identity binding.
- **Explicit Notice:** Later operational functionality (Mapbox operational maps, PostGIS nearest-worker queries, live GPS tracking, realtime WebSocket feeds, dispatch matching algorithms, and Twilio/Vapi integrations) is **NOT YET IMPLEMENTED** in this phase.

---

## 3. Core Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 19)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict typing)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Database & Auth**: [Supabase](https://supabase.com/) (`@supabase/supabase-js`, `@supabase/ssr`, PostgreSQL 15+, RLS)
- **Deployment Platform**: [Vercel](https://vercel.com/)

---

## 4. Database Schema & Entities

Migrations are located in `supabase/migrations/`:
- `public.organizations`: Tenancy root representing the roadside assistance company.
- `public.profiles`: Application profiles referencing `auth.users` with `role` (`admin | operator | worker`).
- `public.worker_profiles`: Field worker extension with `availability_status`.
- `public.vehicles`: Response units/vehicles with callsign and registration number.
- `public.worker_vehicle_assignments`: Composite-guarded junction tracking worker-to-vehicle shifts.
- `public.incidents`: Structural incident entity with status lifecycle, contact, and priority.
- `public.assignments`: Composite-guarded dispatch binding connecting incident, worker, and vehicle.
- `public.operational_events`: Immutable append-only audit trail with modification-blocking trigger.

---

## 5. Local Setup & Execution

### Prerequisites
- Node.js (v20+ recommended; verified on Node v24)
- npm (v10+)
- Active Supabase Project (PostgreSQL + Auth enabled)

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/matosbusiness17-sketch/matos-roadside-operations.git
cd matos-roadside-operations
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Set your Supabase project credentials in `.env.local`:
```ini
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 3. Database Migration Execution
Apply the migration to your Supabase project using the Supabase CLI or SQL Editor:
```bash
# If using Supabase CLI linked to your project:
npx supabase db push

# Alternatively: Copy and execute the contents of:
# supabase/migrations/20260928190000_phase2_core_schema_and_rls.sql
# inside the Supabase Dashboard SQL Editor.
```

### 4. Development Accounts & Seed Data
Execute `supabase/seed.sql` in the Supabase SQL Editor:
1. Provisions the demo organization (`Matos Roadside Assistance (Demo Org)`) and response fleet.
2. In Supabase Dashboard $\rightarrow$ **Authentication** $\rightarrow$ **Users**, create 3 test users:
   - `admin@matos.local`
   - `operator@matos.local`
   - `worker@matos.local`
3. In Supabase **SQL Editor**, execute the provisioning helper:
   ```sql
   SELECT public.provision_demo_user('admin@matos.local', 'admin', 'Alex Admin');
   SELECT public.provision_demo_user('operator@matos.local', 'operator', 'Morgan Operator');
   SELECT public.provision_demo_user('worker@matos.local', 'worker', 'Taylor Worker');
   ```

### 5. Run Local Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Build & Validate
```bash
npm run lint          # Run ESLint validation
npm run build         # Validate TypeScript and compile production bundle
node tests/security-verification.mjs # Run static RLS & architecture verification
```

---

## 6. High-Level Route Structure

### System & General Surfaces
- `/` — System Index, Architecture & Security Summary
- `/login` — Account Authentication (Interactive sign-in with quick-fills for demo identities)

### Operator Desktop Surfaces (`(operator)` Route Group)
Desktop-first shell requiring `admin` or `operator` role:
- `/operations` — Operational Workspace Shell
- `/incidents` — Incident Management Shell
- `/fleet` — Fleet & Response Units Shell
- `/history` — Operational History & Audit Shell
- `/admin` — Organization Administration Shell (**Admin role strictly required**)

### Mobile Worker Surface
Mobile-first layout shell requiring `worker` role:
- `/worker` — Mobile Response Worker Portal (Isolated from operator desktop)

### Customer Temporary Interaction Surface
- `/customer/location/[token]` — Motorist Location Confirmation Shell (Temporary interaction link, no operator navigation)

---

## 7. Upcoming Phases (Approved Roadmap)

- **Phase 3**: Core PostgreSQL Schema & PostGIS Spatial Extensions
- **Phase 4**: Incident Management & Operational State Machine
- **Phase 5**: Mapbox Operational Mapping & Live Fleet Telemetry
- **Phase 6**: Capability-Aware Matching & Dispatch Engine
- **Phase 7**: Response Worker PWA & GPS Tracking
- **Phase 8**: Motorist Temporary SMS Location Confirmation
- **Phase 9**: Twilio / Vapi Automated Voice Intake & SMS Gateway
- **Phase 10**: Hardening, Audit Logs & Production Deployment
