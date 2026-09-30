'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { transitionWorkerAssignment } from '@/lib/worker/actions';
import type { WorkerActiveAssignment, WorkerLifecycleAction } from '@/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WorkerLocationControl } from '@/components/worker/worker-location-control';

export interface LifecycleActionConfig {
  action: WorkerLifecycleAction;
  buttonLabel: string;
  loadingLabel: string;
  successMessage: string;
}

/**
 * Maps the exact combination of assignment status + incident status to the single valid lifecycle action.
 * Returns null if any unrecognized or illegal combination reaches the UI (defense in depth).
 */
export function getLifecycleActionConfig(
  assignmentStatus: WorkerActiveAssignment['status'],
  incidentStatus: WorkerActiveAssignment['incident_status']
): LifecycleActionConfig | null {
  const pair = `${assignmentStatus}|${incidentStatus}`;
  switch (pair) {
    case 'assigned|dispatched':
      return {
        action: 'ACCEPT_ASSIGNMENT',
        buttonLabel: 'Accept assignment',
        loadingLabel: 'Processing…',
        successMessage: 'Assignment accepted.',
      };
    case 'accepted|dispatched':
      return {
        action: 'START_JOURNEY',
        buttonLabel: 'Start journey',
        loadingLabel: 'Processing…',
        successMessage: 'Journey started.',
      };
    case 'en_route|en_route':
      return {
        action: 'ARRIVE_ON_SCENE',
        buttonLabel: 'Arrived on scene',
        loadingLabel: 'Processing…',
        successMessage: 'Arrival confirmed.',
      };
    case 'on_scene|on_scene':
      return {
        action: 'START_WORK',
        buttonLabel: 'Start work',
        loadingLabel: 'Processing…',
        successMessage: 'Work started.',
      };
    case 'on_scene|in_progress':
      return {
        action: 'COMPLETE_JOB',
        buttonLabel: 'Complete job',
        loadingLabel: 'Processing…',
        successMessage: 'Job completed.',
      };
    default:
      return null;
  }
}

/**
 * Deterministically formats assigned_at in UTC to avoid hydration mismatches.
 */
function formatDeterministicUtc(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString;
    }
    return (
      new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(date) + ' UTC'
    );
  } catch {
    return isoString;
  }
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatPriorityBadge(priority: WorkerActiveAssignment['priority']) {
  switch (priority) {
    case 'critical':
      return <Badge variant="destructive">Critical</Badge>;
    case 'high':
      return <Badge variant="warning">High</Badge>;
    case 'standard':
      return <Badge variant="outline">Standard</Badge>;
    case 'low':
      return <Badge variant="default">Low</Badge>;
    default:
      return <Badge variant="default">{priority}</Badge>;
  }
}

export interface WorkerAssignmentPanelProps {
  assignment: WorkerActiveAssignment | null;
}

