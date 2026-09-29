'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { transitionIncidentAction } from '@/lib/incidents/actions';
import {
  IncidentStatus,
  VALID_TRANSITIONS,
  TERMINAL_INCIDENT_STATUSES,
} from '@/types';

interface IncidentTransitionControlsProps {
  incidentId: string;
  currentStatus: IncidentStatus;
}

const ACTION_CONFIG: Record<
  IncidentStatus,
  { label: string; description: string; variant: 'primary' | 'success' | 'danger' | 'warning' | 'neutral' }
> = {
  new: { label: 'Reset to New', description: '', variant: 'neutral' },
  triaged: {
    label: 'Mark Triaged',
    description: 'Confirm customer details and problem classification.',
    variant: 'primary',
  },
  ready_for_dispatch: {
    label: 'Ready for Dispatch',
    description: 'Mark incident verified and ready for worker allocation.',
    variant: 'primary',
  },
  dispatched: {
    label: 'Mark Dispatched',
    description: 'Confirm unit assigned and dispatched to incident.',
    variant: 'primary',
  },
  en_route: {
    label: 'Mark En Route',
    description: 'Unit is travelling toward incident location.',
    variant: 'primary',
  },
  on_scene: {
    label: 'Mark On Scene',
    description: 'Unit has arrived safely at customer location.',
    variant: 'primary',
  },
  in_progress: {
    label: 'Start Work (In Progress)',
    description: 'Service intervention has commenced.',
    variant: 'primary',
  },
  completed: {
    label: 'Complete Incident',
    description: 'Roadside assistance service finished successfully.',
    variant: 'success',
  },
  cancelled: {
    label: 'Cancel Incident',
    description: 'Abort incident prior to completion.',
    variant: 'danger',
  },
  unable_to_complete: {
    label: 'Unable to Complete',
    description: 'Intervention could not be resolved or completed.',
    variant: 'warning',
  },
};

export function IncidentTransitionControls({
  incidentId,
  currentStatus,
}: IncidentTransitionControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal / Prompt state for terminal transitions requiring reason
  const [pendingTargetStatus, setPendingTargetStatus] = useState<IncidentStatus | null>(null);
  const [reasonInput, setReasonInput] = useState('');

  const validNextStates = VALID_TRANSITIONS[currentStatus] || [];
  const isTerminal = TERMINAL_INCIDENT_STATUSES.includes(currentStatus);

  const handleActionClick = (targetStatus: IncidentStatus) => {
    setErrorMessage(null);

    // If target requires a reason (cancelled or unable_to_complete), show reason prompt
    if (targetStatus === 'cancelled' || targetStatus === 'unable_to_complete') {
      setPendingTargetStatus(targetStatus);
      setReasonInput('');
      return;
    }

    // Direct transition for standard operational milestones
    executeTransition(targetStatus, undefined);
  };

  const executeTransition = (targetStatus: IncidentStatus, reason?: string) => {
    startTransition(async () => {
      const result = await transitionIncidentAction(incidentId, targetStatus, reason);

      if (!result.success) {
        setErrorMessage(result.error || 'Failed to update incident status.');
      } else {
        setPendingTargetStatus(null);
        setReasonInput('');
        router.refresh();
      }
    });
  };

  if (isTerminal) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center">
        <p className="text-xs font-semibold text-slate-700">
          This incident is in a terminal state ({currentStatus.replace(/_/g, ' ')})
        </p>
        <p className="text-[11px] text-slate-500 mt-1">
          No further lifecycle state transitions are permitted for closed records.
        </p>
      </div>
    );
  }

  if (validNextStates.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
        No valid next transitions available for current state ({currentStatus}).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Error Banner */}
      {errorMessage && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
          <span className="font-bold">Transition Error: </span>
          {errorMessage}
        </div>
      )}

      {/* Reason Confirmation Box for Exceptional Transitions */}
      {pendingTargetStatus && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
              Confirm {pendingTargetStatus === 'cancelled' ? 'Incident Cancellation' : 'Unable to Complete'}
            </h4>
            <button
              type="button"
              onClick={() => {
                setPendingTargetStatus(null);
                setReasonInput('');
              }}
              className="text-xs text-slate-500 hover:text-slate-900 font-semibold"
            >
              Cancel
            </button>
          </div>

          <p className="text-xs text-amber-800">
            Please provide an optional operational reason or justification for this outcome. This will be recorded immutably in the operational audit trail.
          </p>

          <div>
            <label htmlFor="transition_reason" className="block text-[11px] font-semibold text-slate-700 mb-1">
              Operational Reason / Notes
            </label>
            <textarea
              id="transition_reason"
              rows={2}
              disabled={isPending}
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              placeholder={
                pendingTargetStatus === 'cancelled'
                  ? 'e.g. Stranded vehicle safely restarted by owner; canceled by caller.'
                  : 'e.g. Specialized heavy tow required; vehicle in deep ditch inaccessible with standard flatbed.'
              }
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-900 focus:outline-hidden focus:ring-1 focus:ring-slate-900"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setPendingTargetStatus(null);
                setReasonInput('');
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Back
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => executeTransition(pendingTargetStatus, reasonInput)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors ${
                pendingTargetStatus === 'cancelled'
                  ? 'bg-rose-700 hover:bg-rose-800'
                  : 'bg-amber-700 hover:bg-amber-800'
              }`}
            >
              {isPending
                ? 'Processing...'
                : `Confirm ${pendingTargetStatus === 'cancelled' ? 'Cancellation' : 'Status'}`}
            </button>
          </div>
        </div>
      )}

      {/* Primary Transition Buttons */}
      {!pendingTargetStatus && (
        <div className="flex flex-wrap items-center gap-2">
          {validNextStates.map((target) => {
            const config = ACTION_CONFIG[target];
            const isDanger = config.variant === 'danger';
            const isWarning = config.variant === 'warning';
            const isSuccess = config.variant === 'success';

            let btnStyle = 'bg-slate-900 hover:bg-slate-800 text-white';
            if (isSuccess) {
              btnStyle = 'bg-emerald-700 hover:bg-emerald-800 text-white';
            } else if (isDanger) {
              btnStyle = 'bg-white hover:bg-rose-50 text-rose-700 border border-rose-300';
            } else if (isWarning) {
              btnStyle = 'bg-white hover:bg-amber-50 text-amber-800 border border-amber-300';
            }

            return (
              <button
                key={target}
                type="button"
                disabled={isPending}
                onClick={() => handleActionClick(target)}
                className={`inline-flex items-center justify-center rounded-md px-3.5 py-2 text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${btnStyle}`}
              >
                {isPending ? 'Updating...' : config.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
