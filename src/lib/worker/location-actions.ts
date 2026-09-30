'use server';

import { createClient } from '@/lib/supabase/server';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WorkerLocationPublishData {
  vehicle_id: string;
  latitude: number;
  longitude: number;
  location_updated_at: string;
}

export type WorkerLocationPublishResult =
  | {
      success: true;
      data: WorkerLocationPublishData;
    }
  | {
      success: false;
      error: {
        code: string;
        message: string;
      };
    };

/**
 * Maps database and RPC error messages to safe user-facing error objects.
 * Prevents raw Postgres internal errors from leaking to the client.
 */
function mapLocationRpcError(rawMessage: string): { code: string; message: string } {
  const lower = rawMessage.toLowerCase();

  if (lower.includes('authentication required')) {
    return {
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in to publish vehicle location.',
    };
  }

  if (lower.includes('unauthorized') || lower.includes('only workers')) {
    return {
      code: 'FORBIDDEN',
      message: 'Only active response workers can publish vehicle location.',
    };
  }

  if (lower.includes('no active vehicle assignment')) {
    return {
      code: 'NO_ACTIVE_VEHICLE',
      message: 'No active vehicle shift assignment was found for your account.',
    };
  }

  if (lower.includes('ambiguous active vehicle assignment')) {
    return {
      code: 'AMBIGUOUS_VEHICLE_BINDING',
      message: 'Multiple active vehicle bindings detected. Please contact dispatch.',
    };
  }

  if (lower.includes('assigned vehicle is deactivated') || lower.includes('assigned vehicle not found')) {
    return {
      code: 'VEHICLE_UNAVAILABLE',
      message: 'Assigned vehicle is unavailable or inactive.',
    };
  }

  if (lower.includes('coordinates out of valid range') || lower.includes('coordinates are required')) {
    return {
      code: 'INVALID_COORDINATES',
      message: 'Invalid GPS coordinates provided.',
    };
  }

  return {
    code: 'LOCATION_PUBLISH_FAILED',
    message: 'Failed to update vehicle location. Please try again.',
  };
}

/**
 * Server Action: Publishes the authenticated worker's current device GPS coordinates
 * to the vehicle they are actively assigned to.
 * The vehicle and organization identities are resolved strictly from authenticated session state.
 */
export async function publishWorkerLocation(
  latitude: number,
  longitude: number
): Promise<WorkerLocationPublishResult> {
  // Validate coordinates server-side
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return {
      success: false,
      error: {
        code: 'INVALID_COORDINATES',
        message: 'Coordinates must be valid finite numbers.',
      },
    };
  }

  if (latitude < -90.0 || latitude > 90.0 || longitude < -180.0 || longitude > 180.0) {
    return {
      success: false,
      error: {
        code: 'INVALID_COORDINATES',
        message: 'Coordinates out of bounds: latitude must be in [-90, 90], longitude in [-180, 180].',
      },
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('worker_publish_vehicle_location', {
      p_latitude: latitude,
      p_longitude: longitude,
    });

    if (error) {
      return {
        success: false,
        error: mapLocationRpcError(error.message || 'RPC invocation failed'),
      };
    }

    // Runtime response validation
    if (
      !data ||
      typeof data !== 'object' ||
      data.success !== true ||
      typeof data.vehicle_id !== 'string' ||
      !UUID_REGEX.test(data.vehicle_id) ||
      typeof data.latitude !== 'number' ||
      !Number.isFinite(data.latitude) ||
      data.latitude < -90.0 ||
      data.latitude > 90.0 ||
      typeof data.longitude !== 'number' ||
      !Number.isFinite(data.longitude) ||
      data.longitude < -180.0 ||
      data.longitude > 180.0 ||
      typeof data.location_updated_at !== 'string' ||
      !Number.isFinite(Date.parse(data.location_updated_at))
    ) {
      return {
        success: false,
        error: {
          code: 'MALFORMED_RPC_RESPONSE',
          message: 'Received unexpected response format from location publishing service.',
        },
      };
    }

    return {
      success: true,
      data: {
        vehicle_id: data.vehicle_id,
        latitude: data.latitude,
        longitude: data.longitude,
        location_updated_at: data.location_updated_at,
      },
    };
  } catch {
    return {
      success: false,
      error: {
        code: 'LOCATION_PUBLISH_UNAVAILABLE',
        message: 'An unexpected error occurred while communicating with the server.',
      },
    };
  }
}
