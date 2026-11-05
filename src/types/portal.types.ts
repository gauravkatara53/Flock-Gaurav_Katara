export type ErrorCode =
  | 'PORTAL_AUTH_FAILED'
  | 'PORTAL_SESSION_EXPIRED'
  | 'PORTAL_TIMEOUT'
  | 'PORTAL_UNAVAILABLE'
  | 'INVALID_CONFIGURATION'
  | 'INTERNAL_SERVER_ERROR'
  | 'ROUTE_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND';

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface HealthResponse {
  success: true;
  service: 'urja-meter-api';
  status: 'healthy';
}

export interface PortalStatusResponse {
  success: true;
  portal: 'Urja Meter Ops';
  sessionConfigured: boolean;
  authenticated: boolean;
  portalReachable: boolean;
}

export interface SessionValidationResult {
  authenticated: boolean;
  sessionConfigured: boolean;
  portalReachable: boolean;
  reason?: string;
}

export const BETTER_AUTH_COOKIE_NAME = '__Secure-better-auth.session_token';
export const BETTER_AUTH_DEV_COOKIE_NAME = 'better-auth.session_token';

// Upstream Urja Ops portal endpoints
export const PORTAL_ENDPOINTS = {
  METERS_SEARCH: '/portal/meters/search',
  METER_GEO: (meterId: string) => `/portal/meters/${meterId}/geo`,
  METER_ENERGY: (meterId: string) => `/portal/meters/${meterId}/energy`,
  TRANSFORMERS: '/portal/dts',
  BULK_EXPORT: '/portal/export',
  SIGNING_KEYS: '/portal/keys',
} as const;

/**
 * Adapter interface for authentication strategies.
 */
export interface ILoginAdapter {
  readonly name: string;
  login(
    credentials: { username?: string; password?: string },
    client: unknown
  ): Promise<string | void>;
  isConfigured(): boolean;
  getMissingDetails(): string;
}

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
