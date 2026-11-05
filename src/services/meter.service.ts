import { PortalClient, portalClient } from '../clients/portal.client';
import { AuthService, authService } from './auth.service';
import { cacheService, CacheService } from './cache.service';
import { logger } from '../utils/logger';
import { AppError, PORTAL_ENDPOINTS } from '../types/portal.types';
import {
  PortalMeterSearchResponse,
  PortalMeterGeoResponse,
  PortalMeterEnergyResponse,
  PortalMeterRecord,
  PortalEnergyReading,
  NormalizedMeter,
  NormalizedMeterLocation,
  NormalizedConsumption,
  NormalizedEnergyReading,
} from '../types/meter.types';

export interface IMeterService {
  searchMeters(query: string, page: number): Promise<{ meters: NormalizedMeter[]; total: number | null; page: number }>;
  getMeterLocation(meterId: string): Promise<NormalizedMeterLocation>;
  getMeterConsumption(meterId: string): Promise<NormalizedConsumption>;
}

export class MeterService implements IMeterService {
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

  async searchMeters(query: string, page: number): Promise<{ meters: NormalizedMeter[]; total: number | null; page: number }> {
    await this.auth.ensureAuthenticated();

    const cacheKey = `meter:search:${query}:${page}`;
    const cached = this.cache.get<{ meters: NormalizedMeter[]; total: number | null; page: number }>(cacheKey);
    if (cached) {
      return cached;
    }

    logger.debug(`[MeterService] Searching meters: q="${query}", page=${page}`);

    try {
      const response = await this.client.get<PortalMeterSearchResponse>(
        `${PORTAL_ENDPOINTS.METERS_SEARCH}?q=${encodeURIComponent(query)}&page=${page}`
      );

      const data = response.data;
      if (!data || typeof data !== 'object') {
        throw new AppError(
          'INTERNAL_SERVER_ERROR',
          'Unexpected response format from portal meters search endpoint',
          502
        );
      }

      let rawMeters: PortalMeterRecord[] = [];
      if (Array.isArray(data)) {
        rawMeters = data;
      } else if (Array.isArray(data.meters)) {
        rawMeters = data.meters;
      } else if (Array.isArray(data.data)) {
        rawMeters = data.data;
      } else if (Array.isArray((data as any).records)) {
        rawMeters = (data as any).records;
      } else if (Array.isArray((data as any).items)) {
        rawMeters = (data as any).items;
      } else if (typeof data.data === 'object' && data.data !== null) {
        const nested = (data as any).data;
        if (Array.isArray(nested.meters)) rawMeters = nested.meters;
        else if (Array.isArray(nested.records)) rawMeters = nested.records;
        else if (Array.isArray(nested.items)) rawMeters = nested.items;
        else if (Array.isArray(nested.data)) rawMeters = nested.data;
      }

      const meters = rawMeters.map((m) => this.normalizeMeter(m));
      const total =
        typeof data.total === 'number'
          ? data.total
          : typeof data.totalCount === 'number'
          ? data.totalCount
          : typeof (data as any).count === 'number'
          ? (data as any).count
          : typeof (data as any).data?.total === 'number'
          ? (data as any).data.total
          : Array.isArray(data)
          ? data.length
          : null;

      const result = { meters, total, page };
      this.cache.set(cacheKey, result, undefined, ['meters']);
      return result;
    } catch (error: any) {
      if (error instanceof AppError && (error.code === 'PORTAL_AUTH_FAILED' || error.code === 'PORTAL_SESSION_EXPIRED')) {
        await this.auth.clearInvalidSession();
      }
      throw error;
    }
  }

  async getMeterLocation(meterId: string): Promise<NormalizedMeterLocation> {
    await this.auth.ensureAuthenticated();

    const cacheKey = `meter:geo:${meterId}`;
    const cached = this.cache.get<NormalizedMeterLocation>(cacheKey);
    if (cached) {
      return cached;
    }

    logger.debug(`[MeterService] Fetching location for meter: ${meterId}`);

    try {
      const response = await this.client.get<PortalMeterGeoResponse>(
        PORTAL_ENDPOINTS.METER_GEO(meterId)
      );

      const data = response.data;
      if (!data || typeof data !== 'object') {
        throw new AppError(
          'INTERNAL_SERVER_ERROR',
          `Unexpected response format from portal meter geo endpoint for meter ${meterId}`,
          502
        );
      }

      const result = this.normalizeLocation(meterId, data);
      this.cache.set(cacheKey, result, undefined, ['meters']);
      return result;
    } catch (error: any) {
      if (error instanceof AppError && (error.code === 'PORTAL_AUTH_FAILED' || error.code === 'PORTAL_SESSION_EXPIRED')) {
        await this.auth.clearInvalidSession();
      }
      throw error;
    }
  }

