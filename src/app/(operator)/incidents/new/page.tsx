import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { IncidentIntakeForm } from '@/components/incidents/incident-intake-form';
import { ServiceCapability } from '@/types';

export const metadata = {
  title: 'New Incident Intake | Matos Systems Roadside',
  description: 'Operator roadside incident intake and problem triage form.',
};

export default async function NewIncidentPage() {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    redirect('/login?redirectTo=/incidents/new');
  }

  // Operator and Admin only
  if (authContext.profile.role !== 'admin' && authContext.profile.role !== 'operator') {
    redirect('/incidents');
  }

  let capabilities: ServiceCapability[] = [];

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('service_capabilities')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('Failed to load active capabilities:', error);
    } else {
      capabilities = (data as ServiceCapability[]) || [];
    }
  } catch (err) {
    console.error('Exception loading service capabilities:', err);
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Breadcrumb / Navigation */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/incidents" className="hover:text-slate-900 transition-colors">
          ← Incidents Queue
        </Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">New Incident Intake</span>
      </div>

      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Create Roadside Incident
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Capture motorist assistance details, required vehicle capabilities, and location for dispatch queue.
        </p>
      </div>

      {/* Intake Form */}
      <IncidentIntakeForm capabilities={capabilities} />
    </div>
  );
}
