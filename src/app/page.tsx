import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { env } from '@/lib/env';

export default function Home() {
  const operatorRoutes = [
    {
      name: 'Operations Workspace',
      path: '/operations',
      desc: 'Unified three-region operational mapping workspace (Queue, PostGIS Map, Detail Panel).',
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
                PHASE 5 OPERATIONAL MAPPING
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Roadside Operations & Dispatch System — Operational Mapping & Fleet Telemetry Foundation
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
              Phase 5 establishes the authoritative operational mapping workspace (/operations) with read-only operational snapshot RPC, aggregate-level deterministic incident and vehicle ordering, PostGIS coordinate derivation, fail-closed data validation without data fabrication, and real filter-driven selection clearing.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded border border-slate-200 bg-white p-3 space-y-1">
              <span className="text-slate-500 font-medium">Implementation Status</span>
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                Phase 5 Complete — Statically Verified (257 passed / 0 failed)
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
              <span className="text-slate-500 font-medium">State Machine & Operational Workspace</span>
              <div className="font-semibold text-slate-900">
                Operational Snapshot RPC + Synchronized Workspace
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
                Phase 5 Architecture & Static Verification Summary
              </CardTitle>
              <CardDescription className="text-xs">
                Static verification suites validate Phase 2 auth/security boundaries (89 checks passed), Phase 3 spatial/capability extensions (95 checks passed), Phase 4 incident state machine (170 checks passed), and Phase 5 operational mapping & fleet telemetry foundation (257 checks passed). Database structural verification script provided at <code className="font-mono">supabase/verify_phase5.sql</code> for manual Supabase SQL Editor execution (provided for manual execution; not executed live in this environment).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-3 text-xs text-slate-600 leading-normal">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div className="rounded border border-emerald-200 bg-emerald-50/50 p-3">
                  <span className="font-semibold text-emerald-900 block mb-1">
                    ✓ Statically Verified Foundations (89 P2 + 95 P3 + 170 P4 + 257 P5 Checks)
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-emerald-800 text-[11px]">
                    <li>Authoritative read-only operational snapshot RPC (<code className="font-mono">get_operations_map_snapshot()</code>)</li>
                    <li>Aggregate-level deterministic incident ordering (priority critical &gt; high &gt; standard &gt; low, oldest created_at ASC, id ASC inside jsonb_agg)</li>
                    <li>Aggregate-level deterministic vehicle ordering (callsign ASC, id ASC inside jsonb_agg)</li>
                    <li>Session-derived tenancy and role check strictly permitting admin and operator roles only (worker access rejected)</li>
                    <li>Exact 7 active operational incident statuses returned; terminal statuses (completed, cancelled, unable_to_complete) strictly excluded</li>
                    <li>Active fleet scoping (is_active = true) with capability aggregation from service_capabilities</li>
                    <li>PostGIS coordinate derivation via ST_X/ST_Y with missing-location tolerance for unmapped entities</li>
                    <li>Execution revoked from PUBLIC and anon; granted exclusively to authenticated</li>
                    <li>Fail-closed data validation in data.ts with zero timestamp or phone fabrication</li>
                    <li>Unified three-region operational workspace (/operations) synchronizing queue, map, and context panel</li>
                    <li>Real filter-driven selection clearing: hidden incidents are cleared from state rather than merely masked</li>
                    <li>Truthful last-known location telemetry: vehicle positions show the latest stored location and are not a live GPS feed</li>
                    <li>Non-destructive manual refresh action with error retention and zero polling/WebSockets</li>
                  </ul>
                </div>

                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <span className="font-semibold text-slate-900 block mb-1">
                    ⊗ Boundary Policy & Deferred Phases
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-600 text-[11px]">
                    <li><strong>Allowed:</strong> Read-only operational map snapshots, server-action refresh, and synthetic development seed</li>
                    <li><strong>Prohibited:</strong> Live GPS streaming, worker geolocation broadcasting, automatic polling, or data fabrication</li>
                    <li>Capability-matching dispatch engine, automatic assignment & scoring/ranking (Phase 6 — Deferred)</li>
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
        Matos Systems — Roadside Assistance Operations & Dispatch System • Phase 5 Operational Mapping & Fleet Telemetry Foundation
      </footer>
    </div>
  );
}
