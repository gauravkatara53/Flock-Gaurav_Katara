import { LocalMeterIndex, localMeterIndex } from './local-index.service';
import {
  HierarchyLevel,
  HierarchyNavigationQuery,
  HierarchyFilterCriteria,
  HierarchySummary,
  HierarchyNavigationNode,
  HierarchyTreeNode,
  TransformerMetersResult,
} from '../types/hierarchy.types';
import { NormalizedIndexedMeter, LocalSearchPaginationMeta } from '../types/export.types';
import { cacheService, CacheService } from './cache.service';
import { logger } from '../utils/logger';

export interface IHierarchyService {
  getSummary(): HierarchySummary;
  getChildren(query: HierarchyNavigationQuery): HierarchyNavigationNode[];
  getTree(depth?: HierarchyLevel): HierarchyTreeNode[];
  filterMeters(
    criteria: HierarchyFilterCriteria
  ): { meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta };
  getTransformerMeters(
    transformerId: string,
    page: number,
    limit: number
  ): TransformerMetersResult;
}

export class HierarchyService implements IHierarchyService {
  private readonly index: LocalMeterIndex;
  private readonly cache: CacheService;

  constructor(index: LocalMeterIndex = localMeterIndex, cache: CacheService = cacheService) {
    this.index = index;
    this.cache = cache;
  }

  getSummary(): HierarchySummary {
    const cacheKey = 'hierarchy:summary';
    const cached = this.cache.get<HierarchySummary>(cacheKey);
    if (cached) {
      return cached;
    }

    const all = this.index.getAll();

    const zones = new Set<string>();
    const circles = new Set<string>();
    const divisions = new Set<string>();
    const subdivisions = new Set<string>();
    const substations = new Set<string>();
    const feeders = new Set<string>();
    const transformers = new Set<string>();

    for (const meter of all) {
      const h = meter.hierarchy;
      if (h.zone) zones.add(h.zone.toLowerCase());
      if (h.circle) circles.add(h.circle.toLowerCase());
      if (h.division) divisions.add(h.division.toLowerCase());
      if (h.subdivision) subdivisions.add(h.subdivision.toLowerCase());
      if (h.substation) substations.add(h.substation.toLowerCase());
      if (h.feeder) feeders.add(h.feeder.toLowerCase());
      const t = h.transformer || h.transformerId || h.dtName || h.dtId;
      if (t) transformers.add(t.toLowerCase());
    }

    const summary: HierarchySummary = {
      levels: {
        zone: zones.size,
        circle: circles.size,
        division: divisions.size,
        subdivision: subdivisions.size,
        substation: substations.size,
        feeder: feeders.size,
        transformer: transformers.size,
        meter: all.length,
      },
      totalMeters: all.length,
    };

    this.cache.set(cacheKey, summary, undefined, ['hierarchy']);
    return summary;
  }

