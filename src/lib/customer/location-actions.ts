'use server';

import { createClient } from '@/lib/supabase/server';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_HEX_REGEX = /^[0-9a-f]{64}$/i;

export type CustomerLocationRequestStatus = 'valid' | 'expired' | 'used' | 'revoked' | 'invalid';

export interface CreateCustomerLocationRequestResult {
  success: boolean;
  token?: string;
  expiresAt?: string;
  relativePath?: string;
  error?: {
    code?: string;
    message: string;
  };
}

export interface GetCustomerLocationStatusResult {
  success: boolean;
  status: CustomerLocationRequestStatus;
  expiresAt?: string;
  error?: {
    code?: string;
    message: string;
  };
}

export interface SubmitCustomerLocationResult {
  success: boolean;
  data?: {
    confirmed_at: string;
  };
  error?: {
    code?: string;
    message: string;
  };
}

/**
 * Maps raw database error messages to safe user-facing error objects.
 */
function mapCustomerRpcError(rawMessage: string): { code: string; message: string } {
  const lower = rawMessage.toLowerCase();

  if (lower.includes('authentication required')) {
    return {
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in as an operator.',
    };
  }

  if (lower.includes('unauthorized') || lower.includes('only admins and operators')) {
    return {
      code: 'FORBIDDEN',
      message: 'Only dispatch operators and administrators can generate location links.',
    };
  }

  if (lower.includes('incident not found')) {
    return {
      code: 'INCIDENT_NOT_FOUND',
      message: 'The requested incident was not found in your organization.',
    };
  }

  if (lower.includes('terminal incident')) {
    return {
      code: 'INCIDENT_TERMINAL',
      message: 'Location links cannot be generated for completed or cancelled incidents.',
    };
  }

  if (lower.includes('already been used')) {
    return {
      code: 'TOKEN_ALREADY_USED',
      message: 'This location request link has already been used.',
    };
  }

  if (lower.includes('expired')) {
    return {
      code: 'TOKEN_EXPIRED',
      message: 'This location request link has expired.',
    };
  }

  if (lower.includes('revoked')) {
    return {
      code: 'TOKEN_REVOKED',
      message: 'This location request link was revoked by a newer request.',
    };
  }

  if (lower.includes('invalid') || lower.includes('not found')) {
    return {
      code: 'TOKEN_INVALID',
      message: 'This location request link is invalid or no longer active.',
    };
  }

  return {
    code: 'OPERATION_FAILED',
    message: 'An unexpected error occurred while processing the location request.',
  };
}

/**
 * Operator action to generate a fresh single-use customer location verification link.
 * Revokes previous active unused tokens for the target incident.
 */
export async function createCustomerLocationRequest(
  incidentId: string
): Promise<CreateCustomerLocationRequestResult> {
  if (!incidentId || !UUID_REGEX.test(incidentId.trim())) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'A valid incident ID is required.',
      },
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('create_customer_location_request', {
      p_incident_id: incidentId.trim(),
    });

    if (error) {
      return {
        success: false,
        error: mapCustomerRpcError(error.message),
      };
    }

    if (!data || typeof data !== 'object') {
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Malformed response returned from database RPC.',
        },
      };
    }

    const payload = data as {
      success?: unknown;
      token?: unknown;
      expires_at?: unknown;
      relative_path?: unknown;
    };

    if (
      payload.success !== true ||
      typeof payload.token !== 'string' ||
      payload.token.trim().length === 0 ||
      typeof payload.expires_at !== 'string' ||
      payload.expires_at.trim().length === 0 ||
      Number.isNaN(new Date(payload.expires_at).getTime())
    ) {
      return {
        success: false,
        error: {
          code: 'INCOMPLETE_RESPONSE',
          message: 'Location token response was missing required attributes.',
        },
      };
    }

    return {
      success: true,
      token: (payload.token as string).trim(),
      expiresAt: (payload.expires_at as string).trim(),
      relativePath: typeof payload.relative_path === 'string' ? payload.relative_path : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: mapCustomerRpcError(message),
    };
  }
}

/**
 * Public action to check whether a customer location token is valid, used, expired, or revoked.
 * Leaks zero customer, vehicle, or incident operational data.
 */
export async function getCustomerLocationRequestStatus(
  token: string
): Promise<GetCustomerLocationStatusResult> {
  const cleanToken = token ? token.trim() : '';

  if (!cleanToken || !TOKEN_HEX_REGEX.test(cleanToken)) {
    return {
      success: true,
      status: 'invalid',
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('get_customer_location_request_status', {
      p_token: cleanToken,
    });

    if (error) {
      return {
        success: false,
        status: 'invalid',
        error: mapCustomerRpcError(error.message),
      };
    }

    if (!data || typeof data !== 'object') {
      return {
        success: true,
        status: 'invalid',
      };
    }

    const payload = data as {
      success?: boolean;
      status?: CustomerLocationRequestStatus;
      expires_at?: string;
    };

    const status = payload.status || 'invalid';

    return {
      success: true,
      status,
      expiresAt: payload.expires_at,
    };
  } catch {
    return {
      success: false,
      status: 'invalid',
      error: {
        code: 'NETWORK_ERROR',
        message: 'Failed to verify location link status. Please check your connection.',
      },
    };
  }
}

/**
 * Public action for customer to submit device GPS coordinates.
 * Authoritatively sets PostGIS location on the incident and marks token consumed.
 * Never fabricates timestamps or exposes internal incident IDs.
 */
export async function submitCustomerLocation(
  token: string,
  latitude: number,
  longitude: number,
  accuracy: number
): Promise<SubmitCustomerLocationResult> {
  const cleanToken = token ? token.trim() : '';

  // 1. Format validation
  if (!cleanToken || !TOKEN_HEX_REGEX.test(cleanToken)) {
    return {
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or malformed location link token.',
      },
    };
  }

  // 2. Coordinate validation
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude)
  ) {
    return {
      success: false,
      error: {
        code: 'INVALID_COORDINATES',
        message: 'Latitude and longitude coordinates must be valid numbers.',
      },
    };
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return {
      success: false,
      error: {
        code: 'COORDINATES_OUT_OF_RANGE',
        message: 'Coordinates are outside valid geographical bounds.',
      },
    };
  }

  if (
    typeof accuracy !== 'number' ||
    !Number.isFinite(accuracy) ||
    accuracy < 0
  ) {
    return {
      success: false,
      error: {
        code: 'INVALID_ACCURACY',
        message: 'Accuracy must be a valid non-negative number.',
      },
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('submit_customer_location', {
      p_token: cleanToken,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy: accuracy,
    });

    if (error) {
      return {
        success: false,
        error: mapCustomerRpcError(error.message),
      };
    }

    if (!data || typeof data !== 'object') {
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Malformed confirmation returned from location submission.',
        },
      };
    }

    const payload = data as {
      success?: unknown;
      confirmed_at?: unknown;
    };

    const isConfirmedAtValidDate =
      typeof payload.confirmed_at === 'string' &&
      payload.confirmed_at.trim().length > 0 &&
      !Number.isNaN(new Date(payload.confirmed_at).getTime());

    if (payload.success !== true || !isConfirmedAtValidDate) {
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Malformed confirmation returned from location submission.',
        },
      };
    }

    return {
      success: true,
      data: {
        confirmed_at: (payload.confirmed_at as string).trim(),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: mapCustomerRpcError(message),
    };
  }
}
