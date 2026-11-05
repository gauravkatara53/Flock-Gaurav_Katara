import { z } from 'zod';

export const LocalMeterSearchQuerySchema = z.object({
  q: z.string().default(''),
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

export const LocalMeterIdParamSchema = z.object({
  meterId: z
    .string()
    .min(1, 'meterId parameter is required')
    .max(100, 'meterId parameter is too long'),
});

export const ExportTriggerQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 1))
    .pipe(z.number().int().positive().max(10000)),
  source: z.string().optional(),
  sync: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

export type LocalMeterSearchQuery = z.infer<typeof LocalMeterSearchQuerySchema>;
export type LocalMeterIdParam = z.infer<typeof LocalMeterIdParamSchema>;
export type ExportTriggerQuery = z.infer<typeof ExportTriggerQuerySchema>;

// Indexed meter model
export interface MeterHierarchy {
  zone: string | null;
  circle: string | null;
  division: string | null;
  subdivision: string | null;
  substation: string | null;
  feeder: string | null;
  transformer: string | null;
  transformerId: string | null;
  dtName: string | null;
  dtId: string | null;
}

export interface MeterCoordinates {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export interface NormalizedIndexedMeter {
  id: string;
  meterNo: string | null;
  consumerName: string | null;
  consumerNo: string | null;
  status: string | null;
  manufacturer?: string | null;
  phase?: string | null;
  hierarchy: MeterHierarchy;
  location: MeterCoordinates;
  importedAt: string;
  raw: Record<string, unknown>;
}

export type ExportOperationState = 'idle' | 'in_progress' | 'completed' | 'failed';

export interface ExportStatus {
  status: ExportOperationState;
  lastSuccessfulRefresh: string | null;
  lastAttempt: string | null;
  totalIndexed: number;
  importedCount: number;
  lastError: string | null;
}

export interface ExportResult {
  importedCount: number;
  totalIndexed: number;
  timestamp: string;
  status: ExportOperationState;
}

export interface LocalSearchPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Raw portal export response types
export interface PortalExportMeterRecord {
  id?: string | number;
  meterId?: string | number;
  meterNo?: string | number;
  consumerName?: string;
  consumerNo?: string | number;
  status?: string;
  zone?: string;
  circle?: string;
  division?: string;
  subdivision?: string;
  substation?: string;
  feeder?: string;
  transformer?: string;
  transformerName?: string;
  transformerId?: string | number;
  dtName?: string;
  dtId?: string | number;
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  lon?: number | string;
  address?: string;
  location?: {
    latitude?: number | string;
    longitude?: number | string;
    lat?: number | string;
    lng?: number | string;
    lon?: number | string;
    address?: string;
    [key: string]: unknown;
  };
  hierarchy?: {
    zone?: string;
    circle?: string;
    division?: string;
    subdivision?: string;
    substation?: string;
    feeder?: string;
    transformer?: string;
    transformerName?: string;
    transformerId?: string | number;
    dtName?: string;
    dtId?: string | number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PortalBulkExportResponse {
  meters?: PortalExportMeterRecord[];
  data?: PortalExportMeterRecord[];
  records?: PortalExportMeterRecord[];
  items?: PortalExportMeterRecord[];
  total?: number;
  totalCount?: number;
  page?: number;
  totalPages?: number;
  [key: string]: unknown;
}

