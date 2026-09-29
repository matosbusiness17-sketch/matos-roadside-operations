'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  OperationsSnapshot,
  OperationsSelection,
} from '@/types';
import { IncidentQueue } from '@/components/operations/incident-queue';
import { OperationsMap } from '@/components/operations/operations-map';
import { OperationsContextPanel } from '@/components/operations/operations-context-panel';
import { refreshOperationsSnapshot } from '@/lib/operations/actions';

interface OperationsWorkspaceProps {
  initialSnapshot: OperationsSnapshot;
  mapboxToken: string;
  isMapboxConfigured: boolean;
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoString;
  }
}

export function OperationsWorkspace({
  initialSnapshot,
  mapboxToken,
  isMapboxConfigured,
}: OperationsWorkspaceProps) {
  // Snapshot state
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>(initialSnapshot);
  const [selection, setSelection] = useState<OperationsSelection>(null);

  // Queue filter and search state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');

  // Refresh and action states
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [fitTrigger, setFitTrigger] = useState(0);

  // Filter incidents client-side, preserving authoritative snapshot ordering
  const filteredIncidents = useMemo(() => {
    return snapshot.incidents.filter((inc) => {
      // Status filter
      if (statusFilter !== 'all' && inc.status !== statusFilter) {
        return false;
      }
      // Priority filter
      if (priorityFilter !== 'all' && inc.priority !== priorityFilter) {
        return false;
      }
      // Service filter
      if (serviceFilter !== 'all' && inc.service_type !== serviceFilter) {
        return false;
      }
      // Text search
      if (searchQuery.trim().length > 0) {
        const query = searchQuery.trim().toLowerCase();
        const matchesRef = inc.reference_number.toLowerCase().includes(query);
        const matchesCustomer = inc.customer_name.toLowerCase().includes(query);
        const matchesAddress = inc.location_address.toLowerCase().includes(query);
        const matchesReg = inc.vehicle_registration?.toLowerCase().includes(query) ?? false;
        if (!matchesRef && !matchesCustomer && !matchesAddress && !matchesReg) {
          return false;
        }
      }
      return true;
    });
  }, [snapshot.incidents, statusFilter, priorityFilter, serviceFilter, searchQuery]);

  // Reconcile selection: if the selected incident becomes hidden by a filter or search,
  // the actual selection state is cleared (not merely masked).
  useEffect(() => {
    if (selection?.type === 'incident') {
      const stillVisible = filteredIncidents.some((i) => i.id === selection.id);
      if (!stillVisible) {
        queueMicrotask(() => setSelection(null));
      }
    }
  }, [filteredIncidents, selection]);

  // Selection handlers
  const handleSelectIncident = useCallback((id: string) => {
    setSelection({ type: 'incident', id });
  }, []);

  const handleSelectVehicle = useCallback((id: string) => {
    setSelection({ type: 'vehicle', id });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  // Manual snapshot refresh handler
  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);

    try {
      const result = await refreshOperationsSnapshot();

      if (result.success) {
        setSnapshot(result.snapshot);
        setRefreshWarning(null);

        // Reconcile selection against new snapshot
        setSelection((prev) => {
          if (!prev) return null;
          if (prev.type === 'incident') {
            const exists = result.snapshot.incidents.some((i) => i.id === prev.id);
            return exists ? prev : null;
          }
          if (prev.type === 'vehicle') {
            const exists = result.snapshot.vehicles.some((v) => v.id === prev.id);
            return exists ? prev : null;
          }
          return null;
        });
      } else {
        // Non-destructive: retain existing snapshot, timestamp, and selection
        setRefreshWarning(
          'Refresh failed. Showing the last successfully loaded operational snapshot.'
        );
      }
    } catch (err) {
      console.error('Snapshot refresh request failed:', err);
      setRefreshWarning(
        'Refresh failed. Showing the last successfully loaded operational snapshot.'
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleFitOperationalArea = useCallback(() => {
    setFitTrigger((t) => t + 1);
  }, []);

  return (
    <div className="flex flex-col space-y-3 h-[calc(100vh-10.5rem)] min-h-[620px]">
      {/* Workspace Header / Controls Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1 border-b border-slate-200">
        <div className="flex items-center space-x-3">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Operations</h1>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono bg-slate-100 text-slate-700 border border-slate-200">
            Snapshot {formatTime(snapshot.generated_at)}
          </span>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleFitOperationalArea}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs transition-colors"
          >
            Fit operational area
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs transition-colors"
          >
            {isRefreshing ? (
              <>
                <svg
                  className="animate-spin -ml-0.5 mr-1.5 h-3.5 w-3.5 text-white"
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
                Refreshing…
              </>
            ) : (
              'Refresh'
            )}
          </button>
        </div>
      </div>

      {/* Non-destructive Refresh Warning Banner */}
      {refreshWarning && (
        <div
          role="alert"
          className="flex items-center justify-between p-2.5 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md shadow-2xs"
        >
          <div className="flex items-center space-x-2">
            <span className="font-bold">Notice:</span>
            <span>{refreshWarning}</span>
          </div>
          <button
            type="button"
            onClick={() => setRefreshWarning(null)}
            className="text-amber-700 hover:text-amber-900 font-semibold px-1 cursor-pointer"
            aria-label="Dismiss warning"
          >
            ✕
          </button>
        </div>
      )}

      {/* Synchronized Three-Region Operational Workspace */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 min-h-0 overflow-hidden">
        {/* Left Region: Incident Queue */}
        <div className="lg:col-span-3 h-full min-h-[300px] overflow-hidden">
          <IncidentQueue
            incidents={filteredIncidents}
            totalActiveCount={snapshot.incidents.length}
            selectedIncidentId={selection?.type === 'incident' ? selection.id : null}
            onSelectIncident={handleSelectIncident}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            priorityFilter={priorityFilter}
            onPriorityFilterChange={setPriorityFilter}
            serviceFilter={serviceFilter}
            onServiceFilterChange={setServiceFilter}
          />
        </div>

        {/* Center Region: Operational Map (Dominant) */}
        <div className="lg:col-span-6 h-full min-h-[420px] overflow-hidden">
          <OperationsMap
            incidents={filteredIncidents}
            vehicles={snapshot.vehicles}
            selection={selection}
            onSelectIncident={handleSelectIncident}
            onSelectVehicle={handleSelectVehicle}
            onClearSelection={handleClearSelection}
            mapboxToken={mapboxToken}
            isMapboxConfigured={isMapboxConfigured}
            fitTrigger={fitTrigger}
          />
        </div>

        {/* Right Region: Operational Context Panel */}
        <div className="lg:col-span-3 h-full min-h-[300px] overflow-hidden">
          <OperationsContextPanel
            selection={selection}
            incidents={snapshot.incidents}
            vehicles={snapshot.vehicles}
            generatedAt={snapshot.generated_at}
            onClearSelection={handleClearSelection}
            onFitOperationalArea={handleFitOperationalArea}
          />
        </div>
      </div>
    </div>
  );
}
