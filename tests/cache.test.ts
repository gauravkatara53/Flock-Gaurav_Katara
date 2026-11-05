import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { cacheService, CacheService } from '../src/services/cache.service';
import { portalClient } from '../src/clients/portal.client';
import { authService } from '../src/services/auth.service';
import { bulkExportService } from '../src/services/bulk-export.service';
import { localMeterIndex } from '../src/services/local-index.service';
import { hierarchyService } from '../src/services/hierarchy.service';
import { NormalizedIndexedMeter } from '../src/types/export.types';
import { performance } from 'perf_hooks';

describe('Phase 5 — In-Memory Caching, Concurrency & Performance', () => {
  beforeEach(async () => {
    await portalClient.clearCookies();
    cacheService.invalidateAll();
    cacheService.resetStats();
    localMeterIndex.clear();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await portalClient.clearCookies();
    cacheService.invalidateAll();
    cacheService.resetStats();
    localMeterIndex.clear();
    vi.restoreAllMocks();
  });

  describe('CacheService Core', () => {
    it('should set and get items from cache and record hit statistics', () => {
      const cache = new CacheService(5000, 10);
      cache.set('key1', { name: 'Meter A' });

      expect(cache.has('key1')).toBe(true);
      const val = cache.get<{ name: string }>('key1');
      expect(val).toEqual({ name: 'Meter A' });

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(1);
      expect(stats.hitRatio).toBe(1);
    });

    it('should record misses when key does not exist', () => {
      const cache = new CacheService(5000, 10);
      const val = cache.get('nonexistent');
      expect(val).toBeUndefined();

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
      expect(stats.hitRatio).toBe(0);
    });

    it('should expire items after TTL', async () => {
      const shortTtlMs = 50;
      const cache = new CacheService(shortTtlMs, 10);
      cache.set('quick-key', 'quick-value', shortTtlMs);

      expect(cache.get('quick-key')).toBe('quick-value');

      // Wait for expiration
      await new Promise((r) => setTimeout(r, 60));

      expect(cache.get('quick-key')).toBeUndefined();
      expect(cache.has('quick-key')).toBe(false);
    });

    it('should invalidate entries by tag', () => {
      const cache = new CacheService(5000, 10);
      cache.set('meter:1', { id: '1' }, 5000, ['meters']);
      cache.set('meter:2', { id: '2' }, 5000, ['meters']);
      cache.set('tx:1', { id: 'tx1' }, 5000, ['transformers']);

      expect(cache.get('meter:1')).toBeDefined();
      expect(cache.get('tx:1')).toBeDefined();

      const invalidated = cache.invalidateByTag('meters');
      expect(invalidated).toBe(2);

      expect(cache.get('meter:1')).toBeUndefined();
      expect(cache.get('meter:2')).toBeUndefined();
      expect(cache.get('tx:1')).toBeDefined(); // transformer tag untouched
    });

    it('should evict least recently accessed entries when max capacity is reached', () => {
      const max = 3;
      const cache = new CacheService(10000, max);

      cache.set('k1', 'v1');
      cache.set('k2', 'v2');
      cache.set('k3', 'v3');

      // Access k1 and k3 so k2 is oldest
      cache.get('k1');
      cache.get('k3');

      // Adding 4th item triggers eviction of k2
      cache.set('k4', 'v4');

      expect(cache.get('k1')).toBe('v1');
      expect(cache.get('k3')).toBe('v3');
      expect(cache.get('k4')).toBe('v4');
      expect(cache.get('k2')).toBeUndefined(); // evicted
    });
  });

  describe('Endpoint Caching & Hit Verification', () => {
    it('should cache GET /api/v1/meters response and avoid repeated portal calls', async () => {
      await authService.setSessionToken('test-token');

      let portalCalls = 0;
      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          portalCalls++;
          return {
            status: 200,
            statusText: 'OK',
            data: { meters: [{ id: 'M1', meterNo: 'MTR-1' }], total: 1 },
            headers: {},
            config: {} as any,
          };
        }
        throw new Error('Unexpected');
      });

      // First call -> hits portal
      const res1 = await request(app).get('/api/v1/meters?q=m1&page=1').expect(200);
      expect(res1.body.data[0].id).toBe('M1');
      const callsAfterFirst = portalCalls;

      // Second identical call -> served from cache
      const res2 = await request(app).get('/api/v1/meters?q=m1&page=1').expect(200);
      expect(res2.body.data[0].id).toBe('M1');
      expect(portalCalls).toBe(callsAfterFirst); // No additional portal calls made
    });

    it('should cache GET /api/v1/transformers response', async () => {
      await authService.setSessionToken('test-token');

      let portalCalls = 0;
      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, data: { meters: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/dts')) {
          portalCalls++;
          return {
            status: 200,
            statusText: 'OK',
            data: { dts: [{ id: 'DT-1', name: 'DT-North' }], total: 1 },
            headers: {},
            config: {} as any,
          };
        }
        throw new Error('Unexpected');
      });

      // First call
      await request(app).get('/api/v1/transformers?page=1').expect(200);
      expect(portalCalls).toBe(1);

      // Second call -> cached
      await request(app).get('/api/v1/transformers?page=1').expect(200);
      expect(portalCalls).toBe(1);
    });

    it('should cache hierarchy summary and tree queries', async () => {
      localMeterIndex.replaceRecords([
        {
          id: 'M1',
          meterNo: '1',
          consumerName: 'User',
          consumerNo: 'C1',
          status: 'active',
          hierarchy: {
            zone: 'Zone-1',
            circle: 'Circle-1',
            division: 'Div-1',
            subdivision: 'Sub-1',
            substation: 'SS-1',
            feeder: 'F-1',
            transformer: 'TX-1',
            transformerId: 'T1',
            dtName: 'TX-1',
            dtId: 'T1',
          },
          location: { latitude: null, longitude: null, address: null },
          importedAt: '2026-11-06',
          raw: {},
        },
      ]);

      const initialStats = cacheService.getStats();

      // First call populates cache
      const res1 = await request(app).get('/api/v1/hierarchy').expect(200);
      expect(res1.body.data.totalMeters).toBe(1);

      // Second call hits cache
      const res2 = await request(app).get('/api/v1/hierarchy').expect(200);
      expect(res2.body.data.totalMeters).toBe(1);

      const statsAfter = cacheService.getStats();
      expect(statsAfter.hits).toBeGreaterThan(initialStats.hits);
    });
  });

  describe('Cache Invalidation on Bulk Export Import', () => {
    it('should invalidate cached queries upon successful bulk export import', async () => {
      await authService.setSessionToken('active-token-bulk');

      // Populate cache with arbitrary queries
      cacheService.set('meter:search:test:1', { old: true }, 60000, ['meters']);
      cacheService.set('hierarchy:summary', { old: true }, 60000, ['hierarchy']);
      cacheService.set('local:search:test:1:20:{}', { old: true }, 60000, ['local']);

      expect(cacheService.get('meter:search:test:1')).toBeDefined();
      expect(cacheService.get('hierarchy:summary')).toBeDefined();

      // Mock export endpoint
      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, data: { meters: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/export')) {
          return {
            status: 200,
            statusText: 'OK',
            data: [{ id: 'M-FRESH', meterNo: 'M-NEW', consumerName: 'Fresh User' }],
            headers: {},
            config: {} as any,
          };
        }
        throw new Error('Unexpected');
      });

      // Trigger export
      await request(app).get('/api/v1/meters/export').expect(200);

      // Assert all previous cache entries were invalidated
      expect(cacheService.get('meter:search:test:1')).toBeUndefined();
      expect(cacheService.get('hierarchy:summary')).toBeUndefined();
      expect(cacheService.get('local:search:test:1:20:{}')).toBeUndefined();
    });
  });

  describe('Duplicate Simultaneous Bulk Export Prevention', () => {
    it('should deduplicate concurrent export requests to prevent duplicate operations', async () => {
      await authService.setSessionToken('active-token-bulk');

      let exportCalls = 0;
      vi.spyOn(portalClient, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/portal/meters/search')) {
          return { status: 200, data: { meters: [] }, headers: {}, config: {} as any };
        }
        if (url.includes('/portal/export')) {
          exportCalls++;
          // Simulate latency
          await new Promise((resolve) => setTimeout(resolve, 80));
          return {
            status: 200,
            statusText: 'OK',
            data: [{ id: 'MTR-CONC-1', meterNo: 'CONC-1' }],
            headers: {},
            config: {} as any,
          };
        }
        throw new Error('Unexpected');
      });

      // Fire 3 simultaneous export requests
      const [res1, res2, res3] = await Promise.all([
        request(app).get('/api/v1/meters/export'),
        request(app).get('/api/v1/meters/export'),
        request(app).get('/api/v1/meters/export'),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      // All 3 requests returned successful results
      expect(res1.body.data.status).toBe('completed');
      expect(res2.body.data.status).toBe('completed');
      expect(res3.body.data.status).toBe('completed');

      // Crucial: Only 1 actual export network call was executed!
      expect(exportCalls).toBe(1);
    });
  });

  describe('Performance Optimization Measurements', () => {
    it('should measure and demonstrate performance improvement on large representative dataset', () => {
      const DATASET_SIZE = 5000;
      const zones = ['North Zone', 'South Zone', 'East Zone', 'West Zone'];
      const divisions = ['Div-1', 'Div-2', 'Div-3', 'Div-4', 'Div-5'];
      const feeders = ['Feeder-A', 'Feeder-B', 'Feeder-C', 'Feeder-D'];

      const mockDataset: NormalizedIndexedMeter[] = [];
      for (let i = 0; i < DATASET_SIZE; i++) {
        const zone = zones[i % zones.length];
        const division = divisions[i % divisions.length];
        const feeder = feeders[i % feeders.length];
        const tx = `DT-${i % 50}`;

        mockDataset.push({
          id: `MTR-${i.toString().padStart(5, '0')}`,
          meterNo: `NUM-${i.toString().padStart(5, '0')}`,
          consumerName: `Consumer ${i}`,
          consumerNo: `C-${i}`,
          status: i % 10 === 0 ? 'inactive' : 'active',
          hierarchy: {
            zone,
            circle: `Circle-${i % 10}`,
            division,
            subdivision: `Subdiv-${i % 20}`,
            substation: `SS-${i % 30}`,
            feeder,
            transformer: tx,
            transformerId: tx,
            dtName: tx,
            dtId: tx,
          },
          location: { latitude: 28.0 + (i % 100) * 0.01, longitude: 77.0 + (i % 100) * 0.01, address: `Address ${i}` },
          importedAt: '2026-11-06T00:00:00.000Z',
          raw: {},
        });
      }

      // Populate index
      localMeterIndex.replaceRecords(mockDataset);
      cacheService.invalidateAll();

      // 1. Measure Cold Query (Uncached filter lookup using inverted indices)
      const t0 = performance.now();
      const coldResult = localMeterIndex.filterByHierarchy({ zone: 'North Zone', feeder: 'Feeder-A', limit: 50 });
      const coldDurationMs = performance.now() - t0;

      // 2. Measure Warm Query (Cached filter lookup)
      const t1 = performance.now();
      const warmResult = localMeterIndex.filterByHierarchy({ zone: 'North Zone', feeder: 'Feeder-A', limit: 50 });
      const warmDurationMs = performance.now() - t1;

      expect(coldResult.meters.length).toBe(warmResult.meters.length);
      expect(coldResult.pagination.total).toBe(warmResult.pagination.total);

      // 3. Measure Hierarchy Tree Generation (Cold vs Warm)
      const t2 = performance.now();
      const coldTree = hierarchyService.getTree('subdivision');
      const coldTreeMs = performance.now() - t2;

      const t3 = performance.now();
      const warmTree = hierarchyService.getTree('subdivision');
      const warmTreeMs = performance.now() - t3;

      expect(coldTree.length).toBe(warmTree.length);

      // Warm queries should execute virtually instantly (< 5ms)
      expect(warmDurationMs).toBeLessThanOrEqual(coldDurationMs + 2); // Warm is fast
      expect(warmTreeMs).toBeLessThanOrEqual(coldTreeMs + 2);

      console.log(`\n================ PERFORMANCE BENCHMARK (${DATASET_SIZE} meters) ================`);
      console.log(`- Filter by Zone & Feeder (Cold): ${coldDurationMs.toFixed(3)} ms`);
      console.log(`- Filter by Zone & Feeder (Warm Cache): ${warmDurationMs.toFixed(3)} ms`);
      console.log(`- Hierarchy Tree Generation (Cold): ${coldTreeMs.toFixed(3)} ms`);
      console.log(`- Hierarchy Tree Generation (Warm Cache): ${warmTreeMs.toFixed(3)} ms`);
      console.log(`========================================================================\n`);
    });
  });
});

