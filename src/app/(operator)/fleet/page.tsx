import { PlaceholderPanel } from '@/components/ui/placeholder-panel';

export const metadata = {
  title: 'Fleet & Response Units | Matos Systems Roadside',
  description: 'Mobile response units, vehicle equipment, and driver capability management.',
};

export default function FleetPage() {
  return (
    <PlaceholderPanel
      title="Fleet & Response Units"
      surface="Operator / Dispatcher"
      plannedCapabilities={[
        'Mobile response unit registry (Flatbed Tow, Wheel-Lift, Light Service, Heavy Recovery)',
        'Capability and equipment matrices (battery booster, lockout kit, tire changing, winch)',
        'Worker-to-unit assignments and active shift statuses (On Duty, Off Duty, Dispatched, Unavailable)',
        'Realtime GPS telemetry feed, speed, heading, and battery health reporting',
        'Service area zones and base depot configuration',
        'Unit maintenance records and operational readiness indicators',
      ]}
      notes="No simulated vehicles or fabricated location feeds are displayed in Phase 1. Vehicle registries and worker assignment models will be integrated in Phase 4."
    />
  );
}
