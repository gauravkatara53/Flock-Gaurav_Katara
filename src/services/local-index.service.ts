import {
  NormalizedIndexedMeter,
  LocalSearchPaginationMeta,
} from '../types/export.types';
import { HierarchyFilterCriteria } from '../types/hierarchy.types';
import { cacheService, CacheService } from './cache.service';
import { logger } from '../utils/logger';

export interface LocalSearchOptions {
  query?: string;
  zone?: string;
  circle?: string;
  division?: string;
  subdivision?: string;
  substation?: string;
  feeder?: string;
  transformer?: string;
  page?: number;
  limit?: number;
}

export interface ILocalMeterIndex {
  getById(idOrMeterNo: string): NormalizedIndexedMeter | null;
  search(
    queryOrOptions: string | LocalSearchOptions,
    page?: number,
    limit?: number
  ): { meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta };
  filterByHierarchy(
    criteria: HierarchyFilterCriteria
  ): { meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta };
  getMetersByTransformer(
    transformerIdOrName: string,
    page: number,
    limit: number
  ): { meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta; transformerName: string };
  replaceRecords(records: NormalizedIndexedMeter[]): number;
  upsertRecords(records: NormalizedIndexedMeter[]): number;
  count(): number;
  getAll(): NormalizedIndexedMeter[];
  clear(): void;
}

interface IndexedEntry {
  meter: NormalizedIndexedMeter;
  searchTokens: string;
}

/**
 * In-memory index supporting fast substring search and inverted hierarchy lookups.
 */
export class LocalMeterIndex implements ILocalMeterIndex {
  private recordsById: Map<string, IndexedEntry> = new Map();
  private idByMeterNo: Map<string, string> = new Map();

  // Inverted hierarchy indexes for fast tier filtering
  private idsByZone: Map<string, Set<string>> = new Map();
  private idsByCircle: Map<string, Set<string>> = new Map();
  private idsByDivision: Map<string, Set<string>> = new Map();
  private idsBySubdivision: Map<string, Set<string>> = new Map();
  private idsBySubstation: Map<string, Set<string>> = new Map();
  private idsByFeeder: Map<string, Set<string>> = new Map();
  private idsByTransformer: Map<string, Set<string>> = new Map();

  private readonly cache: CacheService;

  constructor(cache: CacheService = cacheService) {
    this.cache = cache;
  }

  replaceRecords(records: NormalizedIndexedMeter[]): number {
    this.clearIndices();

    for (const record of records) {
      if (!record.id) continue;
      this.indexRecord(record);
    }

    this.cache.invalidateByTag('local');
    this.cache.invalidateByTag('hierarchy');

    logger.info(`[LocalMeterIndex] Optimized index built with ${this.recordsById.size} records`);
    return this.recordsById.size;
  }

  upsertRecords(records: NormalizedIndexedMeter[]): number {
    for (const record of records) {
      if (!record.id) continue;
      this.indexRecord(record);
    }

    this.cache.invalidateByTag('local');
    this.cache.invalidateByTag('hierarchy');

    logger.info(`[LocalMeterIndex] Index updated. Total records: ${this.recordsById.size}`);
    return this.recordsById.size;
  }

