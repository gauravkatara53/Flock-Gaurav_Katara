import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { localMeterIndex } from '../src/services/local-index.service';
import { NormalizedIndexedMeter } from '../src/types/export.types';

describe('Phase 4 — Network Hierarchy APIs', () => {
  const sampleMeters: NormalizedIndexedMeter[] = [
    {
      id: 'MTR-001',
      meterNo: 'NUM-001',
      consumerName: 'Aarav Sharma',
      consumerNo: 'CONS-001',
      status: 'active',
      hierarchy: {
        zone: 'North Zone',
        circle: 'Delhi Circle',
        division: 'Central Division',
        subdivision: 'Subdivision-A',
        substation: 'Substation-1',
        feeder: 'Feeder-11',
        transformer: 'DT-Alpha',
        transformerId: 'TX-101',
        dtName: 'DT-Alpha',
        dtId: 'TX-101',
      },
      location: { latitude: 28.6139, longitude: 77.209, address: 'Connaught Place' },
      importedAt: '2026-11-06T00:00:00.000Z',
      raw: {},
    },
    {
      id: 'MTR-002',
      meterNo: 'NUM-002',
      consumerName: 'Vivaan Patel',
      consumerNo: 'CONS-002',
      status: 'active',
      hierarchy: {
        zone: 'North Zone',
        circle: 'Delhi Circle',
        division: 'Central Division',
        subdivision: 'Subdivision-A',
        substation: 'Substation-1',
        feeder: 'Feeder-11',
        transformer: 'DT-Alpha',
        transformerId: 'TX-101',
        dtName: 'DT-Alpha',
        dtId: 'TX-101',
      },
      location: { latitude: 28.6145, longitude: 77.2095, address: 'Barakhamba Road' },
      importedAt: '2026-11-06T00:00:00.000Z',
      raw: {},
    },
    {
      id: 'MTR-003',
      meterNo: 'NUM-003',
      consumerName: 'Diya Verma',
      consumerNo: 'CONS-003',
      status: 'active',
      hierarchy: {
        zone: 'North Zone',
        circle: 'Delhi Circle',
        division: 'Central Division',
        subdivision: 'Subdivision-A',
        substation: 'Substation-1',
        feeder: 'Feeder-12',
        transformer: 'DT-Beta',
        transformerId: 'TX-102',
        dtName: 'DT-Beta',
        dtId: 'TX-102',
      },
      location: { latitude: 28.62, longitude: 77.21, address: 'Janpath' },
      importedAt: '2026-11-06T00:00:00.000Z',
      raw: {},
    },
    {
      id: 'MTR-004',
      meterNo: 'NUM-004',
      consumerName: 'Ishaan Iyer',
      consumerNo: 'CONS-004',
      status: 'inactive',
      hierarchy: {
        zone: 'South Zone',
        circle: 'Bengaluru Circle',
        division: 'East Division',
        subdivision: 'Indiranagar Subdivision',
        substation: 'Substation-2',
        feeder: 'Feeder-21',
        transformer: 'DT-Gamma',
        transformerId: 'TX-201',
        dtName: 'DT-Gamma',
        dtId: 'TX-201',
      },
      location: { latitude: 12.9784, longitude: 77.6408, address: '100ft Road Indiranagar' },
      importedAt: '2026-11-06T00:00:00.000Z',
      raw: {},
    },
    {
      id: 'MTR-005',
      meterNo: 'NUM-005',
      consumerName: 'Ananya Nair',
      consumerNo: 'CONS-005',
      status: 'active',
      hierarchy: {
        zone: 'South Zone',
        circle: 'Bengaluru Circle',
        division: 'East Division',
        subdivision: 'Indiranagar Subdivision',
        substation: null, // Test missing field handling
        feeder: 'Feeder-22',
        transformer: 'DT-Delta',
        transformerId: 'TX-202',
        dtName: 'DT-Delta',
        dtId: 'TX-202',
      },
      location: { latitude: 12.9716, longitude: 77.5946, address: 'MG Road' },
      importedAt: '2026-11-06T00:00:00.000Z',
      raw: {},
    },
  ];

  beforeEach(() => {
    localMeterIndex.clear();
    localMeterIndex.replaceRecords(sampleMeters);
  });

  afterEach(() => {
    localMeterIndex.clear();
  });

  describe('GET /api/v1/hierarchy — Summary Statistics', () => {
    it('should return statistical counts across all 8 hierarchy tiers', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalMeters).toBe(5);
      expect(response.body.data.levels).toEqual({
        zone: 2, // North Zone, South Zone
        circle: 2, // Delhi Circle, Bengaluru Circle
        division: 2, // Central Division, East Division
        subdivision: 2, // Subdivision-A, Indiranagar Subdivision
        substation: 2, // Substation-1, Substation-2 (null ignored)
        feeder: 4, // Feeder-11, Feeder-12, Feeder-21, Feeder-22
        transformer: 4, // DT-Alpha, DT-Beta, DT-Gamma, DT-Delta
        meter: 5,
      });
    });

    it('should return zero counts when local index is empty', async () => {
      localMeterIndex.clear();

      const response = await request(app)
        .get('/api/v1/hierarchy')
        .expect(200);

      expect(response.body.data.totalMeters).toBe(0);
      expect(response.body.data.levels.zone).toBe(0);
      expect(response.body.data.levels.transformer).toBe(0);
    });
  });

  describe('GET /api/v1/hierarchy/children — Navigation', () => {
    it('should list all root zones when level=zone', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/children?level=zone')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map((n: any) => n.name)).toEqual(['North Zone', 'South Zone']);
      expect(response.body.data[0].meterCount).toBe(3); // North Zone has 3 meters
      expect(response.body.data[1].meterCount).toBe(2); // South Zone has 2 meters
    });

    it('should list circles within a specific zone', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/children?level=circle&zone=North%20Zone')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Delhi Circle');
      expect(response.body.data[0].meterCount).toBe(3);
    });

    it('should list feeders under a specific division', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/children?level=feeder&division=Central%20Division')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map((n: any) => n.name)).toEqual(['Feeder-11', 'Feeder-12']);
    });

    it('should list transformers under a specific feeder', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/children?level=transformer&feeder=Feeder-11')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('DT-Alpha');
      expect(response.body.data[0].meterCount).toBe(2);
    });

    it('should list meters under a specific transformer', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/children?level=meter&transformer=DT-Alpha')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map((n: any) => n.name)).toEqual(['MTR-001', 'MTR-002']);
    });

    it('should return empty list when parent scope has no match', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/children?level=circle&zone=NonexistentZone')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });

    it('should return 400 for invalid level parameter', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/children?level=invalid_tier')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/hierarchy/tree — Hierarchy Tree', () => {
    it('should return multi-tier tree down to transformer depth by default', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/tree')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2); // North Zone, South Zone

      const northZone = response.body.data.find((n: any) => n.name === 'North Zone');
      expect(northZone).toBeDefined();
      expect(northZone.level).toBe('zone');
      expect(northZone.children).toBeDefined();
      expect(northZone.children[0].name).toBe('Delhi Circle');
    });

    it('should return shallow tree when depth=zone', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/tree?depth=zone')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0].children).toBeUndefined();
    });

    it('should return tree down to meter depth with meter IDs', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/tree?depth=meter')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it('should return 400 for invalid depth parameter', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/tree?depth=galaxy')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/hierarchy/meters — Meter Filtering', () => {
    it('should filter meters by zone', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/meters?zone=North%20Zone')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
      expect(response.body.pagination.total).toBe(3);
      expect(response.body.data.every((m: any) => m.hierarchy.zone === 'North Zone')).toBe(true);
    });

    it('should filter meters by circle', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/meters?circle=Bengaluru%20Circle')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.every((m: any) => m.hierarchy.circle === 'Bengaluru Circle')).toBe(true);
    });

    it('should filter meters by division', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/meters?division=Central%20Division')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(3);
    });

    it('should filter meters by feeder', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/meters?feeder=Feeder-11')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map((m: any) => m.id)).toEqual(['MTR-001', 'MTR-002']);
    });

    it('should filter meters by transformer name or ID', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/meters?transformer=TX-101')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
    });

    it('should support combined hierarchy filters', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/meters?zone=North%20Zone&feeder=Feeder-12')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe('MTR-003');
    });

    it('should paginate filtered results', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/meters?zone=North%20Zone&page=1&limit=2')
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

    it('should return empty results when no meters match filter', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/meters?zone=Nonexistent')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });

    it('should return 400 for invalid page query', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/meters?page=-1')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/transformers/:transformerId/meters — Transformer Meters', () => {
    it('should retrieve all meters associated with a transformer by transformer ID', async () => {
      const response = await request(app)
        .get('/api/v1/transformers/TX-101/meters')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.transformer).toBe('DT-Alpha');
      expect(response.body.pagination.total).toBe(2);
      expect(response.body.data.map((m: any) => m.id)).toEqual(['MTR-001', 'MTR-002']);
    });

    it('should retrieve all meters associated with a transformer by transformer name', async () => {
      const response = await request(app)
        .get('/api/v1/transformers/DT-Beta/meters')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe('MTR-003');
    });

    it('should also work on alias route /api/v1/hierarchy/transformers/:transformerId/meters', async () => {
      const response = await request(app)
        .get('/api/v1/hierarchy/transformers/TX-201/meters')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe('MTR-004');
    });

    it('should return empty list when transformer has no meters', async () => {
      const response = await request(app)
        .get('/api/v1/transformers/UNKNOWN-TX/meters')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
      expect(response.body.pagination.total).toBe(0);
    });

    it('should paginate transformer meters', async () => {
      const response = await request(app)
        .get('/api/v1/transformers/TX-101/meters?page=1&limit=1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.pagination.total).toBe(2);
      expect(response.body.pagination.totalPages).toBe(2);
    });
  });

  describe('GET /api/v1/meters/local with hierarchy filters', () => {
    it('should filter local meters by feeder and zone', async () => {
      const response = await request(app)
        .get('/api/v1/meters/local?zone=South%20Zone&feeder=Feeder-21')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe('MTR-004');
    });
  });
});

