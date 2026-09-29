'use client';

import React from 'react';
import Link from 'next/link';
import {
  OperationsIncident,
  OperationsVehicle,
  OperationsSelection,
  IncidentPriority,
  IncidentStatus,
} from '@/types';

interface OperationsContextPanelProps {
  selection: OperationsSelection;
  incidents: OperationsIncident[];
  vehicles: OperationsVehicle[];
  generatedAt: string;
  onClearSelection: () => void;
  onFitOperationalArea: () => void;
}

function getPriorityBadgeClass(priority: IncidentPriority): string {
  switch (priority) {
    case 'critical':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'high':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'standard':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'low':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function getStatusBadgeClass(status: IncidentStatus): string {
  switch (status) {
    case 'new':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'triaged':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'ready_for_dispatch':
      return 'bg-cyan-100 text-cyan-800 border-cyan-200';
    case 'dispatched':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'en_route':
      return 'bg-indigo-100 text-indigo-800 border-indigo-200';
    case 'on_scene':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    case 'in_progress':
      return 'bg-teal-100 text-teal-800 border-teal-200';
    default:
      return 'bg-slate-100 text-slate-800 border-slate-200';
  }
}

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Location timestamp unavailable';
  try {
    const elapsedMs = Date.now() - new Date(isoString).getTime();
    if (elapsedMs < 0) return 'Just now';
    const minutes = Math.floor(elapsedMs / 60000);
    if (minutes < 1) return 'Updated < 1m ago';
    if (minutes < 60) return `Updated ${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Updated ${hours}h ago`;
    return `Updated ${Math.floor(hours / 24)}d ago`;
  } catch {
    return 'Location timestamp unavailable';
  }
}

export function OperationsContextPanel({
  selection,
  incidents,
  vehicles,
  generatedAt,
  onClearSelection,
  onFitOperationalArea,
}: OperationsContextPanelProps) {
  // 1. Resolve selected entity
  const selectedIncident =
    selection?.type === 'incident' ? incidents.find((i) => i.id === selection.id) : null;
  const selectedVehicle =
    selection?.type === 'vehicle' ? vehicles.find((v) => v.id === selection.id) : null;

  // 2. Incident Selected State
  if (selectedIncident) {
    const hasCoordinates =
      selectedIncident.latitude !== null && selectedIncident.longitude !== null;

    return (
      <aside
        aria-label="Incident Detail Panel"
        className="flex flex-col h-full bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden"
      >
        {/* Panel Header */}
        <div className="p-3 border-b border-slate-200 bg-slate-50/75 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
              Incident Context
            </span>
            <h3 className="font-mono text-sm font-bold text-slate-900">
              {selectedIncident.reference_number}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100 cursor-pointer"
            aria-label="Close detail panel"
          >
            ✕
          </button>
        </div>

        {/* Panel Content */}
        <div className="flex-1 p-3.5 space-y-3.5 overflow-y-auto text-xs">
          {/* Status & Priority Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border uppercase tracking-wider ${getPriorityBadgeClass(
                selectedIncident.priority
              )}`}
            >
              {selectedIncident.priority} priority
            </span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border capitalize ${getStatusBadgeClass(
                selectedIncident.status
              )}`}
            >
              {selectedIncident.status.replace(/_/g, ' ')}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200 capitalize">
              {selectedIncident.service_type.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Customer Details */}
          <div className="rounded-md border border-slate-200 bg-slate-50/50 p-2.5 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
              Customer
            </span>
            <p className="font-medium text-slate-900">{selectedIncident.customer_name}</p>
            <p className="text-slate-600 font-mono text-[11px]">
              {selectedIncident.customer_phone || 'No phone recorded'}
            </p>
          </div>

          {/* Location Details */}
          <div className="rounded-md border border-slate-200 bg-slate-50/50 p-2.5 space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
              Location
            </span>
            <p className="text-slate-800">{selectedIncident.location_address || 'Address not recorded'}</p>
            <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500 flex-wrap">
              {hasCoordinates ? (
                <>
                  <span className="text-emerald-700 font-medium">Coordinates recorded</span>
                  {selectedIncident.location_accuracy !== null && (
                    <span>Accuracy: ±{selectedIncident.location_accuracy}m</span>
                  )}
                  {selectedIncident.location_source && (
                    <span className="capitalize">Source: {selectedIncident.location_source.replace(/_/g, ' ')}</span>
                  )}
                </>
              ) : (
                <span className="text-amber-700 font-medium bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                  Missing coordinates
                </span>
              )}
            </div>
          </div>

          {/* Required Capability */}
          {selectedIncident.required_capability && (
            <div className="rounded-md border border-slate-200 bg-slate-50/50 p-2.5 space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
                Required Capability
              </span>
              <p className="font-medium text-slate-900">
                {selectedIncident.required_capability.name}
              </p>
              <span className="text-[10px] font-mono text-slate-500">
                Code: {selectedIncident.required_capability.code}
              </span>
            </div>
          )}

          {/* Customer Vehicle Information */}
          {(selectedIncident.vehicle_registration ||
            selectedIncident.vehicle_make ||
            selectedIncident.vehicle_model ||
            selectedIncident.vehicle_year ||
            selectedIncident.vehicle_color) && (
            <div className="rounded-md border border-slate-200 bg-slate-50/50 p-2.5 space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
                Customer Vehicle
              </span>
              {selectedIncident.vehicle_registration && (
                <p className="font-mono font-medium text-slate-900">
                  Reg: {selectedIncident.vehicle_registration}
                </p>
              )}
              <p className="text-slate-700">
                {[
                  selectedIncident.vehicle_year,
                  selectedIncident.vehicle_color,
                  selectedIncident.vehicle_make,
                  selectedIncident.vehicle_model,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            </div>
          )}

          {/* Notes */}
          {selectedIncident.notes && (
            <div className="rounded-md border border-slate-200 bg-slate-50/50 p-2.5 space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
                Notes
              </span>
              <p className="text-slate-700 whitespace-pre-line text-xs">{selectedIncident.notes}</p>
            </div>
          )}

          {/* Created Timestamp */}
          <div className="text-[11px] text-slate-400 font-mono">
            Created: {new Date(selectedIncident.created_at).toLocaleString()}
          </div>

          {/* Full Record Link */}
          <div className="pt-2">
            <Link
              href={`/incidents/${selectedIncident.id}`}
              className="inline-flex items-center justify-center w-full px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-xs transition-colors"
            >
              Open full incident record →
            </Link>
          </div>
        </div>
      </aside>
    );
  }

  // 3. Vehicle Selected State
  if (selectedVehicle) {
    const hasCoordinates =
      selectedVehicle.latitude !== null && selectedVehicle.longitude !== null;

    return (
      <aside
        aria-label="Vehicle Detail Panel"
        className="flex flex-col h-full bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden"
      >
        {/* Panel Header */}
        <div className="p-3 border-b border-slate-200 bg-slate-50/75 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
              Fleet Unit Context
            </span>
            <h3 className="font-mono text-sm font-bold text-slate-900">
              Unit {selectedVehicle.callsign}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClearSelection}
            className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100 cursor-pointer"
            aria-label="Close detail panel"
          >
            ✕
          </button>
        </div>

        {/* Panel Content */}
        <div className="flex-1 p-3.5 space-y-3.5 overflow-y-auto text-xs">
          {/* Active Fleet Badge */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
              Active Fleet Record
            </span>
            {selectedVehicle.registration_number && (
              <span className="font-mono text-slate-600 text-[11px]">
                Reg: {selectedVehicle.registration_number}
              </span>
            )}
          </div>

          {/* Last Known Location */}
          <div className="rounded-md border border-slate-200 bg-slate-50/50 p-2.5 space-y-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
              Last Known Location
            </span>
            {hasCoordinates ? (
              <>
                <p className="text-slate-800 font-mono text-[11px]">
                  {selectedVehicle.latitude?.toFixed(5)}, {selectedVehicle.longitude?.toFixed(5)}
                </p>
                <p className="text-[11px] text-slate-500">
                  {formatRelativeTime(selectedVehicle.location_updated_at)}
                </p>
              </>
            ) : (
              <p className="text-slate-500 text-[11px] italic">
                No stored location recorded
              </p>
            )}
            <p className="text-[10px] text-slate-400 pt-1">
              Vehicle positions show the latest stored location and are not a live GPS feed.
            </p>
          </div>

          {/* Assigned Capabilities */}
          <div className="rounded-md border border-slate-200 bg-slate-50/50 p-2.5 space-y-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block">
              Vehicle Capabilities
            </span>
            {selectedVehicle.capabilities.length === 0 ? (
              <p className="text-slate-500 text-[11px] italic">No active capabilities registered</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {selectedVehicle.capabilities.map((cap) => (
                  <span
                    key={cap.id}
                    className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-white text-slate-700 border border-slate-200 shadow-2xs"
                  >
                    {cap.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    );
  }

  // 4. No Selection State (Default Operational Overview)
  const locatedVehiclesCount = vehicles.filter(
    (v) => v.latitude !== null && v.longitude !== null
  ).length;
  const missingLocationIncidentsCount = incidents.filter(
    (i) => i.latitude === null || i.longitude === null
  ).length;

  return (
    <aside
      aria-label="Operations Overview Panel"
      className="flex flex-col h-full bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden"
    >
      {/* Panel Header */}
      <div className="p-3 border-b border-slate-200 bg-slate-50/75">
        <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
          Operations Overview
        </h3>
        <p className="text-[11px] text-slate-500">
          Select an incident or response unit to view operational context.
        </p>
      </div>

      {/* Overview Statistics */}
      <div className="flex-1 p-3.5 space-y-3 overflow-y-auto text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-md border border-slate-200 bg-slate-50/50">
            <span className="text-[10px] uppercase font-semibold text-slate-500 block">
              Active Incidents
            </span>
            <span className="text-xl font-bold font-mono text-slate-900">
              {incidents.length}
            </span>
          </div>
          <div className="p-2.5 rounded-md border border-slate-200 bg-slate-50/50">
            <span className="text-[10px] uppercase font-semibold text-slate-500 block">
              Located Units
            </span>
            <span className="text-xl font-bold font-mono text-slate-900">
              {locatedVehiclesCount}
              <span className="text-xs font-normal text-slate-400"> / {vehicles.length}</span>
            </span>
          </div>
        </div>

        {missingLocationIncidentsCount > 0 && (
          <div className="p-2.5 rounded-md border border-amber-200 bg-amber-50/50 text-amber-800">
            <span className="text-[10px] uppercase font-semibold block mb-0.5">
              Unmapped Incidents
            </span>
            <p className="text-xs">
              {missingLocationIncidentsCount} active {missingLocationIncidentsCount === 1 ? 'incident lacks' : 'incidents lack'} coordinates.
            </p>
          </div>
        )}

        <div className="rounded-md border border-slate-200 bg-slate-50/50 p-2.5 space-y-1">
          <span className="text-[10px] uppercase font-semibold text-slate-500 block">
            Snapshot Freshness
          </span>
          <p className="text-slate-700 font-mono text-xs">
            Snapshot generated {formatTime(generatedAt)}
          </p>
        </div>

        <div className="rounded-md border border-slate-200 bg-white p-2.5">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Vehicle positions show the latest stored location and are not a live GPS feed.
          </p>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={onFitOperationalArea}
            className="w-full inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-2xs"
          >
            Fit operational area
          </button>
        </div>
      </div>
    </aside>
  );
}
