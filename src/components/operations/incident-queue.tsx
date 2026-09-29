'use client';

import React from 'react';
import {
  OperationsIncident,
  IncidentPriority,
  IncidentStatus,
  ServiceType,
  ACTIVE_INCIDENT_STATUSES,
} from '@/types';

interface IncidentQueueProps {
  incidents: OperationsIncident[];
  totalActiveCount: number;
  selectedIncidentId: string | null;
  onSelectIncident: (id: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  priorityFilter: string;
  onPriorityFilterChange: (priority: string) => void;
  serviceFilter: string;
  onServiceFilterChange: (service: string) => void;
}

const SERVICE_TYPE_OPTIONS: { value: ServiceType; label: string }[] = [
  { value: 'towing', label: 'Towing' },
  { value: 'jump_start', label: 'Jump Start' },
  { value: 'lockout', label: 'Lockout' },
  { value: 'tire_change', label: 'Tire Change' },
  { value: 'fuel_delivery', label: 'Fuel Delivery' },
  { value: 'winch_recovery', label: 'Winch Recovery' },
  { value: 'general_assistance', label: 'General Assistance' },
];

const PRIORITY_OPTIONS: { value: IncidentPriority; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'standard', label: 'Standard' },
  { value: 'low', label: 'Low' },
];

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

function formatStatusLabel(status: IncidentStatus): string {
  return status.replace(/_/g, ' ');
}

function formatServiceLabel(service: ServiceType): string {
  return service.replace(/_/g, ' ');
}

function formatElapsed(createdAt: string): string {
  try {
    const elapsedMs = Date.now() - new Date(createdAt).getTime();
    if (elapsedMs < 0) return 'Just now';
    const minutes = Math.floor(elapsedMs / 60000);
    if (minutes < 1) return '< 1m ago';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return 'Unknown';
  }
}

export function IncidentQueue({
  incidents,
  totalActiveCount,
  selectedIncidentId,
  onSelectIncident,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  serviceFilter,
  onServiceFilterChange,
}: IncidentQueueProps) {
  return (
    <aside
      aria-label="Incident Queue"
      className="flex flex-col h-full bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden"
    >
      {/* Queue Header */}
      <div className="p-3 border-b border-slate-200 bg-slate-50/75 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-semibold text-slate-900 tracking-tight">Active Queue</h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-800">
              {incidents.length}
              {totalActiveCount !== incidents.length && ` of ${totalActiveCount}`}
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 uppercase">Priority Order</span>
        </div>

        {/* Search Input */}
        <div>
          <label htmlFor="queue-search" className="sr-only">
            Search incidents
          </label>
          <input
            id="queue-search"
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search ref, customer, address, reg..."
            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-slate-900 placeholder:text-slate-400"
          />
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-3 gap-1.5">
          {/* Status Filter */}
          <div>
            <label htmlFor="queue-status-filter" className="sr-only">
              Filter by status
            </label>
            <select
              id="queue-status-filter"
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="w-full px-1.5 py-1 text-[11px] bg-white border border-slate-300 rounded focus:outline-hidden focus:ring-1 focus:ring-blue-500 text-slate-700 capitalize"
            >
              <option value="all">All Statuses</option>
              {ACTIVE_INCIDENT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {formatStatusLabel(st)}
                </option>
              ))}
            </select>
          </div>

          {/* Priority Filter */}
          <div>
            <label htmlFor="queue-priority-filter" className="sr-only">
              Filter by priority
            </label>
            <select
              id="queue-priority-filter"
              value={priorityFilter}
              onChange={(e) => onPriorityFilterChange(e.target.value)}
              className="w-full px-1.5 py-1 text-[11px] bg-white border border-slate-300 rounded focus:outline-hidden focus:ring-1 focus:ring-blue-500 text-slate-700 capitalize"
            >
              <option value="all">All Priorities</option>
              {PRIORITY_OPTIONS.map((pr) => (
                <option key={pr.value} value={pr.value}>
                  {pr.label}
                </option>
              ))}
            </select>
          </div>

          {/* Service Filter */}
          <div>
            <label htmlFor="queue-service-filter" className="sr-only">
              Filter by service type
            </label>
            <select
              id="queue-service-filter"
              value={serviceFilter}
              onChange={(e) => onServiceFilterChange(e.target.value)}
              className="w-full px-1.5 py-1 text-[11px] bg-white border border-slate-300 rounded focus:outline-hidden focus:ring-1 focus:ring-blue-500 text-slate-700 capitalize"
            >
              <option value="all">All Services</option>
              {SERVICE_TYPE_OPTIONS.map((srv) => (
                <option key={srv.value} value={srv.value}>
                  {srv.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Queue Incident List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 focus:outline-hidden">
        {incidents.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            {totalActiveCount === 0 ? (
              <p>No active incidents.</p>
            ) : (
              <p>No incidents match the active filters.</p>
            )}
          </div>
        ) : (
          incidents.map((inc) => {
            const isSelected = selectedIncidentId === inc.id;
            const hasLocation = inc.latitude !== null && inc.longitude !== null;

            return (
              <div
                key={inc.id}
                role="button"
                tabIndex={0}
                aria-pressed={isSelected}
                aria-label={`Incident ${inc.reference_number}, ${inc.priority} priority, ${inc.service_type}`}
                onClick={() => onSelectIncident(inc.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectIncident(inc.id);
                  }
                }}
                className={`p-3 text-left transition-colors cursor-pointer select-none focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
                  isSelected
                    ? 'bg-blue-50/80 border-l-4 border-l-blue-600'
                    : 'hover:bg-slate-50 border-l-4 border-l-transparent'
                }`}
              >
                {/* Row Header: Ref, Priority, Elapsed */}
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="font-mono text-xs font-bold text-slate-900">
                    {inc.reference_number}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border uppercase tracking-wider ${getPriorityBadgeClass(
                        inc.priority
                      )}`}
                    >
                      {inc.priority}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {formatElapsed(inc.created_at)}
                    </span>
                  </div>
                </div>

                {/* Service and Status Badges */}
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200 capitalize">
                    {formatServiceLabel(inc.service_type)}
                  </span>
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border capitalize ${getStatusBadgeClass(
                      inc.status
                    )}`}
                  >
                    {formatStatusLabel(inc.status)}
                  </span>
                </div>

                {/* Address Summary */}
                <p className="text-xs text-slate-600 line-clamp-1 mb-1">
                  {inc.location_address || 'Address not recorded'}
                </p>

                {/* Location indicator & vehicle tag if present */}
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  {hasLocation ? (
                    <span className="inline-flex items-center text-[10px] text-emerald-700 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />
                      Mappable
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-[10px] text-amber-700 font-medium bg-amber-50 px-1 rounded border border-amber-200">
                      Missing location
                    </span>
                  )}

                  {inc.vehicle_registration && (
                    <span className="text-[10px] font-mono text-slate-500">
                      Reg: {inc.vehicle_registration}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
