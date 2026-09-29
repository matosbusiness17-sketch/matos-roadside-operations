/**
 * Matos Systems — Foundation Type Definitions
 * Phase 2: Database, Tenancy, Authentication & Roles
 * Phase 3: Spatial Extensions & Capability Architecture
 * Phase 4: Incident Management & Operational State Machine
 */

export type UserRole = 'admin' | 'operator' | 'worker';

export type WorkerAvailabilityStatus = 'off_duty' | 'available' | 'busy' | 'unavailable';

/**
 * Authoritative Phase 4 Incident Lifecycle Statuses (10 States)
 */
export type IncidentStatus =
  | 'new'
  | 'triaged'
  | 'ready_for_dispatch'
  | 'dispatched'
  | 'en_route'
  | 'on_scene'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'unable_to_complete';

export const ACTIVE_INCIDENT_STATUSES: IncidentStatus[] = [
  'new',
  'triaged',
  'ready_for_dispatch',
  'dispatched',
  'en_route',
  'on_scene',
  'in_progress',
];

export const TERMINAL_INCIDENT_STATUSES: IncidentStatus[] = [
  'completed',
  'cancelled',
  'unable_to_complete',
];

/**
 * Locked Phase 4 State Machine Transition Matrix
 */
export const VALID_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  new: ['triaged', 'cancelled'],
  triaged: ['ready_for_dispatch', 'cancelled'],
  ready_for_dispatch: ['dispatched', 'cancelled'],
  dispatched: ['en_route', 'cancelled'],
  en_route: ['on_scene', 'unable_to_complete', 'cancelled'],
  on_scene: ['in_progress', 'unable_to_complete', 'cancelled'],
  in_progress: ['completed', 'unable_to_complete'],
  completed: [],
  cancelled: [],
  unable_to_complete: [],
};

export type ServiceType =
  | 'towing'
  | 'jump_start'
  | 'lockout'
  | 'tire_change'
  | 'fuel_delivery'
  | 'winch_recovery'
  | 'general_assistance';

export type IncidentPriority = 'low' | 'standard' | 'high' | 'critical';

export type AssignmentStatus =
  | 'assigned'
  | 'accepted'
  | 'en_route'
  | 'on_scene'
  | 'completed'
  | 'cancelled';

/**
 * Application-Level Location Source Convention
 *
 * NOTE: The underlying PostgreSQL database column (incidents.location_source) is TEXT
 * without database-level enum, check constraint, or domain restrictions.
 * This TypeScript union represents the application-level intake convention for location origin.
 */
export type LocationSource =
  | 'operator_manual'
  | 'customer_link'
  | 'telephony_intake'
  | 'device_gps';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface ServiceCapability {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VehicleCapability {
  id: string;
  organization_id: string;
  vehicle_id: string;
  capability_id: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  capability?: ServiceCapability;
}

export interface NearbyVehicleResult {
  vehicle_id: string;
  callsign: string;
  registration_number: string | null;
  distance_meters: number;
  last_known_location: unknown | null;
  location_updated_at: string | null;
}

export interface Organization {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  organization_id: string;
  role: UserRole;
  display_name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  organization?: Organization;
}

export interface WorkerProfile {
  id: string;
  user_id: string;
  organization_id: string;
  availability_status: WorkerAvailabilityStatus;
  created_at: string;
  updated_at: string;
  profile?: Profile;
}

export interface Vehicle {
  id: string;
  organization_id: string;
  callsign: string;
  registration_number: string | null;
  is_active: boolean;
  last_known_location?: unknown | null;
  location_updated_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkerVehicleAssignment {
  id: string;
  organization_id: string;
  worker_id: string;
  vehicle_id: string;
  status: 'active' | 'released';
  assigned_at: string;
  released_at: string | null;
}

export interface Incident {
  id: string;
  organization_id: string;
  reference_number: string;
  status: IncidentStatus;
  customer_name: string;
  customer_phone: string;
  vehicle_info: string | null;
  location_address: string;
  service_type: ServiceType;
  priority: IncidentPriority;
  notes: string | null;
  created_by: string | null;
  location?: unknown | null;
  location_accuracy?: number | null;
  location_source?: LocationSource | null;
  vehicle_registration?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: number | null;
  vehicle_color?: string | null;
  required_capability_id?: string | null;
  required_capability?: ServiceCapability | null;
  creator?: Profile | null;
  created_at: string;
  updated_at: string;
}

export interface Assignment {
  id: string;
  organization_id: string;
  incident_id: string;
  worker_id: string;
  vehicle_id: string | null;
  status: AssignmentStatus;
  assigned_at: string;
  completed_at: string | null;
}

export interface OperationalEvent {
  id: string;
  organization_id: string;
  event_type: string;
  actor_id: string | null;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor?: Profile | null;
}

export interface NavigationItem {
  name: string;
  href: string;
  description: string;
  badge?: string;
  requiredRole?: UserRole[];
}

export interface RouteMeta {
  title: string;
  description: string;
  surface: 'operator' | 'worker' | 'customer' | 'auth' | 'system';
  phase: string;
}

export interface CreateIncidentInput {
  customer_name: string;
  customer_phone: string;
  location_address: string;
  service_type?: ServiceType;
  priority?: IncidentPriority;
  notes?: string;
  required_capability_id?: string;
  latitude?: number;
  longitude?: number;
  location_accuracy?: number;
  location_source?: LocationSource;
  vehicle_registration?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year?: number;
  vehicle_color?: string;
}

export interface TransitionIncidentResult {
  success: boolean;
  incident_id?: string;
  reference_number?: string;
  previous_status?: IncidentStatus;
  new_status?: IncidentStatus;
  reason?: string | null;
  event_id?: string;
  error?: string;
}