  async getMeterConsumption(meterId: string): Promise<NormalizedConsumption> {
    await this.auth.ensureAuthenticated();

    const cacheKey = `meter:energy:${meterId}`;
    const cached = this.cache.get<NormalizedConsumption>(cacheKey);
    if (cached) {
      return cached;
    }

    logger.debug(`[MeterService] Fetching consumption for meter: ${meterId}`);

    try {
      const response = await this.client.get<PortalMeterEnergyResponse>(
        PORTAL_ENDPOINTS.METER_ENERGY(meterId)
      );

      const data = response.data;
      if (!data || typeof data !== 'object') {
        throw new AppError(
          'INTERNAL_SERVER_ERROR',
          `Unexpected response format from portal meter energy endpoint for meter ${meterId}`,
          502
        );
      }

      let rawReadings: PortalEnergyReading[] = [];
      if (Array.isArray(data)) {
        rawReadings = data;
      } else if (Array.isArray(data.readings)) {
        rawReadings = data.readings;
      } else if (Array.isArray(data.data)) {
        rawReadings = data.data;
      } else if (Array.isArray(data.energy)) {
        rawReadings = data.energy;
      } else if (Array.isArray(data.consumption)) {
        rawReadings = data.consumption;
      } else if (typeof data.data === 'object' && data.data !== null) {
        const nested = (data as any).data;
        if (Array.isArray(nested.readings)) rawReadings = nested.readings;
        else if (Array.isArray(nested.data)) rawReadings = nested.data;
      }

      const readings = rawReadings.map((r) => this.normalizeReading(r));

      const result = {
        meterId,
        readings,
        count: readings.length,
      };
      this.cache.set(cacheKey, result, undefined, ['meters']);
      return result;
    } catch (error: any) {
      if (error instanceof AppError && (error.code === 'PORTAL_AUTH_FAILED' || error.code === 'PORTAL_SESSION_EXPIRED')) {
        await this.auth.clearInvalidSession();
      }
      throw error;
    }
  }

  private normalizeMeter(raw: PortalMeterRecord): NormalizedMeter {
    const id = String(
      raw.meterId ||
      raw.id ||
      (raw as any).meter_id ||
      raw.meterNo ||
      (raw as any).meter_no ||
      (raw as any).meterNumber ||
      (raw as any).meter_number ||
      raw.serialNo ||
      (raw as any).serial_no ||
      ''
    ).trim();

    const meterNo =
      raw.meterNo != null
        ? String(raw.meterNo)
        : (raw as any).meter_no != null
        ? String((raw as any).meter_no)
        : (raw as any).meterNumber != null
        ? String((raw as any).meterNumber)
        : (raw as any).meter_number != null
        ? String((raw as any).meter_number)
        : raw.serialNo != null
        ? String(raw.serialNo)
        : (raw as any).serial_no != null
        ? String((raw as any).serial_no)
        : null;

    const consumerName =
      raw.consumerName != null
        ? String(raw.consumerName)
        : (raw as any).consumer_name != null
        ? String((raw as any).consumer_name)
        : (raw as any).customerName != null
        ? String((raw as any).customerName)
        : (raw as any).customer_name != null
        ? String((raw as any).customer_name)
        : null;

    const consumerNo =
      raw.consumerNo != null
        ? String(raw.consumerNo)
        : (raw as any).consumer_no != null
        ? String((raw as any).consumer_no)
        : (raw as any).consumerNumber != null
        ? String((raw as any).consumerNumber)
        : (raw as any).consumer_number != null
        ? String((raw as any).consumer_number)
        : (raw as any).accountNo != null
        ? String((raw as any).accountNo)
        : (raw as any).account_no != null
        ? String((raw as any).account_no)
        : null;

    const dtName =
      raw.dtName != null
        ? String(raw.dtName)
        : (raw as any).dt_name != null
        ? String((raw as any).dt_name)
        : null;

    const dtId =
      raw.dtId != null
        ? String(raw.dtId)
        : (raw as any).dt_id != null
        ? String((raw as any).dt_id)
        : raw.dtCode != null
        ? String(raw.dtCode)
        : (raw as any).dt_code != null
        ? String((raw as any).dt_code)
        : (raw as any).transformerId != null
        ? String((raw as any).transformerId)
        : (raw as any).transformer_id != null
        ? String((raw as any).transformer_id)
        : (raw as any).transformerCode != null
        ? String((raw as any).transformerCode)
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
        : raw.installStatus != null
        ? String(raw.installStatus)
        : (raw as any).install_status != null
        ? String((raw as any).install_status)
        : (raw as any).meter_status != null
        ? String((raw as any).meter_status)
        : null;

    const manufacturer =
      raw.make != null
        ? String(raw.make)
        : raw.manufacturer != null
        ? String(raw.manufacturer)
        : null;

    const phase =
      raw.phaseType != null
        ? String(raw.phaseType)
        : (raw as any).phase_type != null
        ? String((raw as any).phase_type)
        : raw.phase != null
        ? String(raw.phase)
        : null;

    return {
      id,
      meterNo,
      consumerName,
      consumerNo,
      dtName,
      dtId,
      subdivision,
      status,
      manufacturer,
      phase,
      raw: { ...raw },
    };
  }

