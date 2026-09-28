import { PlaceholderPanel } from '@/components/ui/placeholder-panel';

export const metadata = {
  title: 'Incidents | Matos Systems Roadside',
  description: 'Incident lifecycle, triage, and record management.',
};

export default function IncidentsPage() {
  return (
    <PlaceholderPanel
      title="Incident Management"
      surface="Operator / Dispatcher"
      plannedCapabilities={[
        'Comprehensive incident lifecycle tracking (New, Triaged, Dispatched, En Route, On Scene, Completed, Cancelled)',
        'Customer breakdown details: vehicle make/model/year, plate, breakdown nature, hazard context',
        'Structured automated intake from voice (Twilio/Vapi) and web forms',
        'SLA tracking, priority escalation, and response time metrics',
        'Full incident activity timeline with timestamped operator notes and status transitions',
        'Search, multi-dimensional filtering, and data export capabilities',
      ]}
      notes="No live incidents or fabricated test records are displayed in Phase 1. The database schema, state machine transitions, and Row Level Security policies will be established in Phase 4."
    />
  );
}
