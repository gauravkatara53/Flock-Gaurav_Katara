import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { portalClient } from '../src/clients/portal.client';
import { authService } from '../src/services/auth.service';
import { localMeterIndex } from '../src/services/local-index.service';
import { bulkExportService } from '../src/services/bulk-export.service';
import { DefaultRequestSigner, VerifiedRequestSigner } from '../src/services/request-signer.service';
import { AppError } from '../src/types/portal.types';

function mockAuthAndExport(portalExportData: unknown) {
  return vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
    // Auth validation endpoint
    if (url.includes('/portal/meters/search') && url.includes('q=&page=1')) {
      return {
        status: 200,
        statusText: 'OK',
        data: { meters: [], total: 0 },
        headers: {},
        config: {} as any,
      };
    }

    // Bulk export endpoint
    if (url.includes('/portal/export')) {
      return {
        status: 200,
        statusText: 'OK',
        data: portalExportData,
        headers: {},
        config: {} as any,
      };
    }

    throw new Error(`Unexpected URL in mock: ${url}`);
  });
}

describe('Phase 3 — Bulk Export & Local Data Index', () => {
  beforeEach(async () => {
    await portalClient.clearCookies();
    localMeterIndex.clear();
    bulkExportService.setSigner(new DefaultRequestSigner());
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await portalClient.clearCookies();
    localMeterIndex.clear();
    vi.restoreAllMocks();
  });

  describe('GET /api/v1/meters/export/status — Status Endpoint', () => {
    it('should report idle status and zero indexed items initially', async () => {
      const response = await request(app)
        .get('/api/v1/meters/export/status')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        totalIndexed: 0,
      });
    });
  });

  describe('GET /api/v1/meters/export — Trigger Import', () => {
    const mockExportRecords = [
      {
        id: 'EXP001',
        meterNo: 'MTR-1001',
        consumerName: 'Amit Patel',
        consumerNo: 'CONS-9001',
        status: 'active',
        hierarchy: {
          dtName: 'DT-West-1',
          dtId: 'DT-W1',
          feeder: 'Feeder-A',
          subdivision: 'West Zone',
          substation: 'Sub-1',
          division: 'Central',
        },
        location: {
          latitude: 18.5204,
          longitude: 73.8567,
          address: 'Pune Station Road',
        },
      },
      {
        id: 'EXP002',
        meterNo: 'MTR-1002',
        consumerName: 'Sneha Deshmukh',
        consumerNo: 'CONS-9002',
        status: 'active',
        dtName: 'DT-West-2',
        dtId: 'DT-W2',
        feeder: 'Feeder-B',
        subdivision: 'West Zone',
        latitude: '18.5314',
        longitude: '73.8446',
        address: 'Shivaji Nagar, Pune',
      },
    ];

    it('should trigger bulk import and populate the local index', async () => {
      await authService.setSessionToken('active-token-bulk');
      mockAuthAndExport({ meters: mockExportRecords });

      const response = await request(app)
        .get('/api/v1/meters/export')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('completed');
      expect(response.body.data.importedCount).toBe(2);
      expect(response.body.data.totalIndexed).toBe(2);
      expect(response.body.data.timestamp).toBeDefined();

      // Verify index contains the records
      expect(localMeterIndex.count()).toBe(2);
      const indexed = localMeterIndex.getById('EXP001');
      expect(indexed).not.toBeNull();
      expect(indexed?.consumerName).toBe('Amit Patel');
      expect(indexed?.hierarchy.dtName).toBe('DT-West-1');
      expect(indexed?.location.latitude).toBe(18.5204);
      expect(indexed?.location.longitude).toBe(73.8567);
      expect(indexed?.raw).toBeDefined();
    });

    it('should deduplicate duplicate records in export payload', async () => {
      await authService.setSessionToken('active-token-bulk');
      const duplicatedRecords = [
        ...mockExportRecords,
        {
          id: 'EXP001', // Duplicate ID
          meterNo: 'MTR-1001-UPDATED',
          consumerName: 'Amit Patel Updated',
        },
      ];

      mockAuthAndExport({ meters: duplicatedRecords });

      const response = await request(app)
        .get('/api/v1/meters/export')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalIndexed).toBe(2);
      expect(localMeterIndex.count()).toBe(2);

      // Latest record should be preserved
      const meter1 = localMeterIndex.getById('EXP001');
      expect(meter1?.consumerName).toBe('Amit Patel Updated');
    });

    it('should support alternative export payload shapes (raw array, data, items)', async () => {
      await authService.setSessionToken('active-token-bulk');

      mockAuthAndExport(mockExportRecords); // Raw array

      const response = await request(app)
        .get('/api/v1/meters/export')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalIndexed).toBe(2);
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .get('/api/v1/meters/export')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(['PORTAL_SESSION_EXPIRED', 'PORTAL_AUTH_FAILED']).toContain(response.body.error.code);
    });

    it('should handle export authentication failure when session is expired', async () => {
      await authService.setSessionToken('expired-bulk-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          throw new AppError('PORTAL_SESSION_EXPIRED', 'Urja Meter Ops portal session is invalid or expired', 401);
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const response = await request(app)
        .get('/api/v1/meters/export')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(['PORTAL_SESSION_EXPIRED', 'PORTAL_AUTH_FAILED']).toContain(response.body.error.code);
    });

    it('should report exact missing requirement when upstream export rejects unsigned request and signer is unverified', async () => {
      await authService.setSessionToken('valid-token-bulk');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return {
            status: 200,
            statusText: 'OK',
            data: { meters: [], total: 0 },
            headers: {},
            config: {} as any,
          };
        }
        if (url.includes('/portal/export')) {
          throw new AppError('PORTAL_AUTH_FAILED', 'Authentication failed with Urja Meter Ops portal', 401);
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const response = await request(app)
        .get('/api/v1/meters/export')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PORTAL_AUTH_FAILED');
      expect(response.body.error.message).toContain('Upstream endpoint requires verified request signing');
      expect(response.body.error.message).toContain('signing algorithm is unverified');
    });

    it('should handle export authentication failure when verified signer is configured but upstream rejects credentials', async () => {
      await authService.setSessionToken('valid-token-bulk');

      const verifiedSigner = new VerifiedRequestSigner(
        'HMAC-SHA256-Custom',
        (url, ts) => `sig_${url}_${ts}`
      );
      bulkExportService.setSigner(verifiedSigner);

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return {
            status: 200,
            statusText: 'OK',
            data: { meters: [], total: 0 },
            headers: {},
            config: {} as any,
          };
        }
        if (url.includes('/portal/export')) {
          throw new AppError('PORTAL_AUTH_FAILED', 'Authentication failed with Urja Meter Ops portal', 401);
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const response = await request(app)
        .get('/api/v1/meters/export')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PORTAL_AUTH_FAILED');
      expect(response.body.error.message).toBe('Authentication failed with Urja Meter Ops portal');
    });

    it('should handle portal timeout during export gracefully', async () => {
      await authService.setSessionToken('active-token-bulk');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return {
            status: 200,
            statusText: 'OK',
            data: { meters: [], total: 0 },
            headers: {},
            config: {} as any,
          };
        }
        if (url.includes('/portal/export')) {
          throw new AppError('PORTAL_TIMEOUT', 'Export request timed out', 504);
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const response = await request(app)
        .get('/api/v1/meters/export')
        .expect(504);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PORTAL_TIMEOUT');
    });

    it('should ensure failed imports do not destroy previously imported valid data', async () => {
      await authService.setSessionToken('active-token-bulk');

      // 1. Initial successful import
      mockAuthAndExport({ meters: mockExportRecords });
      await request(app).get('/api/v1/meters/export').expect(200);
      expect(localMeterIndex.count()).toBe(2);

      // 2. Subsequent failed import (portal 503 outage)
      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, data: { meters: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/export')) {
          throw new AppError('PORTAL_UNAVAILABLE', 'Portal export service down', 503);
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const failedResponse = await request(app)
        .get('/api/v1/meters/export')
        .expect(503);

      expect(failedResponse.body.success).toBe(false);

      // 3. Crucial verification: previously indexed data was NOT destroyed
      expect(localMeterIndex.count()).toBe(2);
      const retainedMeter = localMeterIndex.getById('EXP001');
      expect(retainedMeter).not.toBeNull();
      expect(retainedMeter?.consumerName).toBe('Amit Patel');

      // 4. Verify export status reflects failed attempt while maintaining count
      const statusRes = await request(app).get('/api/v1/meters/export/status').expect(200);
      expect(statusRes.body.data.status).toBe('failed');
      expect(statusRes.body.data.totalIndexed).toBe(2);
      expect(statusRes.body.data.lastError).toContain('Portal export service down');
      expect(statusRes.body.data.lastSuccessfulRefresh).toBeDefined();
    });

    it('should handle malformed portal responses gracefully', async () => {
      await authService.setSessionToken('active-token-bulk');

      mockAuthAndExport({ invalid_field: 'malformed' });

      const response = await request(app)
        .get('/api/v1/meters/export')
        .expect(200);

      // Should succeed with 0 imported records without crashing
      expect(response.body.data.importedCount).toBe(0);
    });
  });

  describe('GET /api/v1/meters/local — Local Search', () => {
    beforeEach(() => {
      localMeterIndex.replaceRecords([
        {
          id: 'LOC-1',
          meterNo: 'MTR-5001',
          consumerName: 'Kavita Rao',
          consumerNo: 'C-5001',
          status: 'active',
          hierarchy: {
            dtName: 'DT-Alpha',
            dtId: 'DTA',
            feeder: 'Feeder-North',
            subdivision: 'Sub-North',
          },
          location: { latitude: 12.9716, longitude: 77.5946, address: 'Bangalore East' },
          importedAt: new Date().toISOString(),
          raw: {},
        },
        {
          id: 'LOC-2',
          meterNo: 'MTR-5002',
          consumerName: 'Rohan Gupta',
          consumerNo: 'C-5002',
          status: 'inactive',
          hierarchy: {
            dtName: 'DT-Beta',
            dtId: 'DTB',
            feeder: 'Feeder-South',
            subdivision: 'Sub-South',
          },
          location: { latitude: 12.9352, longitude: 77.6245, address: 'Koramangala, Bangalore' },
          importedAt: new Date().toISOString(),
          raw: {},
        },
        {
          id: 'LOC-3',
          meterNo: 'MTR-5003',
          consumerName: 'Deepak Rao',
          consumerNo: 'C-5003',
          status: 'active',
          hierarchy: {
            dtName: 'DT-Gamma',
            dtId: 'DTG',
            feeder: 'Feeder-North',
            subdivision: 'Sub-North',
          },
          location: { latitude: 13.0358, longitude: 77.597, address: 'Hebbal, Bangalore' },
          importedAt: new Date().toISOString(),
          raw: {},
        },
      ]);
    });

    it('should return all locally indexed meters paginated when no query is passed', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local?page=1&limit=2')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('should search meters by consumer name', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local?q=rao')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map((m: any) => m.consumerName)).toEqual(
        expect.arrayContaining(['Kavita Rao', 'Deepak Rao'])
      );
    });

    it('should search meters by meterNo', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local?q=5002')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe('LOC-2');
    });

    it('should search meters by hierarchy (feeder, subdivision, dtName)', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local?q=feeder-north')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it('should search meters by location address', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local?q=koramangala')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe('LOC-2');
    });

    it('should return empty array when search query matches nothing', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local?q=nonexistent-term')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });

    it('should return 400 for invalid page parameter', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local?page=0')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid limit parameter', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local?limit=-10')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/meters/local/:meterId — Single Local Record', () => {
    beforeEach(() => {
      localMeterIndex.replaceRecords([
        {
          id: 'MTR-SINGLE',
          meterNo: 'MTR-NUM-777',
          consumerName: 'Vikram Singh',
          consumerNo: 'C-777',
          status: 'active',
          hierarchy: {
            dtName: 'DT-Central',
            dtId: 'DTC',
            feeder: 'Feeder-1',
            subdivision: 'Sub-1',
          },
          location: {
            latitude: 28.7041,
            longitude: 77.1025,
            address: 'Delhi NCR',
          },
          importedAt: new Date().toISOString(),
          raw: { original: true },
        },
      ]);
    });

    it('should retrieve a locally indexed meter by ID', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local/MTR-SINGLE')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('MTR-SINGLE');
      expect(response.body.data.consumerName).toBe('Vikram Singh');
      expect(response.body.data.location.latitude).toBe(28.7041);
    });

    it('should retrieve a locally indexed meter by meter number', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local/MTR-NUM-777')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe('MTR-SINGLE');
      expect(response.body.data.consumerName).toBe('Vikram Singh');
    });

    it('should return 404 when meter is not found in local index', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local/NONEXISTENT-METER')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toContain('not found in local index');
    });
  });

  describe('Request Signing Architecture', () => {
    it('should skip signing headers with default unverified signer without guessing algorithm', () => {
      const signer = new DefaultRequestSigner();
      expect(signer.isConfigured).toBe(false);
      const headers = signer.generateHeaders('/portal/export');
      expect(headers).toEqual({});
      expect(signer.getAlgorithmDetails()).toContain('intentionally not guessed');
    });

    it('should include x-signature and x-timestamp headers when a verified signer is configured', async () => {
      const verifiedSigner = new VerifiedRequestSigner(
        'HMAC-SHA256-Custom',
        (url, ts) => `signed_${url}_${ts}`
      );

      expect(verifiedSigner.isConfigured).toBe(true);
      bulkExportService.setSigner(verifiedSigner);

      let capturedHeaders: Record<string, any> = {};
      await authService.setSessionToken('active-token-bulk');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string, config?: any) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, data: { meters: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/export')) {
          capturedHeaders = config?.headers || {};
          return { status: 200, data: [], headers: {}, config: {} as any };
        }
        throw new Error('Unexpected');
      });

      await request(app).get('/api/v1/meters/export').expect(200);

      expect(capturedHeaders['x-timestamp']).toBeDefined();
      expect(capturedHeaders['x-signature']).toBeDefined();
      expect(capturedHeaders['X-Timestamp']).toBeDefined();
      expect(capturedHeaders['X-Signature']).toBeDefined();
      expect(capturedHeaders['x-signature']).toContain('signed_/portal/export?page=1');
    });

    it('should reject signing when signFn returns empty or whitespace signature', async () => {
      const invalidSigner = new VerifiedRequestSigner('EmptySigner', () => '   ');
      bulkExportService.setSigner(invalidSigner);

      await authService.setSessionToken('active-token-bulk');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, data: { meters: [] }, headers: {}, config: {} as any };
        }
        return { status: 200, data: [], headers: {}, config: {} as any };
      });

      const response = await request(app).get('/api/v1/meters/export').expect(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CONFIGURATION');
      expect(response.body.error.message).toContain('empty or invalid signature');
    });

    it('should reject signing when signFn throws an exception', async () => {
      const throwingSigner = new VerifiedRequestSigner('ErrorSigner', () => {
        throw new Error('Key derivation failed');
      });
      bulkExportService.setSigner(throwingSigner);

      await authService.setSessionToken('active-token-bulk');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, data: { meters: [] }, headers: {}, config: {} as any };
        }
        return { status: 200, data: [], headers: {}, config: {} as any };
      });

      const response = await request(app).get('/api/v1/meters/export').expect(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_CONFIGURATION');
      expect(response.body.error.message).toContain('Key derivation failed');
    });

    it('should reject invalid signer object in setSigner', () => {
      expect(() => {
        bulkExportService.setSigner(null as any);
      }).toThrow(/Invalid request signer/);
    });

    it('should support options-based initialization with custom timestamp generator', async () => {
      const customSigner = new VerifiedRequestSigner({
        name: 'CustomTimeSigner',
        signFn: (url, ts) => `signed_${ts}`,
        timestampFn: () => '1700000000',
        algorithmDetails: 'Custom RFC 7515 Signer',
      });

      expect(customSigner.name).toBe('CustomTimeSigner');
      expect(customSigner.getAlgorithmDetails()).toBe('Custom RFC 7515 Signer');
      const headers = await customSigner.generateHeaders('/portal/export');
      expect(headers['x-timestamp']).toBe('1700000000');
      expect(headers['x-signature']).toBe('signed_1700000000');
    });
  });

  describe('Security & Secrets Protection', () => {
    it('should not expose tokens, cookies, or signing secrets in export or local responses', async () => {
      await authService.setSessionToken('secret-session-token-xyz');
      mockAuthAndExport({
        meters: [
          {
            id: 'SEC-1',
            meterNo: 'MTR-SEC',
            consumerName: 'Secure Consumer',
          },
        ],
      });

      const exportRes = await request(app).get('/api/v1/meters/export').expect(200);
      const exportJson = JSON.stringify(exportRes.body);
      expect(exportJson).not.toContain('secret-session-token');
      expect(exportJson).not.toContain('better-auth');

      const localRes = await request(app).get('/api/v1/meters/local').expect(200);
      const localJson = JSON.stringify(localRes.body);
      expect(localJson).not.toContain('secret-session-token');
      expect(localJson).not.toContain('better-auth');
    });
  });
});
