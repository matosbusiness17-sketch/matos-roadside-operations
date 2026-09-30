'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  OperationsIncident,
  DispatchContext,
  DispatchCandidate,
} from '@/types';
import {
  loadDispatchCandidates,
  dispatchIncident,
  reassignIncident,
} from '@/lib/dispatch/actions';

interface DispatchPanelProps {
  incident: OperationsIncident;
  onRefreshWorkspace: () => Promise<void>;
  onHighlightVehicle: (vehicleId: string | null) => void;
}

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return 'Distance unavailable';
  if (meters < 1000) {
    return `${Math.round(meters)} m away`;
  }
  return `${(meters / 1000).toFixed(1)} km away`;
}

function formatTime(isoString: string): string {
  const timestamp = Date.parse(isoString);
  if (!Number.isFinite(timestamp)) {
    return 'Time unavailable';
  }
  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Time unavailable';
  }
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Location timestamp unavailable';
  const timestamp = Date.parse(isoString);
  if (!Number.isFinite(timestamp)) {
    return 'Location timestamp unavailable';
  }
  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 0) return 'Just now';
  const minutes = Math.floor(elapsedMs / 60000);
  if (minutes < 1) return '< 1m ago';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (!Number.isFinite(days)) return 'Location timestamp unavailable';
  return `${days}d ago`;
}

