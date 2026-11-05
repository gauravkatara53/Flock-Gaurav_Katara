import { z } from 'zod';

export const MeterSearchQuerySchema = z.object({
  q: z.string().default(''),
  page: z
    .string()
    .default('1')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(10000)),
});

export const MeterIdParamSchema = z.object({
  meterId: z
    .string()
    .min(1, 'meterId parameter is required')
    .max(100, 'meterId parameter is too long'),
});

export const TransformerListQuerySchema = z.object({
  page: z
    .string()
    .default('1')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(10000)),
});

export type MeterSearchQuery = z.infer<typeof MeterSearchQuerySchema>;
export type MeterIdParam = z.infer<typeof MeterIdParamSchema>;
export type TransformerListQuery = z.infer<typeof TransformerListQuerySchema>;

// Raw portal response interfaces
export interface PortalMeterRecord {
  id?: string;
  meterId?: string;
  meterNo?: string;
  serialNo?: string;
  consumerName?: string;
  consumerNo?: string;
  dtName?: string;
  dtId?: string;
  dtCode?: string;
  subdivision?: string;
  status?: string;
  installStatus?: string;
  make?: string;
  manufacturer?: string;
  phaseType?: string;
  phase?: string;
  [key: string]: unknown;
}

export interface PortalMeterSearchResponse {
  meters?: PortalMeterRecord[];
  data?: PortalMeterRecord[];
  total?: number;
  totalCount?: number;
  page?: number;
  [key: string]: unknown;
}

export interface PortalMeterGeoResponse {
  latitude?: number | string;
  longitude?: number | string;
  lat?: number | string;
  lng?: number | string;
  lon?: number | string;
  address?: string;
  data?: {
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
    [key: string]: unknown;
  };
  location?: {
    latitude?: number | string;
    longitude?: number | string;
    lat?: number | string;
    lng?: number | string;
    lon?: number | string;
    address?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PortalEnergyReading {
  timestamp?: string;
  date?: string;
  datetime?: string;
  createdAt?: string;
  reading?: number | string;
  value?: number | string;
  kwh?: number | string;
  energy?: number | string;
  consumption?: number | string;
  unit?: string;
  [key: string]: unknown;
}

export interface PortalMeterEnergyResponse {
  readings?: PortalEnergyReading[];
  data?: PortalEnergyReading[];
  energy?: PortalEnergyReading[];
  consumption?: PortalEnergyReading[];
  [key: string]: unknown;
}

export interface PortalTransformerRecord {
  id?: string;
  dtId?: string;
  code?: string;
  name?: string;
  dtName?: string;
  capacity?: number | string;
  capacityKva?: number | string;
  subdivision?: string;
  feeder?: string;
  feederCode?: string;
  status?: string;
  meterCount?: number;
  [key: string]: unknown;
}

export interface PortalTransformersResponse {
  dts?: PortalTransformerRecord[];
  transformers?: PortalTransformerRecord[];
  data?: PortalTransformerRecord[];
  total?: number;
  totalCount?: number;
  page?: number;
  [key: string]: unknown;
}

// Normalized API response types
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  total: number | null;
}

export interface NormalizedMeter {
  id: string;
  meterNo: string | null;
  consumerName: string | null;
  consumerNo: string | null;
  dtName: string | null;
  dtId: string | null;
  subdivision: string | null;
  status: string | null;
  manufacturer: string | null;
  phase: string | null;
  raw: Record<string, unknown>;
}

export interface NormalizedMeterLocation {
  meterId: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  raw: Record<string, unknown>;
}

export interface NormalizedEnergyReading {
  timestamp: string | null;
  value: number | null;
  unit: string;
  raw: Record<string, unknown>;
}

export interface NormalizedConsumption {
  meterId: string;
  readings: NormalizedEnergyReading[];
  count: number;
}

export interface NormalizedTransformer {
  id: string;
  name: string | null;
  capacity: string | null;
  subdivision: string | null;
  feeder: string | null;
  status: string | null;
  meterCount: number | null;
  raw: Record<string, unknown>;
}

