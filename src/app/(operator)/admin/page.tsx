import { PlaceholderPanel } from '@/components/ui/placeholder-panel';

export const metadata = {
  title: 'Administration | Matos Systems Roadside',
  description: 'Organization administration, user roles, and system configuration.',
};

export default function AdminPage() {
  return (
    <PlaceholderPanel
      title="System & Organization Administration"
      surface="Admin Only"
      plannedCapabilities={[
        'Organization profile, operating hours, and service boundary management',
        'User management: Invite, activate, and assign roles (Admin, Dispatcher, Worker)',
        'Capability and equipment taxonomy definition',
        'Telephony and intake webhook configuration (Twilio & Vapi credentials)',
        'Mapbox API and PostGIS spatial indexing management',
        'System health, database connection, and webhook delivery diagnostics',
      ]}
      notes="Administrative controls and user role management are restricted until Supabase authentication and Row Level Security policies are established in Phase 2."
    />
  );
}