  private indexRecord(meter: NormalizedIndexedMeter): void {
    const id = meter.id;

    // Pre-join searchable text into lowercase tokens for quick substring scans
    const tokens = [
      id,
      meter.meterNo,
      meter.consumerName,
      meter.consumerNo,
      meter.status,
      meter.manufacturer,
      meter.phase,
      (meter.raw as any)?.make,
      (meter.raw as any)?.manufacturer,
      (meter.raw as any)?.phaseType,
      (meter.raw as any)?.phase,
      meter.hierarchy.zone,
      meter.hierarchy.circle,
      meter.hierarchy.division,
      meter.hierarchy.subdivision,
      meter.hierarchy.substation,
      meter.hierarchy.feeder,
      meter.hierarchy.transformer,
      meter.hierarchy.transformerId,
      meter.hierarchy.dtName,
      meter.hierarchy.dtId,
      meter.location.address,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    this.recordsById.set(id, { meter, searchTokens: tokens });

    if (meter.meterNo) {
      this.idByMeterNo.set(meter.meterNo.toLowerCase(), id);
    }

    const h = meter.hierarchy;
    if (h.zone) this.addToBucket(this.idsByZone, h.zone, id);
    if (h.circle) this.addToBucket(this.idsByCircle, h.circle, id);
    if (h.division) this.addToBucket(this.idsByDivision, h.division, id);
    if (h.subdivision) this.addToBucket(this.idsBySubdivision, h.subdivision, id);
    if (h.substation) this.addToBucket(this.idsBySubstation, h.substation, id);
    if (h.feeder) this.addToBucket(this.idsByFeeder, h.feeder, id);

    if (h.transformer) this.addToBucket(this.idsByTransformer, h.transformer, id);
    if (h.transformerId) this.addToBucket(this.idsByTransformer, h.transformerId, id);
    if (h.dtName) this.addToBucket(this.idsByTransformer, h.dtName, id);
    if (h.dtId) this.addToBucket(this.idsByTransformer, h.dtId, id);
  }

  private addToBucket(map: Map<string, Set<string>>, key: string, id: string): void {
    const normalizedKey = key.trim().toLowerCase();
    let set = map.get(normalizedKey);
    if (!set) {
      set = new Set();
      map.set(normalizedKey, set);
    }
    set.add(id);
  }

  getById(idOrMeterNo: string): NormalizedIndexedMeter | null {
    if (!idOrMeterNo) return null;

    const direct = this.recordsById.get(idOrMeterNo);
    if (direct) return direct.meter;

    const lowerTarget = idOrMeterNo.trim().toLowerCase();
    for (const [id, entry] of this.recordsById.entries()) {
      if (id.toLowerCase() === lowerTarget) return entry.meter;
    }

    const matchedId = this.idByMeterNo.get(lowerTarget);
    if (matchedId) {
      const entry = this.recordsById.get(matchedId);
      return entry ? entry.meter : null;
    }

    return null;
  }

  search(
    queryOrOptions: string | LocalSearchOptions,
    pageArg?: number,
    limitArg?: number
  ): { meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta } {
    let query = '';
    let page = pageArg ?? 1;
    let limit = limitArg ?? 20;
    let filters: HierarchyFilterCriteria | undefined;

    if (typeof queryOrOptions === 'string') {
      query = queryOrOptions;
    } else if (typeof queryOrOptions === 'object' && queryOrOptions !== null) {
      query = queryOrOptions.query || '';
      page = queryOrOptions.page ?? 1;
      limit = queryOrOptions.limit ?? 20;
      filters = {
        zone: queryOrOptions.zone,
        circle: queryOrOptions.circle,
        division: queryOrOptions.division,
        subdivision: queryOrOptions.subdivision,
        substation: queryOrOptions.substation,
        feeder: queryOrOptions.feeder,
        transformer: queryOrOptions.transformer,
        page,
        limit,
      };
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const normalizedQuery = query.trim().toLowerCase();

    const cacheKey = `local:search:${normalizedQuery}:${safePage}:${safeLimit}:${JSON.stringify(filters || {})}`;
    const cached = this.cache.get<{ meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta }>(cacheKey);
    if (cached) {
      return cached;
    }

    let candidateIds: Set<string> | null = this.resolveFilterCandidates(filters);
    const matches: NormalizedIndexedMeter[] = [];

    if (candidateIds) {
      for (const id of candidateIds) {
        const entry = this.recordsById.get(id);
        if (!entry) continue;

        if (normalizedQuery && !entry.searchTokens.includes(normalizedQuery)) {
          continue;
        }

        matches.push(entry.meter);
      }
    } else {
      for (const entry of this.recordsById.values()) {
        if (normalizedQuery && !entry.searchTokens.includes(normalizedQuery)) {
          continue;
        }

        matches.push(entry.meter);
      }
    }

    const total = matches.length;
    const totalPages = Math.ceil(total / safeLimit) || 1;
    const startIndex = (safePage - 1) * safeLimit;
    const paginatedMeters = matches.slice(startIndex, startIndex + safeLimit);

    const result = {
      meters: paginatedMeters,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
      },
    };

    this.cache.set(cacheKey, result, undefined, ['local']);
    return result;
  }

  filterByHierarchy(
    criteria: HierarchyFilterCriteria
  ): { meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta } {
    const page = criteria.page ?? 1;
    const limit = criteria.limit ?? 20;
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);

    const cacheKey = `local:filter:${safePage}:${safeLimit}:${JSON.stringify(criteria)}`;
    const cached = this.cache.get<{ meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta }>(cacheKey);
    if (cached) {
      return cached;
    }

    const candidateIds = this.resolveFilterCandidates(criteria);
    const matches: NormalizedIndexedMeter[] = [];

    if (candidateIds) {
      for (const id of candidateIds) {
        const entry = this.recordsById.get(id);
        if (entry) {
          matches.push(entry.meter);
        }
      }
    } else {
      for (const entry of this.recordsById.values()) {
        matches.push(entry.meter);
      }
    }

    const total = matches.length;
    const totalPages = Math.ceil(total / safeLimit) || 1;
    const startIndex = (safePage - 1) * safeLimit;
    const paginatedMeters = matches.slice(startIndex, startIndex + safeLimit);

    const result = {
      meters: paginatedMeters,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
      },
    };