export function DispatchPanel({
  incident,
  onRefreshWorkspace,
  onHighlightVehicle,
}: DispatchPanelProps) {
  // Candidate loading state
  const [dispatchContext, setDispatchContext] = useState<DispatchContext | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Stale request guard
  const requestSeqRef = useRef<number>(0);

  // Confirmation mode state
  const [selectedCandidate, setSelectedCandidate] = useState<DispatchCandidate | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Reassignment mode toggle (for dispatched incidents in reassignment state)
  const [isReassignMode, setIsReassignMode] = useState<boolean>(false);

  // Fetch candidate context with stale-response protection
  // options.clearMutationNotice allows preserving error notices during stale-conflict refreshes
  const fetchCandidates = useCallback(
    async (options?: { clearMutationNotice?: boolean }) => {
      const clearNotice = options?.clearMutationNotice ?? true;
      const currentSeq = ++requestSeqRef.current;
      setIsLoading(true);
      setFetchError(null);
      setIsReassignMode(false);
      if (clearNotice) {
        setMutationError(null);
      }
      setSelectedCandidate(null);
      setIsConfirming(false);
      onHighlightVehicle(null);

      try {
        const result = await loadDispatchCandidates(incident.id);

        // Discard response if another incident selection or reload happened
        if (currentSeq !== requestSeqRef.current) {
          return;
        }

        if (result.success) {
          setDispatchContext(result.context);
          setFetchError(null);
        } else {
          setDispatchContext(null);
          setFetchError(result.error.message || 'Dispatch candidates could not be loaded.');
          setIsReassignMode(false);
        }
      } catch (err) {
        if (currentSeq !== requestSeqRef.current) return;
        console.error('Failed to load dispatch candidates:', err);
        setDispatchContext(null);
        setFetchError('Dispatch candidates could not be loaded.');
        setIsReassignMode(false);
      } finally {
        if (currentSeq === requestSeqRef.current) {
          setIsLoading(false);
        }
      }
    },
    [incident.id, onHighlightVehicle]
  );

  // Load candidates on incident ID change
  useEffect(() => {
    queueMicrotask(() => {
      void fetchCandidates({ clearMutationNotice: true });
    });
    return () => {
      onHighlightVehicle(null);
    };
  }, [incident.id, fetchCandidates, onHighlightVehicle]);

  // Robust Reassignment Mode Reset Invariant:
  // Reset reassign mode whenever context is not in reassignment or current assignment is not assigned
  useEffect(() => {
    if (
      !dispatchContext ||
      dispatchContext.dispatch_state !== 'reassignment' ||
      dispatchContext.current_assignment?.status !== 'assigned'
    ) {
      queueMicrotask(() => {
        setIsReassignMode(false);
      });
    }
  }, [dispatchContext]);

  // Handle unit selection for confirmation
  const handleSelectCandidate = (candidate: DispatchCandidate) => {
    setSelectedCandidate(candidate);
    setIsConfirming(true);
    setMutationError(null);
    onHighlightVehicle(candidate.vehicle_id);
  };

  const handleCancelConfirmation = () => {
    setSelectedCandidate(null);
    setIsConfirming(false);
    setMutationError(null);
    onHighlightVehicle(null);
  };

  // Authoritative dispatch confirmation
  const handleConfirmDispatch = async () => {
    if (!selectedCandidate || isSubmitting) return;

    setIsSubmitting(true);
    setMutationError(null);

    try {
      if (dispatchContext?.dispatch_state === 'reassignment' && isReassignMode) {
        if (!dispatchContext.current_assignment) {
          setMutationError('Current assignment context missing.');
          setIsSubmitting(false);
          return;
        }

        const res = await reassignIncident(
          incident.id,
          dispatchContext.current_assignment.id,
          selectedCandidate.worker_id,
          selectedCandidate.vehicle_id
        );

        if (res.success) {
          setIsConfirming(false);
          setSelectedCandidate(null);
          setIsReassignMode(false);
          onHighlightVehicle(null);
          setMutationError(null);
          await onRefreshWorkspace();
          await fetchCandidates({ clearMutationNotice: true });
        } else {
          // Stale unit or conflict handling
          const isStaleConflict =
            res.error.code === 'CANDIDATE_NO_LONGER_ELIGIBLE' ||
            res.error.code === 'DISPATCH_CONFLICT';
          const isReassignBlocked = res.error.code === 'REASSIGNMENT_NOT_ALLOWED';

          let errorMsg = res.error.message || 'Reassignment could not be completed.';
          if (isStaleConflict) {
            errorMsg =
              'Dispatch could not be completed. This unit is no longer available. Candidates have been refreshed.';
          } else if (isReassignBlocked) {
            errorMsg =
              'Reassignment is no longer allowed. The current assignment may have already progressed.';
          }

          setMutationError(errorMsg);
          setIsConfirming(false);
          setSelectedCandidate(null);
          onHighlightVehicle(null);

          // Refresh context automatically while PRESERVING mutation notice
          await onRefreshWorkspace();
          await fetchCandidates({ clearMutationNotice: false });
        }
      } else {
        const res = await dispatchIncident(
          incident.id,
          selectedCandidate.worker_id,
          selectedCandidate.vehicle_id
        );

        if (res.success) {
          setIsConfirming(false);
          setSelectedCandidate(null);
          onHighlightVehicle(null);
          setMutationError(null);
          await onRefreshWorkspace();
          await fetchCandidates({ clearMutationNotice: true });
        } else {
          // Stale unit or conflict handling
          const isStaleConflict =
            res.error.code === 'CANDIDATE_NO_LONGER_ELIGIBLE' ||
            res.error.code === 'DISPATCH_CONFLICT';

          const errorMsg = isStaleConflict
            ? 'Dispatch could not be completed. This unit is no longer available. Candidates have been refreshed.'
            : res.error.message || 'Dispatch could not be completed.';

          setMutationError(errorMsg);
          setIsConfirming(false);
          setSelectedCandidate(null);
          onHighlightVehicle(null);

          // Refresh context automatically while PRESERVING mutation notice
          await onRefreshWorkspace();
          await fetchCandidates({ clearMutationNotice: false });
        }
      }
    } catch (err) {
      console.error('Error during dispatch mutation:', err);
      setMutationError('Dispatch could not be completed. Please try again.');
      setIsConfirming(false);
      setSelectedCandidate(null);
      onHighlightVehicle(null);
      await onRefreshWorkspace();
      await fetchCandidates({ clearMutationNotice: false });
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50/50 p-3 text-xs space-y-2">
        <div className="flex items-center space-x-2 text-slate-600">
          <svg
            className="animate-spin h-3.5 w-3.5 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="font-medium">Evaluating dispatch candidates…</span>
        </div>
        <p className="text-[11px] text-slate-500">
          Verifying active shift assignments, capabilities, and availability.
        </p>
      </div>
    );
  }

  // 2. Fetch Error State
  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50/50 p-3 text-xs space-y-2 text-red-900">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[11px] uppercase tracking-wider text-red-700">
            Dispatch Error
          </span>
          <button
            type="button"
            onClick={() => fetchCandidates({ clearMutationNotice: true })}
            className="text-[11px] font-medium text-red-700 hover:text-red-900 underline cursor-pointer"
          >
            Retry
          </button>
        </div>
        <p>{fetchError}</p>
      </div>
    );
  }

  // If no dispatch context available
  if (!dispatchContext) {
    return null;
  }

  const { dispatch_state, current_assignment, ranked_candidates, unranked_candidates } =
    dispatchContext;

  // 3. Current Assigned State (Incident is dispatched, not in reassign mode)
  if (
    (dispatch_state === 'reassignment' || dispatch_state === 'assigned_locked') &&
    current_assignment &&
    !isReassignMode
  ) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50/75 p-3 text-xs space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Assigned Response
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 border border-amber-200 capitalize">
            {current_assignment.status}
          </span>
        </div>

        {mutationError && (
          <div className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
            {mutationError}
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-900 font-mono text-sm">
              Unit {current_assignment.callsign}
            </span>
            {current_assignment.registration_number && (
              <span className="text-slate-500 font-mono text-[11px]">
                {current_assignment.registration_number}
              </span>
            )}
          </div>
          <p className="text-slate-700 font-medium">{current_assignment.worker_name}</p>
          <p className="text-[11px] text-slate-500">
            Assigned at {formatTime(current_assignment.assigned_at)}
          </p>
        </div>

        {dispatch_state === 'reassignment' ? (
          <div className="pt-1 border-t border-slate-200">
            <button
              type="button"
              onClick={() => {
                setIsReassignMode(true);
                setMutationError(null);
              }}
              className="w-full inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs transition-colors"
            >
              Reassign unit
            </button>
          </div>
        ) : (
          <div className="pt-1 border-t border-slate-200">
            <p className="text-[11px] text-slate-500 italic">
              Unit has progressed beyond assigned status; reassignment locked.
            </p>
          </div>
        )}
      </div>
    );
  }

  // 4. Confirmation View (when operator selects a candidate)
  if (isConfirming && selectedCandidate) {
    const isRanked =
      'distance_meters' in selectedCandidate && selectedCandidate.distance_meters !== null;
    const distanceDisplay = isRanked
      ? formatDistance(selectedCandidate.distance_meters)
      : 'Location unavailable';

    return (
      <div className="rounded-md border border-blue-200 bg-blue-50/40 p-3 text-xs space-y-3">
        <div className="flex items-center justify-between border-b border-blue-200/60 pb-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-900">
            {isReassignMode ? 'Confirm Reassignment' : 'Confirm Dispatch'}
          </span>
          <span className="font-mono text-[11px] font-bold text-blue-950">
            {incident.reference_number}
          </span>
        </div>

        {mutationError && (
          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-800 text-[11px]">
            {mutationError}
          </div>
        )}

        <div className="space-y-1.5 bg-white p-2.5 rounded border border-blue-100">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Unit:</span>
            <span className="font-bold font-mono text-slate-900">
              Unit {selectedCandidate.callsign}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Worker:</span>
            <span className="font-medium text-slate-900">{selectedCandidate.worker_name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Distance:</span>
            <span className="font-mono text-slate-700">{distanceDisplay}</span>
          </div>
          {incident.required_capability && (
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Capability:</span>
              <span className="text-emerald-700 font-medium">
                {incident.required_capability.name} ✓
              </span>
            </div>
          )}
        </div>

        <p className="text-[11px] text-slate-600 leading-normal">
          {isReassignMode
            ? 'This will cancel the current assignment and create a replacement assignment. The incident will remain dispatched.'
            : 'Authoritative database transaction will assign this unit and transition the incident to dispatched.'}
        </p>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={handleConfirmDispatch}
            disabled={isSubmitting}
            className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs transition-colors"
          >
            {isSubmitting
              ? 'Confirming…'
              : isReassignMode
              ? 'Confirm reassignment'
              : 'Confirm dispatch'}
          </button>
          <button
            type="button"
            onClick={handleCancelConfirmation}
            disabled={isSubmitting}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-slate-400 cursor-pointer shadow-2xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // 5. Candidate List View (initial_dispatch or active reassign mode)
  const totalCandidates = ranked_candidates.length + unranked_candidates.length;

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/50 p-3 text-xs space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
            Decision Support
          </span>
          <h4 className="font-bold text-slate-900 text-xs">
            {isReassignMode ? 'Replacement Candidates' : 'Dispatch Candidates'}
          </h4>
        </div>
        {isReassignMode && (
          <button
            type="button"
            onClick={() => {
              setIsReassignMode(false);
              setSelectedCandidate(null);
              onHighlightVehicle(null);
            }}
            className="text-[11px] text-slate-500 hover:text-slate-700 underline cursor-pointer"
          >
            Back to assigned
          </button>
        )}
      </div>

      {mutationError && (
        <div className="p-2 rounded bg-amber-50 border border-amber-200 text-amber-900 text-[11px]">
          {mutationError}
        </div>
      )}

      {/* Incident Location Missing Notice */}
      {!dispatchContext.ranking_available && (
        <div className="p-2 rounded bg-amber-50/80 border border-amber-200 text-amber-900 text-[11px] leading-normal">
          <span className="font-semibold block">Distance ranking unavailable</span>
          Incident lacks stored coordinates. Eligible operational units are shown without
          geographic ranking.
        </div>
      )}

      {/* Zero Candidates Operational State */}
      {totalCandidates === 0 ? (
        <div className="p-2.5 rounded bg-white border border-slate-200 text-slate-600 space-y-1 text-[11px]">
          <p className="font-medium text-slate-800">
            No currently available worker–vehicle pair satisfies this incident’s requirements.
          </p>
          <p className="text-slate-500">
            Units require an active shift assignment, available worker status, active vehicle
            status, capability match, and zero active assignment conflicts.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Ranked Candidates Section */}
          {ranked_candidates.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
                Ranked by Proximity ({ranked_candidates.length})
              </span>
              <div className="space-y-1.5">
                {ranked_candidates.map((cand, index) => (
                  <div
                    key={`${cand.worker_id}-${cand.vehicle_id}`}
                    onMouseEnter={() => onHighlightVehicle(cand.vehicle_id)}
                    onMouseLeave={() => onHighlightVehicle(null)}
                    className="p-2 rounded bg-white border border-slate-200 hover:border-blue-400 hover:shadow-2xs transition-all space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-slate-900 text-xs">
                          Unit {cand.callsign}
                        </span>
                        {index === 0 && (
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Closest eligible unit
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-blue-700 font-semibold text-[11px]">
                        {formatDistance(cand.distance_meters)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-600">
                      <span>{cand.worker_name}</span>
                      {cand.registration_number && (
                        <span className="font-mono text-slate-400">
                          {cand.registration_number}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5 border-t border-slate-100">
                      <span>
                        Last known: {formatRelativeTime(cand.vehicle_location_updated_at)}
                      </span>
                      {incident.required_capability && (
                        <span className="text-emerald-700 font-medium">
                          {incident.required_capability.name} ✓
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectCandidate(cand)}
                      className="w-full mt-1 inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-blue-600 hover:text-white border border-slate-200 hover:border-blue-600 rounded transition-colors cursor-pointer"
                    >
                      Select unit
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Unranked Candidates Section */}
          {unranked_candidates.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
                Eligible — location unavailable ({unranked_candidates.length})
              </span>
              <div className="space-y-1.5">
                {unranked_candidates.map((cand) => (
                  <div
                    key={`${cand.worker_id}-${cand.vehicle_id}`}
                    onMouseEnter={() => onHighlightVehicle(cand.vehicle_id)}
                    onMouseLeave={() => onHighlightVehicle(null)}
                    className="p-2 rounded bg-white border border-slate-200 hover:border-slate-400 hover:shadow-2xs transition-all space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-slate-900 text-xs">
                        Unit {cand.callsign}
                      </span>
                      {cand.ranking_reason === 'incident_location_unavailable' ? (
                        <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                          Incident coordinates not recorded
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                          Vehicle location unavailable
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-600">
                      <span>{cand.worker_name}</span>
                      {cand.registration_number && (
                        <span className="font-mono text-slate-400">
                          {cand.registration_number}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5 border-t border-slate-100">
                      {cand.ranking_reason === 'incident_location_unavailable' ? (
                        <span>
                          {cand.vehicle_location_updated_at
                            ? `Vehicle position: ${formatRelativeTime(cand.vehicle_location_updated_at)}`
                            : 'Vehicle location unavailable'}
                        </span>
                      ) : (
                        <span>Location unavailable</span>
                      )}
                      {incident.required_capability && (
                        <span className="text-emerald-700 font-medium">
                          {incident.required_capability.name} ✓
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectCandidate(cand)}
                      className="w-full mt-1 inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-800 hover:text-white border border-slate-200 hover:border-slate-800 rounded transition-colors cursor-pointer"
                    >
                      Select unit
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
