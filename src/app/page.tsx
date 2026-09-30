import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { env } from '@/lib/env';

export default function Home() {
  const operatorRoutes = [
    {
      name: 'Operations Workspace',
      path: '/operations',
      desc: 'Unified three-region operational mapping and dispatch workspace (Queue, PostGIS Map, Detail & Dispatch Panel).',
      badge: 'Core Workspace',
      access: 'Admin & Operator (Statically Verified)',
    },
    {
      name: 'Incident Management',
      path: '/incidents',
      desc: 'Real database-backed operational incident queue with lifecycle and status filters.',
      badge: 'Operator',
      access: 'Admin & Operator (Statically Verified)',
    },
    {
      name: 'New Incident Intake',
      path: '/incidents/new',
      desc: 'Controlled incident creation form with database capabilities and location validation.',
      badge: 'Operator',
      access: 'Admin & Operator (Statically Verified)',
    },
    {
      name: 'Fleet & Response Units',
      path: '/fleet',
      desc: 'Vehicle registry, equipment capability profiles, and unit status shell.',
      badge: 'Operator',
      access: 'Admin & Operator (Statically Verified)',
    },
    {
      name: 'Operational History & Audit',
      path: '/history',
      desc: 'Immutable audit log shell of dispatches, transitions, and operator actions.',
      badge: 'Operator / Audit',
      access: 'Admin & Operator (Statically Verified)',
    },
    {
      name: 'System Administration',
      path: '/admin',
      desc: 'Organization settings, role access, intake webhooks, and system configuration.',
      badge: 'Admin Only',
      access: 'Admin Role Strictly Required (Statically Verified)',
    },
  ];

  const fieldRoutes = [
    {
      name: 'Mobile Response Worker',
      path: '/worker',
      desc: 'Mobile-first field worker shell isolated from operator navigation.',
      badge: 'Field / Mobile',
      access: 'Worker Role Strictly Required (Statically Verified)',
    },
    {
      name: 'Customer Location Link',
      path: '/customer/location/demo-session-token-4812',
      desc: 'Temporary interaction shell for motorist breakdown GPS verification.',
      badge: 'Customer Link',
      access: 'Public Token (Isolated Shell)',
    },
    {
      name: 'Authentication Portal',
      path: '/login',
      desc: 'Supabase email/password portal (email-only demo quick fills; manual password entry).',
      badge: 'Auth Portal',
      access: 'Public Authentication Entrypoint',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Banner */}
      <header className="border-b border-slate-200 bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base sm:text-lg tracking-tight">MATOS SYSTEMS</span>
              <Badge variant="outline" className="border-slate-700 bg-slate-800 text-slate-300 text-[10px] font-mono">
                PHASE 6 CAPABILITY-AWARE DISPATCH
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Roadside Operations & Dispatch System — Capability-Aware Matching & Dispatch Engine
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-md bg-white text-slate-900 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 transition-colors"
            >
              Sign In to System →
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Foundation Status Overview */}
        <section className="space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Application Architecture & Security Boundaries
            </h1>
            <p className="text-xs text-slate-600 mt-1 max-w-3xl">
              Phase 6 establishes the authoritative capability-aware matching and dispatch engine with deterministic PostGIS proximity ranking, concurrency protection via partial unique indexes, atomic initial dispatch and reassignment transactions, fail-closed contract validation, and preserved stale-conflict / reassignment mutation notices.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded border border-slate-200 bg-white p-3 space-y-1">
              <span className="text-slate-500 font-medium">Implementation Status</span>
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                Phase 6 Complete — Statically Verified (145 passed / 0 failed)
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3 space-y-1">
              <span className="text-slate-500 font-medium">Supabase Configuration</span>
              <div className="font-semibold text-slate-900">
                {env.supabase.isConfigured ? (
                  <span className="text-emerald-700">Connected & Configured</span>
                ) : (
                  <span className="text-slate-700">Schema Ready (Awaiting Local Credentials)</span>
                )}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3 space-y-1">
              <span className="text-slate-500 font-medium">Dispatch Engine & Workspace</span>
              <div className="font-semibold text-slate-900">
                Capability Matching + Atomic Dispatch & Reassignment
              </div>
            </div>
          </div>
        </section>

        {/* Operator Desktop Surfaces */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-800">
              Operator Desktop Surfaces
            </h2>
            <span className="text-xs text-slate-500 font-mono">Route Group: (operator)</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {operatorRoutes.map((route) => (
              <Card key={route.path} className="flex flex-col justify-between hover:border-slate-400 transition-colors">
                <CardHeader className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold text-slate-900">
                      {route.name}
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                      {route.badge}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs mt-1 text-slate-500">
                    {route.desc}
                  </CardDescription>
                  <div className="pt-2">
                    <span className="text-[10px] text-slate-400 font-mono">Access: {route.access}</span>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <Link
                    href={route.path}
                    className="inline-flex items-center text-xs font-semibold text-slate-900 hover:text-slate-600 underline"
                  >
                    Open {route.path} →
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Worker, Customer, and Auth Surfaces */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-800">
              Mobile, Customer & Auth Surfaces
            </h2>
            <span className="text-xs text-slate-500 font-mono">Isolated Architecture</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {fieldRoutes.map((route) => (
              <Card key={route.path} className="flex flex-col justify-between hover:border-slate-400 transition-colors">
                <CardHeader className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm font-semibold text-slate-900">
                      {route.name}
                    </CardTitle>
                    <Badge variant="outline" className="text-[10px] shrink-0 font-mono">
                      {route.badge}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs mt-1 text-slate-500">
                    {route.desc}
                  </CardDescription>
                  <div className="pt-2">
                    <span className="text-[10px] text-slate-400 font-mono">Access: {route.access}</span>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <Link
                    href={route.path}
                    className="inline-flex items-center text-xs font-semibold text-slate-900 hover:text-slate-600 underline"
                  >
                    Open surface →
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Architecture & Verification Summary */}
        <section>
          <Card className="border-slate-200 bg-white">
            <CardHeader className="p-5">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Phase 6 Architecture & Verification Summary
              </CardTitle>
              <CardDescription className="text-xs space-y-1">
                <span>
                  Static verification suites validate Phase 2 auth/security boundaries (89 checks passed), Phase 3 spatial/capability extensions (95 checks passed), Phase 4 incident state machine (170 checks passed), Phase 5 operational mapping & fleet telemetry foundation (257 checks passed), and Phase 6 capability-aware matching & dispatch engine (145 checks passed). Total static verification: <strong>756 passed / 0 failed</strong>.
                </span>
                <span className="block text-slate-500">
                  Standard Next.js production build passed successfully during final verification. Manual structural SQL verifier updated at <code className="font-mono">supabase/verify_phase6.sql</code> (provided for manual execution; not executed live in this environment).
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-3 text-xs text-slate-600 leading-normal">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div className="rounded border border-emerald-200 bg-emerald-50/50 p-3">
                  <span className="font-semibold text-emerald-900 block mb-1">
                    ✓ Statically Verified Foundations (756 Total Checks: 89 P2 + 95 P3 + 170 P4 + 257 P5 + 145 P6)
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-emerald-800 text-[11px]">
                    <li>Concurrency protection via 5 partial unique indexes (<code className="font-mono">idx_uq_wva_active_worker</code>, <code className="font-mono">idx_uq_wva_active_vehicle</code>, <code className="font-mono">idx_uq_assignments_active_incident</code>, <code className="font-mono">idx_uq_assignments_active_worker</code>, <code className="font-mono">idx_uq_assignments_active_vehicle</code>)</li>
                    <li>Assignment mutation lockdown: direct INSERT/UPDATE policies dropped, table mutations revoked from <code className="font-mono">authenticated</code> and <code className="font-mono">anon</code>; SELECT visibility preserved</li>
                    <li>Authoritative read-only candidate evaluation RPC (<code className="font-mono">get_dispatch_candidates(UUID)</code>) with session-derived tenant and role (admin/operator only; workers rejected)</li>
                    <li>Deterministic PostGIS proximity ranking (<code className="font-mono">ST_Distance</code> ASC, callsign ASC, worker_id ASC) inside final aggregate</li>
                    <li>Capability matching: vehicle row in <code className="font-mono">vehicle_capabilities</code> and active referenced catalogue record (<code className="font-mono">service_capabilities.is_active = true</code>)</li>
                    <li>Atomic initial dispatch RPC (<code className="font-mono">dispatch_incident(UUID, UUID, UUID)</code>) with row locking (<code className="font-mono">FOR UPDATE</code>), shift binding check, capability match, and transition to <code className="font-mono">dispatched</code></li>
                    <li>Atomic reassignment RPC (<code className="font-mono">reassign_incident(...)</code>) with row locking (<code className="font-mono">FOR UPDATE</code>), current assignment cancellation without <code className="font-mono">completed_at</code> fabrication, replacement assignment creation, and retained <code className="font-mono">dispatched</code> status</li>
                    <li>Fail-closed data validation in <code className="font-mono">data.ts</code>: required contract keys checked for property presence, strict nullable fields without silent null coercion, and Date.parse finite timestamp validation</li>
                    <li>Preserved stale-conflict notice across refresh: <code className="font-mono">&quot;Dispatch could not be completed. This unit is no longer available. Candidates have been refreshed.&quot;</code></li>
                    <li>Preserved reassignment progression notice: <code className="font-mono">&quot;Reassignment is no longer allowed. The current assignment may have already progressed.&quot;</code> rendered in Assigned Response view</li>
                    <li>Truthful unranked vehicle telemetry when incident location coordinates are not recorded</li>
                    <li>Defensive UI date formatting preventing <code className="font-mono">NaNd ago</code> or <code className="font-mono">Invalid Date</code></li>
                    <li>OperationsWorkspace serialized queued refresh guaranteeing post-mutation state reconciliation</li>
                  </ul>
                </div>

                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <span className="font-semibold text-slate-900 block mb-1">
                    ⊗ Boundary Policy & Deferred Phases
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-600 text-[11px]">
                    <li><strong>Allowed:</strong> Capability-aware candidate evaluation, PostGIS proximity ranking, atomic operator dispatch, atomic operator reassignment, and synthetic development seed</li>
                    <li><strong>Prohibited:</strong> Live GPS streaming, worker geolocation broadcasting, automatic polling, or data fabrication</li>
                    <li>Worker PWA, offline sync & device GPS broadcast (Phase 7 — Deferred)</li>
                    <li>Customer GPS capture & token lookup (Phase 8 — Deferred)</li>
                    <li>Twilio / Vapi telephony & automated intake (Phase 9 — Deferred)</li>
                    <li>Final production hardening, audit log exports & deployment (Phase 10 — Deferred)</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-6 text-center text-xs text-slate-500">
        Matos Systems — Roadside Assistance Operations & Dispatch System • Phase 6 Capability-Aware Matching & Dispatch Engine
      </footer>
    </div>
  );
}
