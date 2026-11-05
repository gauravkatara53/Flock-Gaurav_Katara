import { PortalClient, portalClient } from '../clients/portal.client';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import {
  AppError,
  BETTER_AUTH_COOKIE_NAME,
  BETTER_AUTH_DEV_COOKIE_NAME,
  ILoginAdapter,
  PORTAL_ENDPOINTS,
  SessionValidationResult,
} from '../types/portal.types';

export interface IAuthService {
  isAuthenticated(): Promise<boolean>;
  validateSession(forceCheck?: boolean): Promise<SessionValidationResult>;
  setSessionToken(token: string): Promise<void>;
  getSessionToken(): Promise<string | null>;
  hasSessionCookie(): Promise<boolean>;
  ensureAuthenticated(): Promise<void>;
  login(username?: string, password?: string): Promise<SessionValidationResult>;
  reauthenticate(): Promise<SessionValidationResult>;
  clearInvalidSession(): Promise<void>;
  logout(): Promise<void>;
  setLoginAdapter(adapter: ILoginAdapter): void;
}

class DefaultLoginAdapter implements ILoginAdapter {
  readonly name = 'DefaultBetterAuthAdapter';

  async login(
    credentials: { username?: string; password?: string },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _client: unknown
  ): Promise<string | void> {
    if (!credentials.username || !credentials.password) {
      throw new AppError(
        'PORTAL_AUTH_FAILED',
        'Authentication credentials missing. Provide username and password.',
        400
      );
    }

    throw new AppError('PORTAL_AUTH_FAILED', this.getMissingDetails(), 501);
  }

  isConfigured(): boolean {
    return false;
  }

  getMissingDetails(): string {
    return 'Portal username/password login endpoint (e.g. Better Auth /api/auth/sign-in/email vs form POST) and request payload schema were not verified during discovery. Please supply PORTAL_SESSION_TOKEN or configure a verified ILoginAdapter.';
  }
}

export class AuthService implements IAuthService {
  private readonly client: PortalClient;
  private cachedSessionStatus: { authenticated: boolean; timestamp: number } | null = null;
  private readonly cacheTtlMs: number = 30_000;
  private inFlightValidationPromise: Promise<SessionValidationResult> | null = null;
  private isReauthenticating: boolean = false;
  private sessionExplicitlyInvalidated: boolean = false;
  private loginAdapter: ILoginAdapter = new DefaultLoginAdapter();

  constructor(client: PortalClient = portalClient) {
    this.client = client;
    this.initializeFromEnv();
  }

  public setLoginAdapter(adapter: ILoginAdapter): void {
    this.loginAdapter = adapter;
    logger.info(`Login adapter updated to: ${adapter.name}`);
  }

  private initializeFromEnv(): void {
    if (env.PORTAL_SESSION_TOKEN) {
      this.setSessionToken(env.PORTAL_SESSION_TOKEN).catch((err) => {
        logger.error('Failed to initialize session token from environment', { message: err.message });
      });
    }
  }

  public async setSessionToken(token: string): Promise<void> {
    if (!token || !token.trim()) {
      throw new AppError('PORTAL_AUTH_FAILED', 'Session token cannot be empty', 400);
    }

    const trimmed = token.trim();
    const isHttps = this.client.getBaseURL().startsWith('https://');
    const hostname = new URL(this.client.getBaseURL()).hostname;
    const isIpOrLocalhost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      /^(\d+\.){3}\d+$/.test(hostname);
    const domainAttr = isIpOrLocalhost ? '' : `; Domain=${hostname}`;

    // Set both __Secure-prefixed and standard Better Auth cookie names to support TLS offloading/reverse proxies
    const secureCookie = `${BETTER_AUTH_COOKIE_NAME}=${trimmed}; Path=/${domainAttr}; HttpOnly${isHttps ? '; Secure' : ''}`;
    const devCookie = `${BETTER_AUTH_DEV_COOKIE_NAME}=${trimmed}; Path=/${domainAttr}; HttpOnly${isHttps ? '; Secure' : ''}`;

    await this.client.setCookie(secureCookie, this.client.getBaseURL());
    await this.client.setCookie(devCookie, this.client.getBaseURL());

    this.cachedSessionStatus = null;
    this.sessionExplicitlyInvalidated = false;
    logger.info('Portal session cookie updated in cookie jar');
  }

  public async getSessionToken(): Promise<string | null> {
    const secureToken = await this.client.getCookieValue(BETTER_AUTH_COOKIE_NAME);
    if (secureToken) return secureToken;

    const devToken = await this.client.getCookieValue(BETTER_AUTH_DEV_COOKIE_NAME);
    return devToken || null;
  }

  public async hasSessionCookie(): Promise<boolean> {
    const token = await this.getSessionToken();
    return Boolean(token && token.length > 0);
  }