    this.cache.set(cacheKey, result, undefined, ['local', 'hierarchy']);
    return result;
  }

  private resolveFilterCandidates(filters?: HierarchyFilterCriteria): Set<string> | null {
    if (!filters) return null;

    let result: Set<string> | null = null;

    const applyBucket = (bucketMap: Map<string, Set<string>>, value?: string) => {
      if (!value) return;
      const normalized = value.trim().toLowerCase();
      const ids = bucketMap.get(normalized) || new Set<string>();

      if (result === null) {
        result = new Set(ids);
      } else {
        for (const id of result) {
          if (!ids.has(id)) {
            result.delete(id);
          }
        }
      }
    };

    applyBucket(this.idsByZone, filters.zone);
    applyBucket(this.idsByCircle, filters.circle);
    applyBucket(this.idsByDivision, filters.division);
    applyBucket(this.idsBySubdivision, filters.subdivision);
    applyBucket(this.idsBySubstation, filters.substation);
    applyBucket(this.idsByFeeder, filters.feeder);
    applyBucket(this.idsByTransformer, filters.transformer);

    return result;
  }

  getMetersByTransformer(
    transformerIdOrName: string,
    page: number = 1,
    limit: number = 20
  ): { meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta; transformerName: string } {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, limit);
    const target = transformerIdOrName.trim().toLowerCase();

    const cacheKey = `local:tx:${target}:${safePage}:${safeLimit}`;
    const cached = this.cache.get<{
      meters: NormalizedIndexedMeter[];
      pagination: LocalSearchPaginationMeta;
      transformerName: string;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const matchedIds = this.idsByTransformer.get(target) || new Set<string>();
    const matches: NormalizedIndexedMeter[] = [];
    let matchedTransformerName = transformerIdOrName;

    for (const id of matchedIds) {
      const entry = this.recordsById.get(id);
      if (entry) {
        matches.push(entry.meter);
        const h = entry.meter.hierarchy;
        if (h.transformer) {
          matchedTransformerName = h.transformer;
        } else if (h.dtName) {
          matchedTransformerName = h.dtName;
        }
      }
    }

    const total = matches.length;
    const totalPages = Math.ceil(total / safeLimit) || 1;
    const startIndex = (safePage - 1) * safeLimit;
    const paginatedMeters = matches.slice(startIndex, startIndex + safeLimit);

    const result = {
      meters: paginatedMeters,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
      },
      transformerName: matchedTransformerName,
    };

    this.cache.set(cacheKey, result, undefined, ['local', 'hierarchy']);
    return result;
  }

  count(): number {
    return this.recordsById.size;
  }

  getAll(): NormalizedIndexedMeter[] {
    return Array.from(this.recordsById.values()).map((e) => e.meter);
  }

  clear(): void {
    this.clearIndices();
    this.cache.invalidateByTag('local');
    this.cache.invalidateByTag('hierarchy');
  }

  private clearIndices(): void {
    this.recordsById.clear();
    this.idByMeterNo.clear();
    this.idsByZone.clear();
    this.idsByCircle.clear();
    this.idsByDivision.clear();
    this.idsBySubdivision.clear();
    this.idsBySubstation.clear();
    this.idsByFeeder.clear();
    this.idsByTransformer.clear();
  }
}

export const localMeterIndex = new LocalMeterIndex(cacheService);
