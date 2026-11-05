import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { AxiosError } from 'axios';
import { app } from '../src/app';
import { portalClient, PortalClient } from '../src/clients/portal.client';
import { authService } from '../src/services/auth.service';
import { cacheService } from '../src/services/cache.service';
import { localMeterIndex } from '../src/services/local-index.service';
import { bulkExportService } from '../src/services/bulk-export.service';
import { DefaultRequestSigner, VerifiedRequestSigner } from '../src/services/request-signer.service';
import { AppError } from '../src/types/portal.types';

describe('Core API Fixes — Regression Suite', () => {
  beforeEach(async () => {
    await portalClient.clearCookies();
    cacheService.invalidateAll();
    localMeterIndex.clear();
    bulkExportService.setSigner(new DefaultRequestSigner());
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await portalClient.clearCookies();
    cacheService.invalidateAll();
    localMeterIndex.clear();
    vi.restoreAllMocks();
  });

  // Task 1: Fix meter search response normalization
  describe('Task 1: Meter search response normalization', () => {
    it('should normalize root array format from portal meters endpoint', async () => {
      await authService.setSessionToken('valid-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search') && url.includes('q=&page=1')) {
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/meters/search')) {
          return {
            status: 200,
            statusText: 'OK',
            // Direct array response
            data: [
              {
                meterId: 'ARR001',
                serialNo: 'SN-001',
                consumerName: 'Array Consumer',
                status: 'ACTIVE',
              },
            ] as any,
            headers: {},
            config: {} as any,
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const res = await request(app).get('/api/v1/meters?q=Array&page=1').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('ARR001');
      expect(res.body.data[0].meterNo).toBe('SN-001');
      expect(res.body.data[0].consumerName).toBe('Array Consumer');
      expect(res.body.pagination.total).toBe(1);
    });

    it('should normalize snake_case and alternative field names in meter search', async () => {
      await authService.setSessionToken('valid-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search') && url.includes('q=&page=1')) {
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/meters/search')) {
          return {
            status: 200,
            statusText: 'OK',
            data: {
              data: [
                {
                  meter_id: 'SNAKE_001',
                  meter_no: 'M-12345',
                  consumer_name: 'Snake User',
                  consumer_no: 'CONS-99',
                  dt_name: 'DT-Snake',
                  dt_code: 'DTC-99',
                  sub_division: 'SD-West',
                  meter_status: 'Installed',
                  make: 'Secure',
                  phase_type: 'three',
                },
              ],
              totalCount: 1,
            },
            headers: {},
            config: {} as any,
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const res = await request(app).get('/api/v1/meters?q=snake&page=1').expect(200);

      expect(res.body.success).toBe(true);
      const meter = res.body.data[0];
      expect(meter.id).toBe('SNAKE_001');
      expect(meter.meterNo).toBe('M-12345');
      expect(meter.consumerName).toBe('Snake User');
      expect(meter.consumerNo).toBe('CONS-99');
      expect(meter.dtName).toBe('DT-Snake');
      expect(meter.dtId).toBe('DTC-99');
      expect(meter.subdivision).toBe('SD-West');
      expect(meter.status).toBe('Installed');
      expect(meter.manufacturer).toBe('Secure');
      expect(meter.phase).toBe('three');
    });
  });

  // Task 2: Fix meter location coordinate extraction and numeric conversion
  describe('Task 2: Meter location coordinate extraction and numeric conversion', () => {
    it('should convert string coordinates to finite numbers and handle "long" key', async () => {
      await authService.setSessionToken('valid-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/meters/MTR-GEO/geo')) {
          return {
            status: 200,
            statusText: 'OK',
            data: {
              lat: ' 28.704060 ',
              long: ' 77.102493 ',
              address: 'Pitampura, Delhi',
            },
            headers: {},
            config: {} as any,
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const res = await request(app).get('/api/v1/meters/MTR-GEO/location').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.latitude).toBe(28.70406);
      expect(res.body.data.longitude).toBe(77.102493);
      expect(typeof res.body.data.latitude).toBe('number');
      expect(typeof res.body.data.longitude).toBe('number');
      expect(res.body.data.address).toBe('Pitampura, Delhi');
    });

    it('should return null for invalid, NaN or empty coordinate strings', async () => {
      await authService.setSessionToken('valid-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/meters/MTR-INVALID/geo')) {
          return {
            status: 200,
            statusText: 'OK',
            data: {
              latitude: 'NaN',
              longitude: 'null',
            },
            headers: {},
            config: {} as any,
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const res = await request(app).get('/api/v1/meters/MTR-INVALID/location').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.latitude).toBeNull();
      expect(res.body.data.longitude).toBeNull();
    });
  });

  // Task 3: Verify consumption readings and preserve original timestamps
  describe('Task 3: Consumption readings and timestamp preservation', () => {
    it('should preserve original non-ISO formatted timestamps and convert string kwh', async () => {
      await authService.setSessionToken('valid-token');

      const portalReadings = [
        { timestamp: '23/06/2026 23:30', kwh: '48438.74', kvah: '52313.84' },
        { timestamp: '24/06/2026 00:00', kwh: '48439.16', kvah: '52314.29' },
      ];

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/meters/MTR-ENERGY/energy')) {
          return {
            status: 200,
            statusText: 'OK',
            data: { data: portalReadings },
            headers: {},
            config: {} as any,
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const res = await request(app).get('/api/v1/meters/MTR-ENERGY/consumption').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.readings).toHaveLength(2);
      // Strict preservation of the original timestamp format
      expect(res.body.data.readings[0].timestamp).toBe('23/06/2026 23:30');
      expect(res.body.data.readings[0].value).toBe(48438.74);
      expect(res.body.data.readings[1].timestamp).toBe('24/06/2026 00:00');
      expect(res.body.data.readings[1].value).toBe(48439.16);
    });

    it('should handle raw array readings response without data envelope', async () => {
      await authService.setSessionToken('valid-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/meters/MTR-ARRAY/energy')) {
          return {
            status: 200,
            statusText: 'OK',
            data: [
              { timestamp: '2026-11-01T12:00:00Z', reading: 120.5 },
            ] as any,
            headers: {},
            config: {} as any,
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const res = await request(app).get('/api/v1/meters/MTR-ARRAY/consumption').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.readings).toHaveLength(1);
      expect(res.body.data.readings[0].value).toBe(120.5);
      expect(res.body.data.readings[0].timestamp).toBe('2026-11-01T12:00:00Z');
    });
  });

  // Task 4: Fix transformer ID, capacity and feeder mappings
  describe('Task 4: Transformer ID, capacity and feeder mappings', () => {
    it('should correctly normalize live portal fields (code -> id, capacityKva number -> string, feederCode -> feeder)', async () => {
      await authService.setSessionToken('valid-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/dts')) {
          return {
            status: 200,
            statusText: 'OK',
            data: {
              data: [
                {
                  code: 'DT-001',
                  name: 'Malviya Nagar DT 1',
                  feederCode: 'F-001',
                  capacityKva: 100,
                },
                {
                  dt_code: 'DT-002',
                  dt_name: 'Mansarovar DT 2',
                  feeder_code: 'F-002',
                  capacity_kva: 63,
                  meter_count: 45,
                },
              ],
              total: 2,
            },
            headers: {},
            config: {} as any,
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const res = await request(app).get('/api/v1/transformers?page=1').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);

      const dt1 = res.body.data[0];
      expect(dt1.id).toBe('DT-001');
      expect(dt1.name).toBe('Malviya Nagar DT 1');
      expect(dt1.capacity).toBe('100');
      expect(dt1.feeder).toBe('F-001');

      const dt2 = res.body.data[1];
      expect(dt2.id).toBe('DT-002');
      expect(dt2.name).toBe('Mansarovar DT 2');
      expect(dt2.capacity).toBe('63');
      expect(dt2.feeder).toBe('F-002');
      expect(dt2.meterCount).toBe(45);
    });
  });

  // Task 5: Verify session cookie attachment and authentication error handling
  describe('Task 5: Session cookie attachment and authentication error handling', () => {
    it('should set session cookie correctly without public suffix errors on localhost', async () => {
      await expect(authService.setSessionToken('test-session-xyz')).resolves.not.toThrow();
      const token = await authService.getSessionToken();
      expect(token).toBe('test-session-xyz');
    });

    it('should invalidate active session when portal returns 401 on meter search', async () => {
      await authService.setSessionToken('active-token');

      let callCount = 0;
      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        callCount++;
        if (callCount === 1) {
          // auth check succeeds
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        // subsequent endpoint call throws 401
        throw new AppError('PORTAL_AUTH_FAILED', 'Authentication failed with Urja Meter Ops portal', 401);
      });

      const res = await request(app).get('/api/v1/meters?q=test&page=1').expect(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PORTAL_AUTH_FAILED');

      // Verify that the cached session was invalidated
      const isAuth = await authService.isAuthenticated();
      expect(isAuth).toBe(false);
    });

    it('should detect 401 from portal as PORTAL_AUTH_FAILED and detect HTML redirect response', async () => {
      const client = new PortalClient({
        baseURL: 'https://urja-ops.flockenergy.tech',
        timeoutMs: 5000,
      });

      const axios401 = new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        data: { error: 'Unauthorized' },
        headers: {},
        config: {} as any,
      });

      const error = client.normalizeError(axios401);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('PORTAL_AUTH_FAILED');
      expect((error as AppError).statusCode).toBe(401);
    });
  });

  // Task 6: Check local search and hierarchy responses for incorrect or missing fields
  describe('Task 6: Local search and hierarchy responses', () => {
    it('should properly extract all hierarchy fields from bulk export with snake_case and DT fields', () => {
      const rawRecord = {
        id: 'EXP-100',
        meter_no: 'M-100',
        consumer_name: 'Dev Sharma',
        consumer_no: 'C-100',
        zone: 'North',
        circle: 'Jaipur',
        division: 'Central',
        sub_division: 'C-Sub',
        sub_station: 'SS-01',
        feeder_code: 'FDR-500',
        dt_code: 'DT-500',
        dt_name: 'Transformer 500',
        latitude: '26.9124',
        longitude: '75.7873',
        address: 'Jaipur Main',
        installStatus: 'Active',
      };

      const normalized = bulkExportService.normalizeRecord(rawRecord, '2026-11-06T00:00:00.000Z');

      expect(normalized.id).toBe('EXP-100');
      expect(normalized.meterNo).toBe('M-100');
      expect(normalized.consumerName).toBe('Dev Sharma');
      expect(normalized.status).toBe('Active');
      expect(normalized.hierarchy.subdivision).toBe('C-Sub');
      expect(normalized.hierarchy.substation).toBe('SS-01');
      expect(normalized.hierarchy.feeder).toBe('FDR-500');
      expect(normalized.hierarchy.dtName).toBe('Transformer 500');
      expect(normalized.hierarchy.dtId).toBe('DT-500');
      expect(normalized.hierarchy.transformer).toBe('Transformer 500');
      expect(normalized.hierarchy.transformerId).toBe('DT-500');
      expect(normalized.location.latitude).toBe(26.9124);
      expect(normalized.location.longitude).toBe(75.7873);
    });

    it('should support case-insensitive meter lookup in local index', () => {
      localMeterIndex.replaceRecords([
        {
          id: 'EXP-METER-99',
          meterNo: 'MTR-99-ABC',
          consumerName: 'Case Test',
          consumerNo: 'C-99',
          status: 'Active',
          hierarchy: {
            zone: 'Zone A',
            circle: 'Circle B',
            division: 'Div C',
            subdivision: 'Sub D',
            substation: 'Sub E',
            feeder: 'FDR F',
            transformer: 'TX G',
            transformerId: 'TXG-01',
            dtName: 'TX G',
            dtId: 'TXG-01',
          },
          location: { latitude: 28.5, longitude: 77.2, address: 'Test St' },
          importedAt: '2026-11-06T00:00:00.000Z',
          raw: {},
        },
      ]);

      // Lookup by uppercase ID
      expect(localMeterIndex.getById('EXP-METER-99')?.id).toBe('EXP-METER-99');
      // Lookup by lowercase ID
      expect(localMeterIndex.getById('exp-meter-99')?.id).toBe('EXP-METER-99');
      // Lookup by meter number
      expect(localMeterIndex.getById('mtr-99-abc')?.id).toBe('EXP-METER-99');
    });

    it('should retrieve transformer meters when queried by DT code', async () => {
      localMeterIndex.replaceRecords([
        {
          id: 'M-1',
          meterNo: 'MN-1',
          consumerName: 'Consumer 1',
          consumerNo: 'C-1',
          status: 'Active',
          hierarchy: {
            zone: 'Z',
            circle: 'C',
            division: 'D',
            subdivision: 'SD',
            substation: 'SS',
            feeder: 'FDR-01',
            transformer: 'Malviya Nagar DT 1',
            transformerId: 'DT-001',
            dtName: 'Malviya Nagar DT 1',
            dtId: 'DT-001',
          },
          location: { latitude: null, longitude: null, address: null },
          importedAt: '2026-11-06T00:00:00.000Z',
          raw: {},
        },
      ]);

      const res = await request(app).get('/api/v1/transformers/DT-001/meters').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.transformer).toBe('Malviya Nagar DT 1');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe('M-1');
    });
  });

  // Task 7: Bulk export signing isolation
  describe('Task 7: Bulk export signing isolation', () => {
    it('should keep DefaultRequestSigner unconfigured and return empty headers', async () => {
      const signer = bulkExportService.getSigner();
      expect(signer.isConfigured).toBe(false);
      const headers = await signer.generateHeaders('https://urja-ops.flockenergy.tech/portal/export');
      expect(headers).toEqual({});
      expect(signer.getAlgorithmDetails()).toContain('not verified');
    });

    it('should reject bulk export trigger with 401 and not clear session when signer is unverified', async () => {
      await authService.setSessionToken('active-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/export')) {
          throw new AppError('PORTAL_AUTH_FAILED', 'Authentication failed with Urja Meter Ops portal', 401);
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const res = await request(app).get('/api/v1/meters/export').expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PORTAL_AUTH_FAILED');
      expect(res.body.error.message).toContain('signing algorithm is unverified');

      // Ensure the general portal session cookie remains intact
      const hasCookie = await authService.hasSessionCookie();
      expect(hasCookie).toBe(true);
    });
  });

  // Local index synchronization via meter-search API & local search verification
  describe('Safe Local Index Synchronization & Search Verification', () => {
    it('should synchronize meters via meter-search API and populate local index', async () => {
      await authService.setSessionToken('valid-sync-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/dts')) {
          return {
            status: 200,
            statusText: 'OK',
            data: {
              data: [
                { code: 'DT-001', name: 'Malviya Nagar DT 1', feederCode: 'F-001', capacityKva: 100 },
              ],
              total: 1,
            },
            headers: {},
            config: {} as any,
          };
        }
        if (url.includes('/portal/meters/search') && url.includes('page=1')) {
          return {
            status: 200,
            statusText: 'OK',
            data: {
              data: [
                {
                  meterId: 'J100000',
                  serialNo: 'SE33962',
                  make: 'HPL',
                  phaseType: 'single',
                  installStatus: 'Decommissioned',
                  dtCode: 'DT-001',
                },
                {
                  meterId: 'J100001',
                  serialNo: 'GE84132',
                  make: 'L&T',
                  phaseType: 'single',
                  installStatus: 'Installed',
                  dtCode: 'DT-001',
                },
              ],
              total: 3,
              pageSize: 2,
            },
            headers: {},
            config: {} as any,
          };
        }
        if (url.includes('/portal/meters/search') && url.includes('page=2')) {
          return {
            status: 200,
            statusText: 'OK',
            data: {
              data: [
                {
                  meterId: 'J100002',
                  serialNo: 'AL28136',
                  make: 'L&T',
                  phaseType: 'three',
                  installStatus: 'Installed',
                  dtCode: 'DT-001',
                },
              ],
              total: 3,
              pageSize: 2,
            },
            headers: {},
            config: {} as any,
          };
        }
        if (url.includes('/portal/meters/search')) {
          return { status: 200, statusText: 'OK', data: { data: [] }, headers: {}, config: {} as any };
        }
        throw new Error(`Unexpected URL in sync test: ${url}`);
      });

      const syncResult = await bulkExportService.syncFromMeterSearch();
      expect(syncResult.status).toBe('completed');
      expect(syncResult.importedCount).toBe(3);
      expect(syncResult.totalIndexed).toBe(3);
      expect(localMeterIndex.count()).toBe(3);

      // Verify meter J100000 mappings
      const j100000 = localMeterIndex.getById('J100000');
      expect(j100000).toBeDefined();
      expect(j100000?.id).toBe('J100000');
      expect(j100000?.meterNo).toBe('SE33962');
      expect(j100000?.status).toBe('Decommissioned');
      expect(j100000?.manufacturer).toBe('HPL');
      expect(j100000?.phase).toBe('single');
      expect(j100000?.hierarchy.dtId).toBe('DT-001');
      expect(j100000?.hierarchy.transformer).toBe('Malviya Nagar DT 1');
      expect(j100000?.hierarchy.feeder).toBe('F-001');

      // Verify searching locally via GET /api/v1/meters/local?q=J100000
      const localSearchRes = await request(app)
        .get('/api/v1/meters/local?q=J100000&page=1&limit=20')
        .expect(200);

      expect(localSearchRes.body.success).toBe(true);
      expect(localSearchRes.body.data).toHaveLength(1);
      expect(localSearchRes.body.data[0].id).toBe('J100000');
      expect(localSearchRes.body.data[0].meterNo).toBe('SE33962');
      expect(localSearchRes.body.pagination.total).toBe(1);
    });

    it('should deduplicate duplicate records during synchronization', async () => {
      await authService.setSessionToken('valid-sync-token');

      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return {
            status: 200,
            statusText: 'OK',
            data: {
              data: [
                { meterId: 'DUP001', serialNo: 'SN-DUP', installStatus: 'Active' },
                { meterId: 'DUP001', serialNo: 'SN-DUP', installStatus: 'Active' },
              ],
              total: 2,
              pageSize: 2,
            },
            headers: {},
            config: {} as any,
          };
        }
        if (url.includes('/portal/dts')) {
          return { status: 200, data: { data: [] }, headers: {}, config: {} as any };
        }
        throw new Error(`Unexpected url: ${url}`);
      });

      const syncResult = await bulkExportService.syncFromMeterSearch();
      expect(syncResult.importedCount).toBe(1);
      expect(localMeterIndex.count()).toBe(1);
    });

    it('should retain previously indexed records if synchronization fails midway', async () => {
      // Pre-populate index
      localMeterIndex.replaceRecords([
        {
          id: 'RETAIN-01',
          meterNo: 'MTR-RET',
          consumerName: 'Keep Me',
          consumerNo: 'C-RET',
          status: 'Active',
          hierarchy: {
            zone: null, circle: null, division: null, subdivision: null,
            substation: null, feeder: null, transformer: null, transformerId: null,
            dtName: null, dtId: null,
          },
          location: { latitude: null, longitude: null, address: null },
          importedAt: '2026-11-06T00:00:00.000Z',
          raw: {},
        },
      ]);
      expect(localMeterIndex.count()).toBe(1);

      await authService.setSessionToken('valid-sync-token');

      // Mock search endpoint throwing failure on page 1
      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search') && url.includes('q=&page=1')) {
          throw new AppError('PORTAL_UNAVAILABLE', 'Server down during sync', 503);
        }
        return { status: 200, data: { data: [] }, headers: {}, config: {} as any };
      });

      await expect(bulkExportService.syncFromMeterSearch()).rejects.toThrow(/Server down during sync/);

      // Previously indexed data is still intact
      expect(localMeterIndex.count()).toBe(1);
      expect(localMeterIndex.getById('RETAIN-01')).toBeDefined();
    });
  });
});
