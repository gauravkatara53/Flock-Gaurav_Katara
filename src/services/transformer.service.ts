import { PortalClient, portalClient } from '../clients/portal.client';
import { AuthService, authService } from './auth.service';
import { cacheService, CacheService } from './cache.service';
import { logger } from '../utils/logger';
import { AppError, PORTAL_ENDPOINTS } from '../types/portal.types';
import {
  PortalTransformersResponse,
  PortalTransformerRecord,
  NormalizedTransformer,
} from '../types/meter.types';

export interface ITransformerService {
  listTransformers(page: number): Promise<{ transformers: NormalizedTransformer[]; total: number | null; page: number }>;
}

export class TransformerService implements ITransformerService {
  private readonly client: PortalClient;
  private readonly auth: AuthService;
  private readonly cache: CacheService;

  constructor(
    client: PortalClient = portalClient,
    auth: AuthService = authService,
    cache: CacheService = cacheService
  ) {
    this.client = client;
    this.auth = auth;
    this.cache = cache;
  }

  async listTransformers(page: number): Promise<{ transformers: NormalizedTransformer[]; total: number | null; page: number }> {
    await this.auth.ensureAuthenticated();

    const cacheKey = `transformer:list:${page}`;
    const cached = this.cache.get<{ transformers: NormalizedTransformer[]; total: number | null; page: number }>(cacheKey);
    if (cached) {
      return cached;
    }

    logger.debug(`[TransformerService] Listing transformers: page=${page}`);

    try {
      const response = await this.client.get<PortalTransformersResponse>(
        `${PORTAL_ENDPOINTS.TRANSFORMERS}?page=${page}`
      );

      const data = response.data;
      if (!data || typeof data !== 'object') {
        throw new AppError(
          'INTERNAL_SERVER_ERROR',
          'Unexpected response format from portal transformers endpoint',
          502
        );
      }

      const rawTransformers: PortalTransformerRecord[] =
        Array.isArray(data)
          ? data
          : data.dts || data.transformers || (Array.isArray(data.data) ? data.data : []) || [];

      if (!Array.isArray(rawTransformers)) {
        throw new AppError(
          'INTERNAL_SERVER_ERROR',
          'Portal transformers endpoint returned a non-array result',
          502
        );
      }

      const transformers = rawTransformers.map((t) => this.normalizeTransformer(t));
      const total = typeof data.total === 'number' ? data.total : (typeof data.totalCount === 'number' ? data.totalCount : null);

      const result = { transformers, total, page };
      this.cache.set(cacheKey, result, undefined, ['transformers']);
      return result;
    } catch (error: any) {
      if (error instanceof AppError && (error.code === 'PORTAL_AUTH_FAILED' || error.code === 'PORTAL_SESSION_EXPIRED')) {
        await this.auth.clearInvalidSession();
      }
      throw error;
    }
  }

  private normalizeTransformer(raw: PortalTransformerRecord): NormalizedTransformer {
    const id = String(
      raw.code ||
      (raw as any).dtCode ||
      (raw as any).dt_code ||
      raw.id ||
      raw.dtId ||
      (raw as any).dt_id ||
      (raw as any).transformerId ||
      (raw as any).transformer_id ||
      (raw as any).transformerCode ||
      ''
    ).trim();

    const name =
      raw.name != null
        ? String(raw.name)
        : raw.dtName != null
        ? String(raw.dtName)
        : (raw as any).dt_name != null
        ? String((raw as any).dt_name)
        : (raw as any).transformerName != null
        ? String((raw as any).transformerName)
        : (raw as any).transformer_name != null
        ? String((raw as any).transformer_name)
        : (raw as any).transformer != null
        ? String((raw as any).transformer)
        : null;

    const rawCapacity =
      raw.capacityKva ??
      (raw as any).capacity_kva ??
      raw.capacity ??
      (raw as any).capacity_rating ??
      (raw as any).kva ??
      (raw as any).ratedCapacity;
    const capacity = rawCapacity != null ? String(rawCapacity) : null;

    const feeder =
      raw.feederCode != null
        ? String(raw.feederCode)
        : (raw as any).feeder_code != null
        ? String((raw as any).feeder_code)
        : raw.feeder != null
        ? String(raw.feeder)
        : (raw as any).feederName != null
        ? String((raw as any).feederName)
        : (raw as any).feeder_name != null
        ? String((raw as any).feeder_name)
        : (raw as any).feederId != null
        ? String((raw as any).feederId)
        : (raw as any).feeder_id != null
        ? String((raw as any).feeder_id)
        : null;

    const subdivision =
      raw.subdivision != null
        ? String(raw.subdivision)
        : (raw as any).sub_division != null
        ? String((raw as any).sub_division)
        : (raw as any).subDivision != null
        ? String((raw as any).subDivision)
        : null;

    const status =
      raw.status != null
        ? String(raw.status)
        : (raw as any).dtStatus != null
        ? String((raw as any).dtStatus)
        : (raw as any).dt_status != null
        ? String((raw as any).dt_status)
        : (raw as any).operationalStatus != null
        ? String((raw as any).operationalStatus)
        : null;

    const meterCount =
      typeof raw.meterCount === 'number'
        ? raw.meterCount
        : typeof (raw as any).meter_count === 'number'
        ? (raw as any).meter_count
        : typeof (raw as any).connectedMeters === 'number'
        ? (raw as any).connectedMeters
        : typeof (raw as any).metersCount === 'number'
        ? (raw as any).metersCount
        : null;

    return {
      id,
      name,
      capacity,
      subdivision,
      feeder,
      status,
      meterCount,
      raw: { ...raw },
    };
  }
}

export const transformerService = new TransformerService(portalClient, authService);