export function WorkerAssignmentPanel({ assignment }: WorkerAssignmentPanelProps) {
  const router = useRouter();
  const [isActionPending, setIsActionPending] = useState(false);
  const [isRefreshPending, startRefreshTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isBusy = isActionPending || isRefreshPending;

  const config = assignment
    ? getLifecycleActionConfig(assignment.status, assignment.incident_status)
    : null;

  const handleLifecycleAction = async () => {
    if (isBusy || !assignment || !config) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    // Fail-closed offline protection: do NOT queue lifecycle transitions offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErrorMessage(
        'You are offline. Lifecycle changes are not queued. Reconnect and try again.'
      );
      return;
    }

    setIsActionPending(true);

    try {
      const result = await transitionWorkerAssignment(
        assignment.assignment_id,
        config.action
      );

      if (!result.success) {
        setErrorMessage(
          result.error?.message || 'Worker lifecycle transition failed.'
        );

        // Stale state error codes trigger an authoritative refresh
        if (
          result.error?.code === 'ASSIGNMENT_NOT_FOUND' ||
          result.error?.code === 'INVALID_TRANSITION' ||
          result.error?.code === 'ASSIGNMENT_CONFLICT'
        ) {
          startRefreshTransition(() => {
            router.refresh();
          });
        }
        setIsActionPending(false);
        return;
      }

      setSuccessMessage(config.successMessage);

      // Start refresh transition before releasing action pending state to prevent clickable gaps
      startRefreshTransition(() => {
        router.refresh();
      });
      setIsActionPending(false);
    } catch {
      setErrorMessage('An unexpected network error occurred while executing the lifecycle action.');
      setIsActionPending(false);
    }
  };

  const handleManualRefresh = () => {
    if (isBusy) return;
    setErrorMessage(null);

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErrorMessage('You are offline. Reconnect to refresh assignment.');
      return;
    }

    startRefreshTransition(() => {
      router.refresh();
    });
  };

  // No active assignment state: truthfully rendered without fabrication or availability claims
  if (!assignment) {
    return (
      <Card className="border-slate-200">
        <CardHeader className="p-4">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <CardTitle className="text-xs font-semibold text-slate-800 uppercase tracking-wider min-w-0">
              Active Assignment
            </CardTitle>
            <Badge variant="outline" className="text-[10px] shrink-0">
              No active assignment
            </Badge>
          </div>
          <CardDescription className="text-xs text-slate-500">
            Current dispatch assignment
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          {successMessage && (
            <div
              aria-live="polite"
              className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 font-medium break-words"
            >
              {successMessage}
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium break-words"
            >
              {errorMessage}
            </div>
          )}

          <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-6 text-center space-y-2 min-w-0">
            <p className="text-sm font-semibold text-slate-800 break-words">
              No active assignment available.
            </p>
            <p className="text-xs text-slate-500 max-w-xs mx-auto break-words">
              If you are expecting a job, refresh or contact dispatch.
            </p>
            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleManualRefresh}
                disabled={isBusy}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-[36px]"
              >
                {isRefreshPending ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-full min-w-0">
      {/* Primary Job Card */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="p-4 pb-3">
          <div className="flex items-start justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 block">
                Job Reference
              </span>
              <h2 className="text-base font-bold text-slate-900 tracking-tight break-words whitespace-normal min-w-0">
                {assignment.reference_number}
              </h2>
            </div>
            <div className="shrink-0 flex items-center gap-1.5 flex-wrap justify-end">
              {formatPriorityBadge(assignment.priority)}
              <Badge variant="primary" className="text-[10px] shrink-0">
                {formatStatus(assignment.service_type)}
              </Badge>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 pt-0 space-y-4">
          {/* Status indicators */}
          <div className="rounded border border-slate-200 bg-slate-50/70 p-3 text-xs space-y-2 min-w-0">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="text-slate-600 font-medium shrink-0">Assignment Status:</span>
              <Badge variant="outline" className="font-semibold text-slate-800 break-words whitespace-normal text-right">
                {formatStatus(assignment.status)}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2 min-w-0">
              <span className="text-slate-600 font-medium shrink-0">Incident Status:</span>
              <Badge variant="outline" className="font-semibold text-slate-800 break-words whitespace-normal text-right">
                {formatStatus(assignment.incident_status)}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-200/60 text-[11px] min-w-0">
              <span className="text-slate-500 shrink-0">Assigned At:</span>
              <span className="text-slate-700 font-mono font-medium text-right break-words min-w-0">
                {formatDeterministicUtc(assignment.assigned_at)}
              </span>
            </div>
          </div>

          {/* Genuine location address (strictly omitted if null, never fabricated) */}
          {assignment.location_address && (
            <div className="rounded border border-slate-200 bg-white p-3 text-xs space-y-1 min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 block">
                Incident Location
              </span>
              <p className="text-slate-900 font-medium break-words whitespace-normal min-w-0">
                {assignment.location_address}
              </p>
            </div>
          )}

          {/* Customer details (strictly omitted if both null) */}
          {(assignment.customer_name || assignment.customer_phone) && (
            <div className="rounded border border-slate-200 bg-slate-50/50 p-3 space-y-2 text-xs min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-600 block">
                Customer Details
              </span>
              {assignment.customer_name && (
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="text-slate-600 shrink-0">Name:</span>
                  <span className="font-medium text-slate-900 text-right break-words whitespace-normal min-w-0">
                    {assignment.customer_name}
                  </span>
                </div>
              )}
              {assignment.customer_phone && (
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="text-slate-600 shrink-0">Phone:</span>
                  <a
                    href={`tel:${assignment.customer_phone}`}
                    className="font-medium text-blue-600 hover:text-blue-800 hover:underline text-right break-words whitespace-normal min-w-0"
                  >
                    {assignment.customer_phone}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Assigned vehicle (omitted if vehicle_id is null) */}
          {assignment.vehicle_id !== null && assignment.callsign && (
            <div className="rounded border border-slate-200 bg-slate-50/50 p-3 space-y-2 text-xs min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-600 block">
                Assigned Vehicle
              </span>
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-slate-600 shrink-0">Callsign:</span>
                <span className="font-mono font-medium text-slate-900 text-right break-words whitespace-normal min-w-0">
                  {assignment.callsign}
                </span>
              </div>
              {assignment.registration_number && (
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="text-slate-600 shrink-0">Registration:</span>
                  <span className="font-mono font-medium text-slate-900 text-right break-words whitespace-normal min-w-0">
                    {assignment.registration_number}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Assigned vehicle location telemetry (omitted if vehicle_id is null) */}
          {assignment.vehicle_id !== null && (
            <WorkerLocationControl />
          )}

          {/* Required capability (omitted if null) */}
          {assignment.required_capability && (
            <div className="flex items-center justify-between gap-2 text-xs min-w-0">
              <span className="text-slate-600 shrink-0">Required Capability:</span>
              <Badge variant="outline" className="text-[11px] font-medium text-right break-words whitespace-normal max-w-[60%]">
                {assignment.required_capability.name}
              </Badge>
            </div>
          )}

          {/* Feedback messages */}
          {errorMessage && (
            <div
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium break-words"
            >
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              aria-live="polite"
              className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 font-medium break-words"
            >
              {successMessage}
            </div>
          )}

          {isBusy && (
            <div
              aria-live="polite"
              className="text-center text-xs text-slate-500 font-medium animate-pulse"
            >
              Updating assignment status…
            </div>
          )}

          {/* Mobile-first full-width lifecycle action button */}
          <div className="pt-2 space-y-2">
            {config ? (
              <Button
                type="button"
                onClick={handleLifecycleAction}
                disabled={isBusy}
                className="w-full py-3 px-4 min-h-[44px] text-sm font-semibold rounded-lg shadow-sm"
                variant="default"
              >
                {isBusy ? 'Processing…' : config.buttonLabel}
              </Button>
            ) : (
              <div className="rounded border border-slate-200 bg-slate-100 p-3 text-center text-xs text-slate-500 font-medium">
                Action unavailable
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isBusy}
              className="w-full min-h-[44px] sm:min-h-[36px] text-xs text-slate-700"
            >
              {isRefreshPending ? 'Refreshing…' : 'Refresh Assignment'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
