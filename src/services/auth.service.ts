import { PortalClient, portalClient } from '../clients/portal.client';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  AppError,
  BETTER_AUTH_COOKIE_NAME,
  BETTER_AUTH_DEV_COOKIE_NAME,
  PORTAL_ENDPOINTS,
  SessionValidationResult,
} from '../types/portal.types';

export interface IAuthService {
  isAuthenticated(): Promise<boolean>;
  validateSession(forceCheck?: boolean): Promise<SessionValidationResult>;
  setSessionToken(token: string): Promise<void>;
  getSessionToken(): Promise<string | null>;
  ensureAuthenticated(): Promise<void>;
  login(username?: string, password?: string): Promise<SessionValidationResult>;
  logout(): Promise<void>;
}

/**
 * Authentication Service for Urja Meter Ops portal.
 *
 * Architecture Note:
 * The portal uses SvelteKit with Better Auth session cookies (`__Secure-better-auth.session_token`).
 * As per the provided Phase 1 investigation findings, the internal credential login POST endpoint
 * and payload schema were not verified. In accordance with project instructions ("Do not invent a
 * login endpoint or request payload. If a specific login detail is unavailable, implement the remaining
 * architecture and isolate authentication behind a clearly documented interface"), this service:
 * 1. Manages Better Auth session cookies in the shared cookie jar.
 * 2. Pre-loads session tokens from configuration if provided (`PORTAL_SESSION_TOKEN`).
 * 3. Validates active sessions against verified portal endpoints (`/portal/meters/search?q=&page=1`).
 * 4. Caches session status to avoid redundant portal requests.
 * 5. Provides a clear pluggable contract (`login`) ready for Phase 2 when endpoint payload is provided.
 */
export class AuthService implements IAuthService {
  private readonly client: PortalClient;
  private cachedSessionStatus: { authenticated: boolean; timestamp: number } | null = null;
  private readonly cacheTtlMs: number = 30_000; // 30 seconds cache for session validation

  constructor(client: PortalClient = portalClient) {
    this.client = client;
    this.initializeFromEnv();
  }

  /**
   * Initializes session token from environment configuration if present.
   */
  private initializeFromEnv(): void {
    if (env.PORTAL_SESSION_TOKEN) {
      this.setSessionToken(env.PORTAL_SESSION_TOKEN).catch((err) => {
        logger.error('Failed to initialize session token from environment', { message: err.message });
      });
    }
  }

  /**
   * Sets the Better Auth session token cookie in the client cookie jar.
   */
  public async setSessionToken(token: string): Promise<void> {
    if (!token || !token.trim()) {
      throw new AppError('PORTAL_AUTH_FAILED', 'Session token cannot be empty', 400);
    }

    const trimmed = token.trim();
    const isHttps = this.client.getBaseURL().startsWith('https://');
    const cookieName = isHttps ? BETTER_AUTH_COOKIE_NAME : BETTER_AUTH_DEV_COOKIE_NAME;
    const cookieDomain = new URL(this.client.getBaseURL()).hostname;

    // Build standard cookie string
    const cookieString = `${cookieName}=${trimmed}; Path=/; Domain=${cookieDomain}; HttpOnly${isHttps ? '; Secure' : ''}`;
    await this.client.setCookie(cookieString, this.client.getBaseURL());

    // Reset session cache on token update
    this.cachedSessionStatus = null;
    logger.info('Portal session cookie updated in cookie jar');
  }

  /**
   * Retrieves the current session token from the cookie jar.
   */
  public async getSessionToken(): Promise<string | null> {
    const secureToken = await this.client.getCookieValue(BETTER_AUTH_COOKIE_NAME);
    if (secureToken) return secureToken;

    const devToken = await this.client.getCookieValue(BETTER_AUTH_DEV_COOKIE_NAME);
    return devToken || null;
  }

  /**
   * Checks whether the client currently holds an active session token.
   */
  public async hasSessionCookie(): Promise<boolean> {
    const token = await this.getSessionToken();
    return Boolean(token && token.length > 0);
  }

  /**
   * Validates the active portal session by testing connectivity against a verified portal endpoint.
   * Leverages caching to avoid repeated roundtrips.
   */
  public async validateSession(forceCheck: boolean = false): Promise<SessionValidationResult> {
    const now = Date.now();

    // Check cache if not forcing check
    if (!forceCheck && this.cachedSessionStatus && now - this.cachedSessionStatus.timestamp < this.cacheTtlMs) {
      return { authenticated: this.cachedSessionStatus.authenticated };
    }

    // Check if session cookie exists
    const hasCookie = await this.hasSessionCookie();
    if (!hasCookie) {
      this.cachedSessionStatus = { authenticated: false, timestamp: now };
      return {
        authenticated: false,
        reason: 'No Better Auth session token present in cookie jar',
      };
    }

    try {
      // Validate session against verified portal search endpoint
      const response = await this.client.get(`${PORTAL_ENDPOINTS.METERS_SEARCH}?q=&page=1`);

      if (response.status === 200) {
        this.cachedSessionStatus = { authenticated: true, timestamp: now };
        return { authenticated: true };
      }

      this.cachedSessionStatus = { authenticated: false, timestamp: now };
      return {
        authenticated: false,
        reason: `Portal responded with unexpected status ${response.status}`,
      };
    } catch (error) {
      this.cachedSessionStatus = { authenticated: false, timestamp: now };

      if (error instanceof AppError) {
        if (error.code === 'PORTAL_AUTH_FAILED' || error.code === 'PORTAL_SESSION_EXPIRED') {
          return { authenticated: false, reason: error.message };
        }
        // Network or timeout errors bubble up
        throw error;
      }

      throw error;
    }
  }

  /**
   * Quick boolean check of authentication status.
   */
  public async isAuthenticated(): Promise<boolean> {
    try {
      const result = await this.validateSession();
      return result.authenticated;
    } catch {
      return false;
    }
  }

  /**
   * Ensures that the client is authenticated, throwing AppError if not.
   */
  public async ensureAuthenticated(): Promise<void> {
    const result = await this.validateSession();
    if (!result.authenticated) {
      throw new AppError(
        'PORTAL_SESSION_EXPIRED',
        result.reason || 'Urja Meter Ops portal session is invalid or expired',
        401
      );
    }
  }

  /**
   * Login implementation interface.
   *
   * As specified in the Phase 1 instructions, the login endpoint and request schema
   * were not verified during initial investigation and must not be guessed.
   * This interface isolates authentication so that once the login contract is finalized,
   * it can be implemented without refactoring other layers.
   */
  public async login(username?: string, password?: string): Promise<SessionValidationResult> {
    const effectiveUsername = username || env.PORTAL_USERNAME;
    const effectivePassword = password || env.PORTAL_PASSWORD;

    if (!effectiveUsername || !effectivePassword) {
      throw new AppError(
        'PORTAL_AUTH_FAILED',
        'Authentication credentials missing. Provide username and password.',
        400
      );
    }

    // Since the login endpoint payload is intentionally not guessed per Phase 1 instructions:
    throw new AppError(
      'PORTAL_AUTH_FAILED',
      'Direct credentials login endpoint is not verified in Phase 1 discovery findings. Use PORTAL_SESSION_TOKEN or verify the Better Auth sign-in route.',
      501
    );
  }

  /**
   * Clears the active session and cookies.
   */
  public async logout(): Promise<void> {
    await this.client.clearCookies();
    this.cachedSessionStatus = null;
    logger.info('Portal session cleared');
  }
}

// Export singleton instance
export const authService = new AuthService(portalClient);
