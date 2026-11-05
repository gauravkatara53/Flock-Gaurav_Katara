import { z } from 'zod';
import { NormalizedIndexedMeter, LocalSearchPaginationMeta } from './export.types';

// Network hierarchy order: Zone -> Circle -> Division -> Subdivision -> Substation -> Feeder -> Transformer -> Meter
export const HIERARCHY_LEVELS = [
  'zone',
  'circle',
  'division',
  'subdivision',
  'substation',
  'feeder',
  'transformer',
  'meter',
] as const;

export type HierarchyLevel = (typeof HIERARCHY_LEVELS)[number];

export const HierarchyLevelEnum = z.enum(HIERARCHY_LEVELS);

export const HierarchyNavigationQuerySchema = z.object({
  level: HierarchyLevelEnum,
  zone: z.string().optional(),
  circle: z.string().optional(),
  division: z.string().optional(),
  subdivision: z.string().optional(),
  substation: z.string().optional(),
  feeder: z.string().optional(),
  transformer: z.string().optional(),
});

export const HierarchyFilterCriteriaSchema = z.object({
  zone: z.string().optional(),
  circle: z.string().optional(),
  division: z.string().optional(),
  subdivision: z.string().optional(),
  substation: z.string().optional(),
  feeder: z.string().optional(),
  transformer: z.string().optional(),
  page: z
    .string()
    .default('1')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(10000)),
  limit: z
    .string()
    .default('20')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(1000)),
});

export const TransformerMetersParamSchema = z.object({
  transformerId: z
    .string()
    .min(1, 'transformerId parameter is required')
    .max(100, 'transformerId parameter is too long'),
});

export const TransformerMetersQuerySchema = z.object({
  page: z
    .string()
    .default('1')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(10000)),
  limit: z
    .string()
    .default('20')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(1000)),
});

export const HierarchyTreeQuerySchema = z.object({
  depth: HierarchyLevelEnum.default('transformer'),
});

export type HierarchyNavigationQuery = z.infer<typeof HierarchyNavigationQuerySchema>;
export type HierarchyFilterCriteria = z.infer<typeof HierarchyFilterCriteriaSchema>;
export type TransformerMetersParam = z.infer<typeof TransformerMetersParamSchema>;
export type TransformerMetersQuery = z.infer<typeof TransformerMetersQuerySchema>;
export type HierarchyTreeQuery = z.infer<typeof HierarchyTreeQuerySchema>;

export interface HierarchySummary {
  levels: Record<HierarchyLevel, number>;
  totalMeters: number;
}

export interface HierarchyNavigationNode {
  name: string;
  level: HierarchyLevel;
  meterCount: number;
  childCount?: number;
  parent?: Partial<Record<HierarchyLevel, string>>;
}

export interface HierarchyTreeNode {
  name: string;
  level: HierarchyLevel;
  meterCount: number;
  children?: HierarchyTreeNode[];
  meters?: string[];
}

export interface TransformerMetersResult {
  transformer: string;
  transformerId?: string | null;
  meters: NormalizedIndexedMeter[];
  pagination: LocalSearchPaginationMeta;
}