  private normalizeLocation(meterId: string, data: PortalMeterGeoResponse): NormalizedMeterLocation {
    const root = (Array.isArray(data) && data.length > 0 ? data[0] : data) as PortalMeterGeoResponse;
    const nestedData =
      typeof root.data === 'object' && root.data !== null
        ? (Array.isArray(root.data) ? root.data[0] : root.data)
        : undefined;

    const loc =
      nestedData && typeof (nestedData as any).location === 'object' && (nestedData as any).location !== null
        ? (nestedData as any).location
        : root.location && typeof root.location === 'object' && root.location !== null
        ? root.location
        : nestedData || root;

    const rawLat =
      (nestedData as any)?.latitude ??
      (nestedData as any)?.lat ??
      (loc as any)?.latitude ??
      (loc as any)?.lat ??
      (root as any)?.latitude ??
      (root as any)?.lat;

    const rawLng =
      (nestedData as any)?.longitude ??
      (nestedData as any)?.lng ??
      (nestedData as any)?.lon ??
      (nestedData as any)?.long ??
      (loc as any)?.longitude ??
      (loc as any)?.lng ??
      (loc as any)?.lon ??
      (loc as any)?.long ??
      (root as any)?.longitude ??
      (root as any)?.lng ??
      (root as any)?.lon ??
      (root as any)?.long;

    const address =
      (nestedData as any)?.address != null
        ? String((nestedData as any).address)
        : (loc as any)?.address != null
        ? String((loc as any).address)
        : (root as any)?.address != null
        ? String((root as any).address)
        : null;

    const parseCoordinate = (val: unknown): number | null => {
      if (val === null || val === undefined || val === '') return null;
      if (typeof val === 'number') return Number.isFinite(val) ? val : null;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed || trimmed.toLowerCase() === 'nan' || trimmed.toLowerCase() === 'null') return null;
        const num = Number(trimmed);
        return Number.isFinite(num) ? num : null;
      }
      return null;
    };

    const latitude = parseCoordinate(rawLat);
    const longitude = parseCoordinate(rawLng);

    return {
      meterId,
      latitude,
      longitude,
      address,
      raw: { ...(typeof data === 'object' && data !== null ? data : { raw: data }) },
    };
  }

  private normalizeReading(raw: PortalEnergyReading): NormalizedEnergyReading {
    const timestamp =
      raw.timestamp ??
      raw.datetime ??
      (raw as any).dateTime ??
      raw.date ??
      raw.createdAt ??
      (raw as any).created_at ??
      (raw as any).readingDate ??
      (raw as any).reading_date ??
      (raw as any).readingTime ??
      (raw as any).reading_time ??
      (raw as any).time ??
      null;

    const rawValue =
      raw.reading ??
      raw.value ??
      raw.kwh ??
      raw.energy ??
      raw.consumption ??
      (raw as any).kwh_reading ??
      (raw as any).kwhReading ??
      (raw as any).energy_kwh ??
      (raw as any).active_energy ??
      (raw as any).activeEnergy;

    let value: number | null = null;
    if (typeof rawValue === 'number') {
      value = Number.isFinite(rawValue) ? rawValue : null;
    } else if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (trimmed && trimmed.toLowerCase() !== 'nan' && trimmed.toLowerCase() !== 'null') {
        const parsed = parseFloat(trimmed);
        value = Number.isFinite(parsed) ? parsed : null;
      }
    }

    const unit = raw.unit
      ? String(raw.unit)
      : (raw as any).uom
      ? String((raw as any).uom)
      : (raw as any).energyUnit
      ? String((raw as any).energyUnit)
      : 'kWh';

    return {
      timestamp: timestamp != null ? String(timestamp) : null,
      value,
      unit,
      raw: { ...raw },
    };
  }
}

export const meterService = new MeterService(portalClient, authService);

