import {
  IncidentPriority,
  IncidentStatus,
  LocationSource,
  ServiceType,
  WorkerAvailabilityStatus,
} from '@/types';

export const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  triaged: 'Triaged',
  ready_for_dispatch: 'Ready for Dispatch',
  dispatched: 'Dispatched',
  en_route: 'En Route',
  on_scene: 'On Scene',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  unable_to_complete: 'Unable to Complete',
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  standard: 'Standard',
  high: 'High',
  critical: 'Critical',
};

export const SERVICE_TYPE_LABELS: Record<string, string> = {
  towing: 'Towing',
  jump_start: 'Jump Start',
  lockout: 'Lockout',
  tire_change: 'Tire Change',
  fuel_delivery: 'Fuel Delivery',
  winch_recovery: 'Winch Recovery',
  general_assistance: 'General Assistance',
};

export const LOCATION_SOURCE_LABELS: Record<string, string> = {
  operator_manual: 'Operator Manual',
  customer_link: 'Customer Link',
  telephony_intake: 'Telephony Intake',
  device_gps: 'Device GPS',
};

export const AVAILABILITY_LABELS: Record<string, string> = {
  off_duty: 'Off Duty',
  available: 'Available',
  busy: 'Busy',
  unavailable: 'Unavailable',
};

/**
 * Humanize internal incident status code for user-facing display.
 */
export function formatIncidentStatus(status: IncidentStatus | string): string {
  if (!status) return '—';
  return (
    STATUS_LABELS[status] ||
    status
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Humanize internal incident priority code for user-facing display.
 */
export function formatPriority(priority: IncidentPriority | string): string {
  if (!priority) return '—';
  return (
    PRIORITY_LABELS[priority] ||
    priority
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Humanize internal service type code for user-facing display.
 */
export function formatServiceType(serviceType: ServiceType | string): string {
  if (!serviceType) return '—';
  return (
    SERVICE_TYPE_LABELS[serviceType] ||
    serviceType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Humanize internal location intake source for user-facing display.
 */
export function formatLocationSource(
  source: LocationSource | string | null | undefined
): string {
  if (!source || source === 'Not recorded') return 'Not recorded';
  return (
    LOCATION_SOURCE_LABELS[source] ||
    source
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Humanize worker availability status code for user-facing display.
 */
export function formatAvailability(
  availability: WorkerAvailabilityStatus | string | null | undefined
): string {
  if (!availability) return 'Not recorded';
  return (
    AVAILABILITY_LABELS[availability] ||
    availability
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Format ISO datetime string truthfully without timezone distortion.
 */
export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}
