# Matos Systems — Roadside Operations & Dispatch System

A portfolio-grade operational system for roadside assistance, vehicle towing, and recovery service operators managing mobile response units.

Developed by **Matos Systems** — *Customer Journeys + Business Workflows*.

---

## 1. Project Purpose

The system connects customer intake, incident structuring, capability-aware dispatch, mobile response units, and genuine GPS tracking into a unified operational workflow:

$$\text{Customer Request} \longrightarrow \text{Automated Intake} \longrightarrow \text{Structured Incident} \longrightarrow \text{Capability Dispatch} \longrightarrow \text{Response Worker} \longrightarrow \text{Completion}$$

---

## 2. Current Implementation Phase: Phase 1 (Application Foundation)

This repository is currently at **Implementation Phase 1: Application Foundation**.

In accordance with the project specification:
- Structural route shells and distinct application surface boundaries have been established.
- Reusable UI primitives and operator layout shells are initialized.
- Supabase browser and server client foundations are established.
- Framework loading, error, and not-found states are implemented.
- **Explicit Notice:** Later operational functionality (database schema, authentication flows, incident queues, Mapbox mapping, dispatch algorithms, PostGIS spatial queries, worker PWA, GPS tracking, and Twilio/Vapi integrations) is **NOT YET IMPLEMENTED** in this phase.

---

## 3. Core Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router, React 19)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict typing)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Backend Foundation**: [Supabase](https://supabase.com/) (`@supabase/supabase-js`, `@supabase/ssr`)
- **Deployment Platform**: [Vercel](https://vercel.com/)

---

## 4. High-Level Route Structure

The application separates user concerns into architecturally distinct surfaces:

### System & General Surfaces
- `/` — System Index & Foundation Surface Directory
- `/login` — Account Authentication Shell (Auth flows deferred to Phase 2)

### Operator Desktop Surfaces (`(operator)` Route Group)
Desktop-first layout shell with unified header and persistent navigation:
- `/operations` — Operational Workspace Shell (Awaiting Phase 5/6 three-region workspace: Queue \| Map \| Dispatch)
- `/incidents` — Incident Management Shell (Lifecycle, triage, and records)
- `/fleet` — Fleet & Response Units Shell (Vehicle registry and capability profiles)
- `/history` — Operational History & Audit Shell (Immutable event logs and compliance)
- `/admin` — System & Organization Administration Shell (Organization settings and access)

### Mobile Worker Surface
Mobile-first layout container isolated from desktop operator navigation:
- `/worker` — Mobile Response Worker Shell (Awaiting Phase 7 PWA, assignments, and GPS)

### Customer Temporary Interaction Surface
Focused, isolated interaction container accessed via temporary dispatch links:
- `/customer/location/[token]` — Motorist Location Confirmation Shell (Awaiting Phase 8 GPS verification)

---

## 5. Local Setup & Installation

### Prerequisites
- Node.js (v20+ recommended; verified on Node v24)
- npm (v10+)

### 1. Clone & Install Dependencies
```bash
# Clone the repository
git clone https://github.com/matosbusiness17-sketch/matos-roadside-operations.git
cd matos-roadside-operations

# Install dependencies
npm install
```

### 2. Environment Configuration
Copy the provided `.env.example` file to create your local environment file:
```bash
cp .env.example .env.local
```

Configure your Supabase credentials in `.env.local`:
```ini
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

> **Note:** The Phase 1 foundation runs and builds cleanly even if Supabase credentials are placeholder values.

### 3. Run the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for Production
To validate TypeScript types, linting, and compile the production bundle:
```bash
npm run build
```

To run the production server locally:
```bash
npm run start
```

---

## 6. Project Directory Layout

```
matos-roadside-operations/
├── docs/                      # Architectural documentation
│   └── architecture.md
├── src/
│   ├── app/                   # Next.js App Router routes & layouts
│   │   ├── (operator)/        # Operator desktop shell route group
│   │   │   ├── layout.tsx     # Operator header & navigation shell
│   │   │   ├── operations/    # Operations workspace shell
│   │   │   ├── incidents/     # Incident queues shell
│   │   │   ├── fleet/         # Response units shell
│   │   │   ├── history/       # Event audit log shell
│   │   │   └── admin/         # Admin & settings shell
│   │   ├── customer/          # Customer interaction surface
│   │   │   └── location/
│   │   │       └── [token]/   # Motorist location verification shell
│   │   ├── worker/            # Mobile response worker surface
│   │   │   ├── layout.tsx     # Mobile-first worker frame
│   │   │   └── page.tsx       # Worker status shell
│   │   ├── login/             # Authentication portal shell
│   │   ├── error.tsx          # Application error boundary
│   │   ├── globals.css        # Tailwind CSS imports & theme
│   │   ├── layout.tsx         # Root HTML layout
│   │   ├── loading.tsx        # Framework loading state
│   │   ├── not-found.tsx      # 404 page handler
│   │   └── page.tsx           # Foundation index & route directory
│   ├── components/            # Reusable UI & surface components
│   │   ├── customer/          # Customer header components
│   │   ├── operator/          # Operator header & navigation tabs
│   │   ├── ui/                # Base primitives (Button, Badge, Card, Panels)
│   │   └── worker/            # Worker header components
│   ├── lib/                   # Foundation utilities & integration
│   │   ├── supabase/          # Supabase client & server SSR handlers
│   │   │   ├── client.ts      # Browser client (@supabase/ssr)
│   │   │   └── server.ts      # Server client (@supabase/ssr)
│   │   ├── env.ts             # Safe environment variable configuration
│   │   └── utils.ts           # Classname merge helpers
│   └── types/                 # Shared TypeScript interfaces
│       └── index.ts
├── .env.example               # Environment variable specification
├── .gitignore                 # Excludes local secrets & build artifacts
├── package.json
└── tsconfig.json
```

---

## 7. Upcoming Phases (Approved Roadmap)

- **Phase 2**: Organization-aware Supabase Authentication, User Roles, and RLS Setup
- **Phase 3**: Core PostgreSQL Schema & PostGIS Spatial Extensions
- **Phase 4**: Incident Management & Operational State Machine
- **Phase 5**: Mapbox Operational Mapping & Live Fleet Telemetry
- **Phase 6**: Capability-Aware Matching & Dispatch Engine
- **Phase 7**: Response Worker PWA & GPS Tracking
- **Phase 8**: Motorist Temporary SMS Location Confirmation
- **Phase 9**: Twilio / Vapi Automated Voice Intake & SMS Gateway
- **Phase 10**: Hardening, Audit Logs & Production Deployment
