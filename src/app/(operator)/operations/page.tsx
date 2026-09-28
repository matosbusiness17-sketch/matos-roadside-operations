import { PlaceholderPanel } from '@/components/ui/placeholder-panel';
import { Card } from '@/components/ui/card';

export const metadata = {
  title: 'Operations | Matos Systems Roadside',
  description: 'Three-region operational workspace for roadside assistance dispatch.',
};

export default function OperationsPage() {
  return (
    <PlaceholderPanel
      title="Operations Workspace"
      surface="Operator / Dispatcher"
      plannedCapabilities={[
        'Three-region unified operational workspace (Queue, Map, Dispatch Panel)',
        'Realtime incident intake and triage with SLA countdowns',
        'Mapbox-powered live vehicle tracking and geofencing',
        'Capability-aware response unit matching (towing, jump-start, lockout, tire)',
        'PostGIS spatial distance and travel time calculation',
        'Direct dispatcher manual override and reassignment',
      ]}
      notes="The three-region layout structure below outlines the operational workspace. Live Mapbox rendering, PostGIS queries, and real-time state synchronization will be introduced in subsequent authorized implementation phases."
    >
      {/* Structural layout skeleton of the 3-region operational workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[420px]">
        {/* Left Region: Incident Queue */}
        <Card className="lg:col-span-3 flex flex-col justify-between border-dashed border-slate-300 bg-white/75 p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Region 1: Incident Queue
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Phase 4</span>
            </div>
            <p className="text-xs text-slate-500">
              Active intake queue filtered by priority, SLA urgency, and dispatch state.
            </p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-500">
            Awaiting Phase 4 Incident Schema & Subscriptions
          </div>
        </Card>

        {/* Center Region: Live Operational Map */}
        <Card className="lg:col-span-6 flex flex-col justify-between border-dashed border-slate-300 bg-slate-100/75 p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Region 2: Live Operational Map
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Phase 5</span>
            </div>
            <p className="text-xs text-slate-500">
              Interactive Mapbox operational map showing live GPS telemetry, incident pins, and route geometry.
            </p>
          </div>
          <div className="rounded border border-slate-200 bg-white p-3 text-center text-xs text-slate-500">
            Awaiting Phase 5 Mapbox & PostGIS Integration
          </div>
        </Card>

        {/* Right Region: Incident & Dispatch Detail Panel */}
        <Card className="lg:col-span-3 flex flex-col justify-between border-dashed border-slate-300 bg-white/75 p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
                Region 3: Dispatch & Detail Panel
              </span>
              <span className="text-[10px] text-slate-500 font-mono">Phase 6</span>
            </div>
            <p className="text-xs text-slate-500">
              Selected incident details, customer telemetry, capability requirements, and unit dispatch action.
            </p>
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-center text-xs text-slate-500">
            Awaiting Phase 6 Dispatch Engine
          </div>
        </Card>
      </div>
    </PlaceholderPanel>
  );
}