  /**
   * Validates portal session connectivity. Reuses cached status within cacheTtlMs
   * and deduplicates concurrent in-flight requests.
   */
  public async validateSession(forceCheck: boolean = false): Promise<SessionValidationResult> {
    const now = Date.now();

    if (!forceCheck && this.cachedSessionStatus && now - this.cachedSessionStatus.timestamp < this.cacheTtlMs) {
      const hasCookie = await this.hasSessionCookie();
      return {
        authenticated: this.cachedSessionStatus.authenticated,
        sessionConfigured: hasCookie,
        portalReachable: true,
      };
    }

    if (this.inFlightValidationPromise) {
      return this.inFlightValidationPromise;
    }

    this.inFlightValidationPromise = this.performValidation(now);

    try {
      return await this.inFlightValidationPromise;
    } finally {
      this.inFlightValidationPromise = null;
    }
  }

  private async performValidation(now: number): Promise<SessionValidationResult> {
    const hasCookie = await this.hasSessionCookie();

    if (!hasCookie) {
      this.cachedSessionStatus = { authenticated: false, timestamp: now };
      return {
        authenticated: false,
        sessionConfigured: false,
        portalReachable: true,
        reason: 'No Better Auth session token present in cookie jar',
      };
    }

    try {
      const response = await this.client.get(`${PORTAL_ENDPOINTS.METERS_SEARCH}?q=&page=1`);

      if (response.status === 200) {
        this.cachedSessionStatus = { authenticated: true, timestamp: now };
        return {
          authenticated: true,
          sessionConfigured: true,
          portalReachable: true,
        };
      }

      await this.clearInvalidSession();
      return {
        authenticated: false,
        sessionConfigured: false,
        portalReachable: true,
        reason: `Portal returned unexpected status ${response.status}`,
      };
    } catch (error) {
      if (error instanceof AppError) {
        if (error.code === 'PORTAL_AUTH_FAILED' || error.code === 'PORTAL_SESSION_EXPIRED') {
          await this.clearInvalidSession();
          return {
            authenticated: false,
            sessionConfigured: false,
            portalReachable: true,
            reason: error.message,
          };
        }

        if (error.code === 'PORTAL_UNAVAILABLE' || error.code === 'PORTAL_TIMEOUT') {
          return {
            authenticated: false,
            sessionConfigured: hasCookie,
            portalReachable: false,
            reason: error.message,
          };
        }

        throw error;
      }

      throw error;
    }
  }

  public async isAuthenticated(): Promise<boolean> {
    try {
      const result = await this.validateSession();
      return result.authenticated;
    } catch {
      return false;
    }
  }

  /**
   * Attempts a single re-authentication cycle. Guard flag prevents infinite loops.
   */
  public async reauthenticate(): Promise<SessionValidationResult> {
    if (this.isReauthenticating) {
      throw new AppError(
        'PORTAL_SESSION_EXPIRED',
        'Re-authentication already in progress. Aborting to avoid infinite loop.',
        401
      );
    }

    this.isReauthenticating = true;
    try {
      logger.warn('Attempting single re-authentication cycle...');
      await this.clearInvalidSession();

      if (this.loginAdapter.isConfigured()) {
        const res = await this.login(env.PORTAL_USERNAME, env.PORTAL_PASSWORD);
        if (res.authenticated) {
          logger.info('Re-authentication succeeded');
          return res;
        }
      }

      return {
        authenticated: false,
        sessionConfigured: false,
        portalReachable: true,
        reason: 'Session expired and automatic re-authentication could not be completed',
      };
    } finally {
      this.isReauthenticating = false;
    }
  }

  public async ensureAuthenticated(): Promise<void> {
    const result = await this.validateSession();
    if (result.authenticated) {
      return;
    }

    if (this.loginAdapter.isConfigured() && !this.isReauthenticating) {
      const reauthResult = await this.reauthenticate();
      if (reauthResult.authenticated) {
        return;
      }
    }

    throw new AppError(
      'PORTAL_SESSION_EXPIRED',
      result.reason || 'Urja Meter Ops portal session is invalid or expired',
      401
    );
  }

  public async login(username?: string, password?: string): Promise<SessionValidationResult> {
    const effectiveUsername = username !== undefined ? username : env.PORTAL_USERNAME;
    const effectivePassword = password !== undefined ? password : env.PORTAL_PASSWORD;

    const token = await this.loginAdapter.login(
      { username: effectiveUsername, password: effectivePassword },
      this.client
    );

    if (token) {
      await this.setSessionToken(token);
    }

    return this.validateSession(true);
  }

  public async clearInvalidSession(): Promise<void> {
    await this.client.clearCookies();
    this.cachedSessionStatus = null;
    logger.info('Invalidated session state and cleared cookies');
  }

  public async logout(): Promise<void> {
    await this.clearInvalidSession();
    logger.info('Portal session logged out');
  }
}

export const authService = new AuthService(portalClient);
