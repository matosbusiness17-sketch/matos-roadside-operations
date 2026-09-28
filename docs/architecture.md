# Matos Systems — Roadside Operations & Dispatch System
## Architecture Overview (Implementation Phase 1)

### 1. Architectural Philosophy

The Matos Systems Roadside Operations & Dispatch System is engineered as a mission-critical operational system for roadside assistance, towing, and recovery service providers. The primary architectural objective of **Phase 1** is to establish a robust, disciplined application foundation that isolates concerns across distinct user surfaces and sets up clean integration patterns without premature implementation of business logic.

---

### 2. Core Technology Stack

- **Framework**: Next.js (App Router, Server & Client Components)
- **Language**: TypeScript (Strict typing enabled)
- **Styling**: Tailwind CSS (Tailwind v4 with PostCSS plugin)
- **Backend & Data (Platform Target)**: Supabase (PostgreSQL, Row Level Security, Realtime, PostGIS)
- **Mapping (Future Target)**: Mapbox GL JS / PostGIS
- **Deployment**: Vercel

---

### 3. Application Surfaces & Boundaries

The application is structured into four architecturally distinct surfaces:

1. **Operator Desktop Shell (`(operator)`)**:
   - Routes: `/operations`, `/incidents`, `/fleet`, `/history`, `/admin`
   - Purpose: Designed desktop-first for dispatchers and operational managers. Features high legibility, restrained density, and a unified header and navigation tab system.
   - Future Workspace: The `/operations` route serves as the shell for the three-region operational workspace:
     - Left: Incident Queue
     - Center: Live Operational Map
     - Right: Incident & Dispatch Detail Panel

2. **Mobile Worker Surface (`/worker`)**:
   - Routes: `/worker`
   - Purpose: Mobile-first interface for field response workers. Sits in an isolated layout container (`max-w-md`) and is intentionally decoupled from desktop operator navigation.

3. **Customer Interaction Surface (`/customer/location/[token]`)**:
   - Routes: `/customer/location/[token]`
   - Purpose: Minimal, trusted surface accessed via temporary single-use SMS links for motorists to verify breakdown coordinates. Exposes zero operational controls and operates in strict isolation.

4. **Authentication Portal (`/login`)**:
   - Routes: `/login`
   - Purpose: Structural sign-in interface ready for Supabase Auth integration in Phase 2.

---

### 4. Supabase Integration Foundation

The backend foundation is decoupled into browser and server entry points in `@/lib/supabase`:
- `src/lib/supabase/client.ts`: Uses `@supabase/ssr` `createBrowserClient` for interactive client components.
- `src/lib/supabase/server.ts`: Uses `@supabase/ssr` `createServerClient` reading cookies from `next/headers` for Server Components and Server Actions.
- `src/lib/env.ts`: Centralizes environment access and prevents hard crashes when credentials are empty during development or initial builds.

---

### 5. Phased Roadmap Boundaries

| Phase | Focus Area | Status |
| :--- | :--- | :--- |
| **Phase 1** | **Application Foundation & Route Shells** | **Active / Complete** |
| Phase 2 | Supabase Auth, Profiles, Organizations & Roles | Deferred |
| Phase 3 | Core Data Schema, PostGIS & RLS Policies | Deferred |
| Phase 4 | Incident Intake & State Machine | Deferred |
| Phase 5 | Mapbox Live Operational Mapping & Geocoding | Deferred |
| Phase 6 | Dispatch Matching Engine & Unit Assignment | Deferred |
| Phase 7 | Field Worker PWA & Realtime Telemetry | Deferred |
| Phase 8 | Customer Location Verification & GPS Flow | Deferred |
| Phase 9 | Twilio / Vapi Telephony & Automated Intake | Deferred |
| Phase 10 | Production Hardening, Audit & E2E Validation | Deferred |