  getChildren(query: HierarchyNavigationQuery): HierarchyNavigationNode[] {
    const cacheKey = `hierarchy:children:${JSON.stringify(query)}`;
    const cached = this.cache.get<HierarchyNavigationNode[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const all = this.index.getAll();
    const targetLevel = query.level;

    const matchingMeters = all.filter((meter) => this.matchesParentScope(meter, query));
    const grouped = new Map<string, { meterCount: number; originalName: string }>();

    for (const meter of matchingMeters) {
      const val = this.extractLevelValue(meter, targetLevel);
      if (!val) continue;

      const key = val.toLowerCase();
      const existing = grouped.get(key);
      if (existing) {
        existing.meterCount++;
      } else {
        grouped.set(key, { meterCount: 1, originalName: val });
      }
    }

    const nodes: HierarchyNavigationNode[] = [];

    for (const [, { originalName, meterCount }] of grouped) {
      nodes.push({
        name: originalName,
        level: targetLevel,
        meterCount,
        parent: this.extractCurrentScope(query),
      });
    }

    const result = nodes.sort((a, b) => a.name.localeCompare(b.name));
    this.cache.set(cacheKey, result, undefined, ['hierarchy']);
    return result;
  }

  getTree(depth: HierarchyLevel = 'transformer'): HierarchyTreeNode[] {
    const cacheKey = `hierarchy:tree:${depth}`;
    const cached = this.cache.get<HierarchyTreeNode[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const all = this.index.getAll();
    if (all.length === 0) return [];

    logger.debug(`[HierarchyService] Building tree to depth: ${depth}`);

    const levelOrder: HierarchyLevel[] = [
      'zone',
      'circle',
      'division',
      'subdivision',
      'substation',
      'feeder',
      'transformer',
      'meter',
    ];

    const targetDepthIndex = levelOrder.indexOf(depth);
    const effectiveDepthIndex = targetDepthIndex >= 0 ? targetDepthIndex : 6;

    const tree = this.buildTreeLevel(all, 0, effectiveDepthIndex, levelOrder);
    this.cache.set(cacheKey, tree, undefined, ['hierarchy']);
    return tree;
  }

  private buildTreeLevel(
    meters: NormalizedIndexedMeter[],
    currentLevelIdx: number,
    maxLevelIdx: number,
    levelOrder: HierarchyLevel[]
  ): HierarchyTreeNode[] {
    if (currentLevelIdx > maxLevelIdx) {
      return [];
    }

    const currentLevel = levelOrder[currentLevelIdx];

    if (currentLevel === 'meter') {
      return meters.map((m) => ({
        name: m.consumerName || m.meterNo || m.id,
        level: 'meter',
        meterCount: 1,
        meters: [m.id],
      }));
    }

    const grouped = new Map<string, { originalName: string; meters: NormalizedIndexedMeter[] }>();

    for (const meter of meters) {
      const val = this.extractLevelValue(meter, currentLevel) || 'Unassigned';
      const key = val.toLowerCase();
      let entry = grouped.get(key);
      if (!entry) {
        entry = { originalName: val, meters: [] };
        grouped.set(key, entry);
      }
      entry.meters.push(meter);
    }

    const nodes: HierarchyTreeNode[] = [];

    for (const [, { originalName, meters: childMeters }] of grouped) {
      const children =
        currentLevelIdx < maxLevelIdx
          ? this.buildTreeLevel(childMeters, currentLevelIdx + 1, maxLevelIdx, levelOrder)
          : undefined;

      nodes.push({
        name: originalName,
        level: currentLevel,
        meterCount: childMeters.length,
        ...(children && children.length > 0 ? { children } : {}),
      });
    }

    return nodes.sort((a, b) => a.name.localeCompare(b.name));
  }

  filterMeters(
    criteria: HierarchyFilterCriteria
  ): { meters: NormalizedIndexedMeter[]; pagination: LocalSearchPaginationMeta } {
    return this.index.filterByHierarchy(criteria);
  }

  getTransformerMeters(
    transformerId: string,
    page: number = 1,
    limit: number = 20
  ): TransformerMetersResult {
    const result = this.index.getMetersByTransformer(transformerId, page, limit);

    return {
      transformer: result.transformerName,
      transformerId,
      meters: result.meters,
      pagination: result.pagination,
    };
  }

  private extractLevelValue(meter: NormalizedIndexedMeter, level: HierarchyLevel): string | null {
    const h = meter.hierarchy;
    switch (level) {
      case 'zone':
        return h.zone;
      case 'circle':
        return h.circle;
      case 'division':
        return h.division;
      case 'subdivision':
        return h.subdivision;
      case 'substation':
        return h.substation;
      case 'feeder':
        return h.feeder;
      case 'transformer':
        return h.transformer || h.dtName || h.transformerId || h.dtId;
      case 'meter':
        return meter.id;
      default:
        return null;
    }
  }

  private matchesParentScope(meter: NormalizedIndexedMeter, scope: HierarchyNavigationQuery): boolean {
    const h = meter.hierarchy;

    if (scope.zone && (!h.zone || h.zone.toLowerCase() !== scope.zone.trim().toLowerCase())) {
      return false;
    }
    if (scope.circle && (!h.circle || h.circle.toLowerCase() !== scope.circle.trim().toLowerCase())) {
      return false;
    }
    if (scope.division && (!h.division || h.division.toLowerCase() !== scope.division.trim().toLowerCase())) {
      return false;
    }
    if (
      scope.subdivision &&
      (!h.subdivision || h.subdivision.toLowerCase() !== scope.subdivision.trim().toLowerCase())
    ) {
      return false;
    }
    if (
      scope.substation &&
      (!h.substation || h.substation.toLowerCase() !== scope.substation.trim().toLowerCase())
    ) {
      return false;
    }
    if (scope.feeder && (!h.feeder || h.feeder.toLowerCase() !== scope.feeder.trim().toLowerCase())) {
      return false;
    }
    if (scope.transformer) {
      const targetT = scope.transformer.trim().toLowerCase();
      const matchT =
        (h.transformer && h.transformer.toLowerCase() === targetT) ||
        (h.transformerId && h.transformerId.toLowerCase() === targetT) ||
        (h.dtName && h.dtName.toLowerCase() === targetT) ||
        (h.dtId && h.dtId.toLowerCase() === targetT);
      if (!matchT) return false;
    }

    return true;
  }

  private extractCurrentScope(query: HierarchyNavigationQuery): Partial<Record<HierarchyLevel, string>> {
    const scope: Partial<Record<HierarchyLevel, string>> = {};
    if (query.zone) scope.zone = query.zone;
    if (query.circle) scope.circle = query.circle;
    if (query.division) scope.division = query.division;
    if (query.subdivision) scope.subdivision = query.subdivision;
    if (query.substation) scope.substation = query.substation;
    if (query.feeder) scope.feeder = query.feeder;
    if (query.transformer) scope.transformer = query.transformer;
    return scope;
  }
}

export const hierarchyService = new HierarchyService(localMeterIndex, cacheService);
