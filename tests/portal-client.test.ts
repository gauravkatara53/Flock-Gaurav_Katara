import { describe, it, expect, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { CookieJar } from 'tough-cookie';
import { validateEnv, getSanitizedConfig } from '../src/config/env';
import { PortalClient } from '../src/clients/portal.client';
import { AppError } from '../src/types/portal.types';

describe('Environment Validation', () => {
  it('should validate a correct environment configuration', () => {
    const config = validateEnv({
      PORT: '4000',
      NODE_ENV: 'test',
      PORTAL_BASE_URL: 'https://urja-ops.flockenergy.tech',
      PORTAL_USERNAME: 'ops_user',
      PORTAL_PASSWORD: 'secretpassword',
      PORTAL_TIMEOUT_MS: '15000',
    });

    expect(config.PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('test');
    expect(config.PORTAL_BASE_URL).toBe('https://urja-ops.flockenergy.tech');
    expect(config.PORTAL_USERNAME).toBe('ops_user');
    expect(config.PORTAL_PASSWORD).toBe('secretpassword');
    expect(config.PORTAL_TIMEOUT_MS).toBe(15000);
  });

  it('should fail fast on invalid PORTAL_BASE_URL', () => {
    expect(() => {
      validateEnv({
        PORTAL_BASE_URL: 'invalid-url-string',
      });
    }).toThrow(/INVALID_CONFIGURATION.*PORTAL_BASE_URL/);
  });

  it('should fail fast on invalid PORT', () => {
    expect(() => {
      validateEnv({
        PORT: '999999',
      });
    }).toThrow(/INVALID_CONFIGURATION.*PORT/);
  });

  it('should sanitize credentials when logging configuration', () => {
    const config = validateEnv({
      PORT: '3000',
      PORTAL_USERNAME: 'admin@flockenergy.tech',
      PORTAL_PASSWORD: 'supersecretpassword',
      PORTAL_SESSION_TOKEN: 'token-xyz-12345',
    });

    const sanitized = getSanitizedConfig(config);
    expect(sanitized.PORTAL_PASSWORD).toBe('******');
    expect(sanitized.PORTAL_SESSION_TOKEN).toBe('******');
    expect(sanitized.PORTAL_USERNAME).toBe('adm***');
  });
});

describe('Portal HTTP Client', () => {
  let client: PortalClient;
  let jar: CookieJar;

  beforeEach(() => {
    jar = new CookieJar();
    client = new PortalClient({
      baseURL: 'https://urja-ops.flockenergy.tech',
      timeoutMs: 5000,
      cookieJar: jar,
    });
  });

  it('should initialize with configured base URL and cookie jar', () => {
    expect(client.getBaseURL()).toBe('https://urja-ops.flockenergy.tech');
    expect(client.getCookieJar()).toBe(jar);
  });

  describe('Cookie Persistence', () => {
    it('should set, retrieve and persist cookies in the shared cookie jar', async () => {
      await client.setCookie('__Secure-better-auth.session_token=test-token-value; Path=/; Domain=urja-ops.flockenergy.tech; Secure');

      const cookies = await client.getCookies();
      expect(cookies.length).toBeGreaterThan(0);

      const tokenValue = await client.getCookieValue('__Secure-better-auth.session_token');
      expect(tokenValue).toBe('test-token-value');
    });

    it('should clear stored cookies upon request', async () => {
      await client.setCookie('session_id=12345; Path=/; Domain=urja-ops.flockenergy.tech; Secure');
      let cookies = await client.getCookies();
      expect(cookies.length).toBe(1);

      await client.clearCookies();
      cookies = await client.getCookies();
      expect(cookies.length).toBe(0);
    });
  });

  describe('Error Normalization', () => {
    it('should normalize timeout error into PORTAL_TIMEOUT AppError', () => {
      const axiosError = new AxiosError('timeout of 5000ms exceeded', 'ECONNABORTED');
      const normalized = client.normalizeError(axiosError);

      expect(normalized).toBeInstanceOf(AppError);
      const appErr = normalized as AppError;
      expect(appErr.code).toBe('PORTAL_TIMEOUT');
      expect(appErr.statusCode).toBe(504);
    });

    it('should normalize connection refused into PORTAL_UNAVAILABLE AppError', () => {
      const axiosError = new AxiosError('connect ECONNREFUSED 127.0.0.1:443', 'ECONNREFUSED');
      const normalized = client.normalizeError(axiosError);

      expect(normalized).toBeInstanceOf(AppError);
      const appErr = normalized as AppError;
      expect(appErr.code).toBe('PORTAL_UNAVAILABLE');
      expect(appErr.statusCode).toBe(503);
    });

    it('should normalize 401 response into PORTAL_AUTH_FAILED AppError', () => {
      const headers = new AxiosHeaders();
      const axiosError = new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        data: { error: 'Unauthorized' },
        headers,
        config: { headers } as any,
      });

      const normalized = client.normalizeError(axiosError);
      expect(normalized).toBeInstanceOf(AppError);
      const appErr = normalized as AppError;
      expect(appErr.code).toBe('PORTAL_AUTH_FAILED');
      expect(appErr.statusCode).toBe(401);
    });

    it('should normalize 403 response into PORTAL_SESSION_EXPIRED AppError', () => {
      const headers = new AxiosHeaders();
      const axiosError = new AxiosError('Forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
        statusText: 'Forbidden',
        data: { error: 'Forbidden' },
        headers,
        config: { headers } as any,
      });

      const normalized = client.normalizeError(axiosError);
      expect(normalized).toBeInstanceOf(AppError);
      const appErr = normalized as AppError;
      expect(appErr.code).toBe('PORTAL_SESSION_EXPIRED');
      expect(appErr.statusCode).toBe(403);
    });

    it('should normalize 503 response into PORTAL_UNAVAILABLE AppError', () => {
      const headers = new AxiosHeaders();
      const axiosError = new AxiosError('Service Unavailable', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status: 503,
        statusText: 'Service Unavailable',
        data: {},
        headers,
        config: { headers } as any,
      });

      const normalized = client.normalizeError(axiosError);
      expect(normalized).toBeInstanceOf(AppError);
      const appErr = normalized as AppError;
      expect(appErr.code).toBe('PORTAL_UNAVAILABLE');
      expect(appErr.statusCode).toBe(503);
    });
  });
});
