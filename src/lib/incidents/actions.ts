'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { IncidentStatus, ServiceType, IncidentPriority, LocationSource } from '@/types';

export interface IncidentActionResult {
  success: boolean;
  error?: string;
  incidentId?: string;
  referenceNumber?: string;
  previousStatus?: IncidentStatus;
  newStatus?: IncidentStatus;
}

/**
 * Server Action for creating a new roadside incident.
 * Enforces session authentication and operator/admin role authorization.
 */
export async function createIncidentAction(
  formData: FormData
): Promise<IncidentActionResult> {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    return { success: false, error: 'Unauthorized: active authenticated session required.' };
  }

  const role = authContext.profile.role;
  if (role !== 'admin' && role !== 'operator') {
    return { success: false, error: 'Access denied: incident creation is restricted to administrators and operators.' };
  }

  const customerName = formData.get('customer_name')?.toString().trim();
  const customerPhone = formData.get('customer_phone')?.toString().trim();
  const locationAddress = formData.get('location_address')?.toString().trim();
  const serviceType = (formData.get('service_type')?.toString().trim() || 'general_assistance') as ServiceType;
  const priority = (formData.get('priority')?.toString().trim() || 'standard') as IncidentPriority;
  const notes = formData.get('notes')?.toString().trim() || null;
  const requiredCapabilityId = formData.get('required_capability_id')?.toString().trim() || null;

  const latStr = formData.get('latitude')?.toString().trim();
  const lonStr = formData.get('longitude')?.toString().trim();
  const locationSource: LocationSource = 'operator_manual';

  const vehicleRegistration = formData.get('vehicle_registration')?.toString().trim() || null;
  const vehicleMake = formData.get('vehicle_make')?.toString().trim() || null;
  const vehicleModel = formData.get('vehicle_model')?.toString().trim() || null;
  const vehicleYearStr = formData.get('vehicle_year')?.toString().trim();
  const vehicleColor = formData.get('vehicle_color')?.toString().trim() || null;

  // Validation
  if (!customerName) {
    return { success: false, error: 'Customer name is required.' };
  }
  if (!customerPhone) {
    return { success: false, error: 'Customer phone number is required.' };
  }
  if (!locationAddress) {
    return { success: false, error: 'Location address is required.' };
  }

  let latitude: number | null = null;
  let longitude: number | null = null;

  if (latStr || lonStr) {
    if (!latStr || !lonStr) {
      return { success: false, error: 'Both latitude and longitude must be provided when entering coordinates.' };
    }

    latitude = Number(latStr);
    longitude = Number(lonStr);

    if (Number.isNaN(latitude) || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return { success: false, error: 'Latitude must be a valid number between -90 and 90 degrees.' };
    }

    if (Number.isNaN(longitude) || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return { success: false, error: 'Longitude must be a valid number between -180 and 180 degrees.' };
    }
  }

  const vehicleYear = vehicleYearStr ? Number.parseInt(vehicleYearStr, 10) : null;
  if (vehicleYear !== null && (Number.isNaN(vehicleYear) || vehicleYear < 1900 || vehicleYear > 2100)) {
    return { success: false, error: 'Please enter a valid vehicle year between 1900 and 2100.' };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('create_incident', {
      p_customer_name: customerName,
      p_customer_phone: customerPhone,
      p_location_address: locationAddress,
      p_service_type: serviceType,
      p_priority: priority,
      p_notes: notes,
      p_required_capability_id: requiredCapabilityId,
      p_latitude: latitude,
      p_longitude: longitude,
      p_location_accuracy: null,
      p_location_source: locationSource,
      p_vehicle_registration: vehicleRegistration,
      p_vehicle_make: vehicleMake,
      p_vehicle_model: vehicleModel,
      p_vehicle_year: vehicleYear,
      p_vehicle_color: vehicleColor,
    });

    if (error) {
      console.error('Error in create_incident RPC:', error);
      return { success: false, error: error.message || 'Failed to create incident.' };
    }

    const result = data as {
      success: boolean;
      incident_id: string;
      reference_number: string;
    };

    revalidatePath('/incidents');
    return {
      success: true,
      incidentId: result.incident_id,
      referenceNumber: result.reference_number,
    };
  } catch (err: unknown) {
    console.error('Incident creation exception:', err);
    return { success: false, error: 'An unexpected error occurred while creating the incident.' };
  }
}

/**
 * Server Action for executing a lifecycle transition on an incident.
 * Enforces session authentication, operator/admin role authorization, and state machine validation.
 */
export async function transitionIncidentAction(
  incidentId: string,
  newStatus: IncidentStatus,
  reason?: string
): Promise<IncidentActionResult> {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    return { success: false, error: 'Unauthorized: active authenticated session required.' };
  }

  const role = authContext.profile.role;
  if (role !== 'admin' && role !== 'operator') {
    return { success: false, error: 'Access denied: incident state transitions are restricted to administrators and operators.' };
  }

  if (!incidentId) {
    return { success: false, error: 'Incident ID is required.' };
  }

  if (!newStatus) {
    return { success: false, error: 'Target status is required.' };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('transition_incident_status', {
      p_incident_id: incidentId,
      p_new_status: newStatus,
      p_reason: reason?.trim() || null,
    });

    if (error) {
      console.error('Error in transition_incident_status RPC:', error);
      return { success: false, error: error.message || 'Failed to transition incident status.' };
    }

    const result = data as {
      success: boolean;
      incident_id: string;
      reference_number: string;
      previous_status: IncidentStatus;
      new_status: IncidentStatus;
      reason: string | null;
    };

    revalidatePath('/incidents');
    revalidatePath(`/incidents/${incidentId}`);

    return {
      success: true,
      incidentId: result.incident_id,
      referenceNumber: result.reference_number,
      previousStatus: result.previous_status,
      newStatus: result.new_status,
    };
  } catch (err: unknown) {
    console.error('State transition exception:', err);
    return { success: false, error: 'An unexpected error occurred during state transition.' };
  }
}
