/**
 * Matos Systems — Foundation Type Definitions
 * Phase 2: Database, Tenancy, Authentication & Roles
 */

export type UserRole = 'admin' | 'operator' | 'worker';

export type WorkerAvailabilityStatus = 'off_duty' | 'available' | 'busy' | 'unavailable';

export type IncidentStatus =
  | 'created'
  | 'triaged'
  | 'dispatched'
  | 'en_route'
  | 'on_scene'
  | 'completed'
  | 'cancelled';

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
