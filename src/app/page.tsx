import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { env } from '@/lib/env';

export default function Home() {
  const operatorRoutes = [
    {
      name: 'Operations Workspace',
      path: '/operations',
      desc: 'Three-region operational workspace (Queue, Map, Dispatch Panel).',
      badge: 'Core Workspace',
    },
    {
      name: 'Incident Management',
      path: '/incidents',
      desc: 'Incident queues, intake records, triage status, and SLA tracking.',
      badge: 'Operator',
    },
    {
      name: 'Fleet & Response Units',
      path: '/fleet',
      desc: 'Vehicle registry, equipment capability profiles, and unit status.',
      badge: 'Operator',
    },
    {
      name: 'Operational History & Audit',
      path: '/history',
      desc: 'Immutable audit log of dispatches, transitions, and operator actions.',
      badge: 'Operator / Audit',
    },
    {
      name: 'System Administration',
      path: '/admin',
      desc: 'Organization profile, role access, intake webhooks, and settings.',
      badge: 'Admin Only',
    },
  ];

  const fieldRoutes = [
    {
      name: 'Mobile Response Worker',
      path: '/worker',
      desc: 'Mobile-first field worker shell isolated from operator navigation.',
      badge: 'Field / Mobile',
    },
    {
      name: 'Customer Location Link',
      path: '/customer/location/demo-session-token-4812',
      desc: 'Temporary interaction shell for motorist breakdown GPS verification.',
      badge: 'Customer Link',
    },
    {
      name: 'Authentication Portal',
      path: '/login',
      desc: 'Structural login shell (Auth flows deferred to Phase 2).',
      badge: 'Auth Shell',
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
                PHASE 1 FOUNDATION
              </Badge>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Roadside Operations & Dispatch System
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/operations"
              className="inline-flex items-center justify-center rounded-md bg-white text-slate-900 px-3 py-1.5 text-xs font-semibold hover:bg-slate-100 transition-colors"
            >
              Enter Operator Shell →
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
              Application Architecture & Surface Directory
            </h1>
            <p className="text-xs text-slate-600 mt-1 max-w-3xl">
              This repository contains the foundational structure for the Matos Systems Roadside Operations platform. In accordance with Implementation Phase 1 constraints, all application surfaces, routing boundaries, Supabase clients, and UI foundations are initialized without premature backend business logic or fake data.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="rounded border border-slate-200 bg-white p-3 space-y-1">
              <span className="text-slate-500 font-medium">Implementation Status</span>
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                Phase 1 Complete (Foundation Ready)
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3 space-y-1">
              <span className="text-slate-500 font-medium">Supabase Foundation</span>
              <div className="font-semibold text-slate-900">
                {env.supabase.isConfigured ? (
                  <span className="text-emerald-700">Connected & Configured</span>
                ) : (
                  <span className="text-slate-700">SSR Client & Server Handlers Ready (Awaiting Credentials)</span>
                )}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3 space-y-1">
              <span className="text-slate-500 font-medium">Active Surfaces</span>
              <div className="font-semibold text-slate-900">
                Operator Desktop, Worker Mobile, Customer Link
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

        {/* Phase 1 Scope & Boundary Documentation */}
        <section>
          <Card className="border-slate-200 bg-white">
            <CardHeader className="p-5">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Implementation Phase 1 Architectural Summary
              </CardTitle>
              <CardDescription className="text-xs">
                Disciplined foundation prepared for approved incremental rollout.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-3 text-xs text-slate-600 leading-normal">
              <p>
                In strict compliance with the Phase 1 specification, this application establishes the structural foundation without premature implementations:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div className="rounded border border-emerald-200 bg-emerald-50/50 p-3">
                  <span className="font-semibold text-emerald-900 block mb-1">
                    ✓ Implemented in Phase 1
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-emerald-800 text-[11px]">
                    <li>Next.js App Router + TypeScript + Tailwind CSS</li>
                    <li>Restrained reusable UI components (Button, Badge, Card, Panels)</li>
                    <li>Operator desktop layout shell with persistent navigation</li>
                    <li>Dedicated mobile-first worker layout shell</li>
                    <li>Isolated customer location-confirmation route shell</li>
                    <li>Supabase browser/client and server SSR module foundation</li>
                    <li>Framework error boundaries, not-found, and loading states</li>
                    <li>Safe environment variable validation without runtime crashes</li>
                  </ul>
                </div>

                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <span className="font-semibold text-slate-900 block mb-1">
                    ⊗ Strictly Deferred to Subsequent Phases
                  </span>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-600 text-[11px]">
                    <li>Database schema migrations, tables, and RLS policies (Phase 2 & 4)</li>
                    <li>Supabase Auth login flows and session tokens (Phase 2)</li>
                    <li>Incident queue and state machine logic (Phase 4)</li>
                    <li>Mapbox operational map and GPS tracking (Phase 5)</li>
                    <li>Dispatch matching engine and PostGIS queries (Phase 6)</li>
                    <li>Worker PWA and offline synchronization (Phase 7)</li>
                    <li>Customer GPS coordinate capture and token verification (Phase 8)</li>
                    <li>Twilio / Vapi telephony and SMS webhooks (Phase 9)</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 px-6 text-center text-xs text-slate-500">
        Matos Systems — Roadside Assistance Operations & Dispatch System • Phase 1 Application Foundation
      </footer>
    </div>
  );
}
