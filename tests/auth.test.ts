import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { authService, AuthService } from '../src/services/auth.service';
import { portalClient, PortalClient } from '../src/clients/portal.client';
import { AppError } from '../src/types/portal.types';

describe('Auth Service & Portal Status API', () => {
  beforeEach(async () => {
    await portalClient.clearCookies();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await portalClient.clearCookies();
    vi.restoreAllMocks();
  });

  describe('Session Token Management', () => {
    it('should set and get the Better Auth session token in cookie jar', async () => {
      await authService.setSessionToken('mock-session-token-xyz');
      const token = await authService.getSessionToken();
      expect(token).toBe('mock-session-token-xyz');
    });

    it('should reject empty session token', async () => {
      await expect(authService.setSessionToken('')).rejects.toThrow(
        /Session token cannot be empty/
      );
    });

    it('should clear session upon logout', async () => {
      await authService.setSessionToken('token-to-clear');
      expect(await authService.getSessionToken()).toBe('token-to-clear');

      await authService.logout();
      expect(await authService.getSessionToken()).toBeNull();
    });
  });

  describe('Session Validation & Caching', () => {
    it('should return unauthenticated if no session cookie exists', async () => {
      const result = await authService.validateSession(true);
      expect(result.authenticated).toBe(false);
      expect(result.reason).toContain('No Better Auth session token');
    });

    it('should return authenticated when portal returns 200 for search endpoint', async () => {
      await authService.setSessionToken('valid-token-123');

      const getSpy = vi.spyOn(portalClient, 'get').mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        data: { meters: [], total: 403 },
        headers: {},
        config: {} as any,
      });

      const result = await authService.validateSession(true);
      expect(result.authenticated).toBe(true);
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('should use cache on subsequent validation calls within TTL', async () => {
      await authService.setSessionToken('valid-token-123');

      const getSpy = vi.spyOn(portalClient, 'get').mockResolvedValue({
        status: 200,
        statusText: 'OK',
        data: { meters: [] },
        headers: {},
        config: {} as any,
      });

      // First call -> hits portal
      const res1 = await authService.validateSession(true);
      expect(res1.authenticated).toBe(true);
      expect(getSpy).toHaveBeenCalledTimes(1);

      // Second call (not forced) -> uses cache
      const res2 = await authService.validateSession(false);
      expect(res2.authenticated).toBe(true);
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('should detect expired session when portal returns 401 or 403', async () => {
      await authService.setSessionToken('expired-token');

      vi.spyOn(portalClient, 'get').mockRejectedValueOnce(
        new AppError('PORTAL_SESSION_EXPIRED', 'Session has expired', 403)
      );

      const result = await authService.validateSession(true);
      expect(result.authenticated).toBe(false);
      expect(result.reason).toContain('Session has expired');
    });
  });

  describe('Direct Login Contract', () => {
    it('should reject missing credentials', async () => {
      await expect(authService.login('', '')).rejects.toThrow(
        /Authentication credentials missing/
      );
    });

    it('should throw documented AppError (501) indicating login payload isolation per Phase 1 spec', async () => {
      await expect(authService.login('user', 'pass')).rejects.toThrow(
        /Direct credentials login endpoint is not verified in Phase 1 discovery findings/
      );
    });
  });

  describe('GET /api/v1/portal/status endpoint', () => {
    it('should return authenticated: true when portal session is active', async () => {
      await authService.setSessionToken('active-token-abc');

      vi.spyOn(portalClient, 'get').mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        data: { ok: true },
        headers: {},
        config: {} as any,
      });

      const response = await request(app)
        .get('/api/v1/portal/status?force=true')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        portal: 'Urja Meter Ops',
        authenticated: true,
      });
    });

    it('should return authenticated: false when session is missing or expired', async () => {
      const response = await request(app)
        .get('/api/v1/portal/status?force=true')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        portal: 'Urja Meter Ops',
        authenticated: false,
      });
    });

    it('should return 504 PORTAL_TIMEOUT when portal times out', async () => {
      await authService.setSessionToken('token-timeout');

      vi.spyOn(portalClient, 'get').mockRejectedValueOnce(
        new AppError('PORTAL_TIMEOUT', 'Urja Meter Ops portal request timed out', 504)
      );

      const response = await request(app)
        .get('/api/v1/portal/status?force=true')
        .expect('Content-Type', /json/)
        .expect(504);

      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'PORTAL_TIMEOUT',
          message: 'Urja Meter Ops portal request timed out',
        },
      });
    });

    it('should return 503 PORTAL_UNAVAILABLE when portal is down or unreachable', async () => {
      await authService.setSessionToken('token-down');

      vi.spyOn(portalClient, 'get').mockRejectedValueOnce(
        new AppError('PORTAL_UNAVAILABLE', 'Urja Meter Ops portal is unavailable or unreachable', 503)
      );

      const response = await request(app)
        .get('/api/v1/portal/status?force=true')
        .expect('Content-Type', /json/)
        .expect(503);

      expect(response.body).toEqual({
        success: false,
        error: {
          code: 'PORTAL_UNAVAILABLE',
          message: 'Urja Meter Ops portal is unavailable or unreachable',
        },
      });
    });
  });
});
