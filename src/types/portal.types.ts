/**
 * Standard error codes supported across the service.
 */
export type ErrorCode =
  | 'PORTAL_AUTH_FAILED'
  | 'PORTAL_SESSION_EXPIRED'
  | 'PORTAL_TIMEOUT'
  | 'PORTAL_UNAVAILABLE'
  | 'INVALID_CONFIGURATION'
  | 'INTERNAL_SERVER_ERROR'
  | 'ROUTE_NOT_FOUND';

/**
 * Standard API Error interface.
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Health endpoint response structure.
 */
export interface HealthResponse {
  success: true;
  service: 'urja-meter-api';
  status: 'healthy';
}

/**
 * Portal status response structure.
 */
export interface PortalStatusResponse {
  success: true;
  portal: 'Urja Meter Ops';
  authenticated: boolean;
}

/**
 * Session verification result.
 */
export interface SessionValidationResult {
  authenticated: boolean;
  reason?: string;
}

/**
 * Better Auth session cookie names observed in the portal.
 */
export const BETTER_AUTH_COOKIE_NAME = '__Secure-better-auth.session_token';
export const BETTER_AUTH_DEV_COOKIE_NAME = 'better-auth.session_token';

/**
 * Verified portal endpoints from project investigation findings.
 */
export const PORTAL_ENDPOINTS = {
  METERS_SEARCH: '/portal/meters/search',
  METER_GEO: (meterId: string) => `/portal/meters/${meterId}/geo`,
  METER_ENERGY: (meterId: string) => `/portal/meters/${meterId}/energy`,
  TRANSFORMERS: '/portal/dts',
  BULK_EXPORT: '/portal/export',
  SIGNING_KEYS: '/portal/keys',
} as const;

/**
 * Custom application error class.
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
