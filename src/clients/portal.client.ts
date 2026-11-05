import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, isAxiosError } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar, Cookie } from 'tough-cookie';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { AppError } from '../types/portal.types';

export interface PortalClientOptions {
  baseURL?: string;
  timeoutMs?: number;
  cookieJar?: CookieJar;
}

/**
 * Reusable HTTP client for communicating with the Urja Meter Ops portal.
 * Handles base URL configuration, timeouts, JSON parsing, cookie persistence,
 * error normalization, and log sanitization.
 */
export class PortalClient {
  private readonly client: AxiosInstance;
  private readonly jar: CookieJar;
  private readonly baseURL: string;

  constructor(options: PortalClientOptions = {}) {
    this.baseURL = options.baseURL || env.PORTAL_BASE_URL;
    const timeout = options.timeoutMs ?? env.PORTAL_TIMEOUT_MS;
    this.jar = options.cookieJar || new CookieJar(undefined, { allowSpecialUseDomain: true, rejectPublicSuffixes: false });

    const instance = axios.create({
      baseURL: this.baseURL,
      timeout,
      jar: this.jar,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      // Avoid following redirects so 302 login responses are not masked
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 300,
    });

    this.client = wrapper(instance);
    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Strip sensitive headers before logging
    this.client.interceptors.request.use(
      (config) => {
        const safeHeaders: Record<string, unknown> = { ...config.headers };
        delete safeHeaders['cookie'];
        delete safeHeaders['Cookie'];
        delete safeHeaders['authorization'];
        delete safeHeaders['Authorization'];
        delete safeHeaders['x-signature'];

        logger.debug(`[PortalClient Request] ${config.method?.toUpperCase()} ${config.url}`, {
          baseURL: config.baseURL,
          headers: safeHeaders,
        });
        return config;
      },
      (error) => {
        logger.error('[PortalClient Request Setup Error]', { message: error.message });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(
          `[PortalClient Response] ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`
        );

        // If an API endpoint unexpectedly returns HTML (e.g. SvelteKit redirecting unauthenticated calls to login page)
        if (
          typeof response.data === 'string' &&
          (response.data.includes('<!DOCTYPE html>') || response.data.includes('<html')) &&
          response.config.url &&
          !response.config.url.endsWith('/') &&
          !response.config.url.endsWith('/portal')
        ) {
          throw new AppError(
            'PORTAL_AUTH_FAILED',
            `Urja Meter Ops portal returned HTML instead of JSON for ${response.config.url} (session missing or unauthenticated redirect)`,
            401
          );
        }

        return response;
      },
      (error) => {
        return Promise.reject(this.normalizeError(error));
      }
    );
  }

  public normalizeError(error: unknown): AppError | Error {
    if (error instanceof AppError) {
      return error;
    }

    if (isAxiosError(error)) {
      const url = error.config?.url || 'portal endpoint';
      const status = error.response?.status;

      if (error.code === 'ECONNABORTED' || error.message.toLowerCase().includes('timeout')) {
        return new AppError('PORTAL_TIMEOUT', `Urja Meter Ops portal request timed out for ${url}`, 504);
      }

      if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        (status !== undefined && [502, 503, 504].includes(status))
      ) {
        return new AppError(
          'PORTAL_UNAVAILABLE',
          `Urja Meter Ops portal is unavailable or unreachable (${error.code || status})`,
          503
        );
      }

      if (status === 401) {
        return new AppError('PORTAL_AUTH_FAILED', 'Authentication failed with Urja Meter Ops portal', 401);
      }

      if (status === 403) {
        return new AppError(
          'PORTAL_SESSION_EXPIRED',
          'Urja Meter Ops portal session has expired or is forbidden',
          403
        );
      }

      return new AppError(
        'INTERNAL_SERVER_ERROR',
        `Urja Meter Ops portal error (${status ?? 'UNKNOWN'}): ${error.message}`,
        status || 500
      );
    }

    if (error instanceof Error) {
      return error;
    }

    return new AppError('INTERNAL_SERVER_ERROR', 'Unknown portal client error occurred', 500);
  }

  public async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  public async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  public async request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.request<T>(config);
  }

  public getCookieJar(): CookieJar {
    return this.jar;
  }

  public getBaseURL(): string {
    return this.baseURL;
  }

  public getAxiosInstance(): AxiosInstance {
    return this.client;
  }

  public async setCookie(cookieString: string, currentUrl: string = this.baseURL): Promise<void> {
    await this.jar.setCookie(cookieString, currentUrl);
  }

  public async getCookies(currentUrl: string = this.baseURL): Promise<Cookie[]> {
    return this.jar.getCookies(currentUrl);
  }

  public async getCookieValue(cookieName: string, currentUrl: string = this.baseURL): Promise<string | undefined> {
    const cookies = await this.getCookies(currentUrl);
    const found = cookies.find((c) => c.key === cookieName);
    return found?.value;
  }

  public async clearCookies(): Promise<void> {
    await this.jar.removeAllCookies();
  }
}

export const portalClient = new PortalClient();

