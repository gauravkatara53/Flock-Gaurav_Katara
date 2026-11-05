import { PortalClient, portalClient } from '../clients/portal.client';
import { AuthService, authService } from './auth.service';
import { LocalMeterIndex, localMeterIndex } from './local-index.service';
import { IRequestSigner, requestSigner } from './request-signer.service';
import { cacheService } from './cache.service';
import { logger } from '../utils/logger';
import { AppError, PORTAL_ENDPOINTS } from '../types/portal.types';
import {
  NormalizedIndexedMeter,
  PortalBulkExportResponse,
  PortalExportMeterRecord,
  ExportStatus,
  ExportResult,
} from '../types/export.types';

export interface IBulkExportService {
  triggerImport(page?: number): Promise<ExportResult>;
  syncFromMeterSearch(): Promise<ExportResult>;
  getStatus(): ExportStatus;
  getSigner(): IRequestSigner;
  setSigner(signer: IRequestSigner): void;
}

export class BulkExportService implements IBulkExportService {
  private readonly client: PortalClient;
  private readonly auth: AuthService;
  private readonly index: LocalMeterIndex;
  private signer: IRequestSigner;

  private status: ExportStatus = {
    status: 'idle',
    lastSuccessfulRefresh: null,
    lastAttempt: null,
    totalIndexed: 0,
    importedCount: 0,
    lastError: null,
  };

  private activeImportPromise: Promise<ExportResult> | null = null;

  constructor(
    client: PortalClient = portalClient,
    auth: AuthService = authService,
    index: LocalMeterIndex = localMeterIndex,
    signer: IRequestSigner = requestSigner
  ) {
    this.client = client;
    this.auth = auth;
    this.index = index;
    this.signer = signer;
  }

  getSigner(): IRequestSigner {
    return this.signer;
  }

  setSigner(signer: IRequestSigner): void {
    if (!signer || typeof signer.generateHeaders !== 'function') {
      throw new AppError('INVALID_CONFIGURATION', 'Invalid request signer: must implement IRequestSigner', 400);
    }
    this.signer = signer;
    logger.info(`Bulk export request signer updated to: ${signer.name}`);
  }

  getStatus(): ExportStatus {
    return {
      ...this.status,
      totalIndexed: this.index.count(),
    };
  }

  /**
   * Triggers bulk import. If an import is already running, returns the in-flight promise.
   * Failed imports do not overwrite previously indexed data.
   */
  async triggerImport(requestedPage: number = 1): Promise<ExportResult> {
    if (this.activeImportPromise) {
      logger.info('[BulkExport] Import already in progress; reusing in-flight operation');
      return this.activeImportPromise;
    }

    this.activeImportPromise = this.executeImport(requestedPage);

    try {
      return await this.activeImportPromise;
    } finally {
      this.activeImportPromise = null;
    }
  }

  /**
   * Safe synchronization path using the authenticated live meter-search API
   * and pagination when bulk export is unavailable or unverified.
   */
  async syncFromMeterSearch(): Promise<ExportResult> {
    if (this.activeImportPromise) {
      logger.info('[BulkExport] Synchronization already in progress; reusing in-flight operation');
      return this.activeImportPromise;
    }

    this.activeImportPromise = this.executeMeterSearchSync();

    try {
      return await this.activeImportPromise;
    } finally {
      this.activeImportPromise = null;
    }
  }

  private async executeMeterSearchSync(): Promise<ExportResult> {
    const attemptTime = new Date().toISOString();
    this.status.status = 'in_progress';
    this.status.lastAttempt = attemptTime;
    this.status.lastError = null;

    logger.info('[BulkExport] Starting safe synchronization via meter search API');

    try {
      await this.auth.ensureAuthenticated();

      // Pre-fetch transformers to enrich meter DT and feeder mappings
      const dtMap = new Map<string, { name?: string; feeder?: string; capacity?: number | string }>();
      try {
        let dtPage = 1;
        let moreDts = true;
        while (moreDts && dtPage <= 10) {
          const dtResponse = await this.client.get<any>(`${PORTAL_ENDPOINTS.TRANSFORMERS}?page=${dtPage}`);
          const dtData = dtResponse.data;
          const dtList = Array.isArray(dtData)
            ? dtData
            : Array.isArray(dtData?.data)
            ? dtData.data
            : Array.isArray(dtData?.dts)
            ? dtData.dts
            : Array.isArray(dtData?.transformers)
            ? dtData.transformers
            : [];

          if (dtList.length === 0) {
            moreDts = false;
          } else {
            for (const dt of dtList) {
              const code = dt.code || dt.dtCode || dt.id || dt.dtId;
              if (code) {
                dtMap.set(String(code).trim(), {
                  name: dt.name || dt.dtName,
                  feeder: dt.feederCode || dt.feeder,
                  capacity: dt.capacityKva ?? dt.capacity,
                });
              }
            }
            dtPage++;
            const total = dtData?.total ?? dtData?.totalCount;
            if (typeof total === 'number' && dtMap.size >= total) {
              moreDts = false;
            }
          }
        }
      } catch (dtErr: any) {
        logger.debug(`[BulkExport] DT pre-fetch skipped: ${dtErr.message}`);
      }

      const stagedRecordsMap = new Map<string, NormalizedIndexedMeter>();

      // Fetch page 1 of meters
      const page1Res = await this.client.get<any>(`${PORTAL_ENDPOINTS.METERS_SEARCH}?q=&page=1`);
      const page1Data = page1Res.data;
      if (!page1Data || typeof page1Data !== 'object') {
        throw new AppError(
          'INTERNAL_SERVER_ERROR',
          'Unexpected meter search response format during synchronization',
          502
        );
      }

      const extractMeters = (data: any): any[] => {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.data)) return data.data;
        if (Array.isArray(data?.meters)) return data.meters;
        if (Array.isArray(data?.records)) return data.records;
        if (Array.isArray(data?.items)) return data.items;
        return [];
      };

      const page1Meters = extractMeters(page1Data);
      for (const m of page1Meters) {
        const enriched = this.enrichWithDt(m, dtMap);
        const record = this.normalizeRecord(enriched, attemptTime);
        if (record.id) {
          stagedRecordsMap.set(record.id, record);
        }
      }

      const totalCount =
        typeof page1Data.total === 'number'
          ? page1Data.total
          : typeof page1Data.totalCount === 'number'
          ? page1Data.totalCount
          : page1Meters.length;
      const pageSize =
        typeof page1Data.pageSize === 'number'
          ? page1Data.pageSize
          : page1Meters.length > 0
          ? page1Meters.length
          : 20;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

      logger.info(`[BulkExport] Safe synchronization detected ${totalCount} meters across ${totalPages} pages`);

      // Fetch remaining pages
      for (let p = 2; p <= totalPages; p++) {
        try {
          const pageRes = await this.client.get<any>(`${PORTAL_ENDPOINTS.METERS_SEARCH}?q=&page=${p}`);
          const meters = extractMeters(pageRes.data);
          for (const m of meters) {
            const enriched = this.enrichWithDt(m, dtMap);
            const record = this.normalizeRecord(enriched, attemptTime);
            if (record.id) {
              stagedRecordsMap.set(record.id, record);
            }
          }
        } catch (pageErr: any) {
          logger.warn(`[BulkExport] Warning: Failed to fetch meters page ${p}: ${pageErr.message}`);
          break;
        }
      }

      const allNormalized = Array.from(stagedRecordsMap.values());

      // Atomically commit staged records into the index
      this.index.replaceRecords(allNormalized);

      // Invalidate caches
      cacheService.invalidateAll();

      const completionTime = new Date().toISOString();
      this.status.status = 'completed';
      this.status.lastSuccessfulRefresh = completionTime;
      this.status.importedCount = allNormalized.length;
      this.status.totalIndexed = this.index.count();
      this.status.lastError = null;

      logger.info(`[BulkExport] Safe synchronization completed successfully. Indexed ${allNormalized.length} meters.`);

      return {
        importedCount: allNormalized.length,
        totalIndexed: this.index.count(),
        timestamp: completionTime,
        status: 'completed',
      };
    } catch (error: any) {
      this.status.status = 'failed';
      this.status.lastError = error instanceof Error ? error.message : 'Unknown synchronization error';
      this.status.totalIndexed = this.index.count();

      logger.error(`[BulkExport] Safe synchronization failed: ${this.status.lastError}`, {
        existingIndexedRetained: this.index.count(),
      });

      throw error;
    }
  }

  private enrichWithDt(
    raw: any,
    dtMap: Map<string, { name?: string; feeder?: string; capacity?: number | string }>
  ): any {
    const dtCode = raw.dtCode || raw.dt_code || raw.dtId || raw.dt_id || raw.transformerId;
    if (!dtCode) return raw;

    const dtInfo = dtMap.get(String(dtCode).trim());
    if (!dtInfo) return raw;

    return {
      ...raw,
      dtName: raw.dtName || raw.dt_name || dtInfo.name,
      transformerName: raw.transformerName || raw.transformer_name || dtInfo.name,
      transformer: raw.transformer || dtInfo.name,
      feederCode: raw.feederCode || raw.feeder_code || dtInfo.feeder,
      feeder: raw.feeder || dtInfo.feeder,
    };
  }

  private async executeImport(page: number): Promise<ExportResult> {
    const attemptTime = new Date().toISOString();
    this.status.status = 'in_progress';
    this.status.lastAttempt = attemptTime;
    this.status.lastError = null;

    logger.info(`[BulkExport] Starting bulk import (page ${page})`);

    try {
      await this.auth.ensureAuthenticated();

      // Stage records in memory so failures don't corrupt the active index
      const stagedRecordsMap = new Map<string, NormalizedIndexedMeter>();

      const firstPageData = await this.fetchExportPage(page);
      const firstBatch = this.extractAndNormalize(firstPageData, attemptTime);

      for (const record of firstBatch) {
        stagedRecordsMap.set(record.id, record);
      }

      const totalPages =
        typeof firstPageData === 'object' && firstPageData !== null && !Array.isArray(firstPageData)
          ? firstPageData.totalPages || null
          : null;

      if (page === 1 && totalPages && totalPages > 1) {
        const maxPagesToFetch = Math.min(totalPages, 50);
        logger.info(`[BulkExport] Detected ${totalPages} total pages. Fetching pages 2 through ${maxPagesToFetch}`);

        for (let p = 2; p <= maxPagesToFetch; p++) {
          try {
            const pageData = await this.fetchExportPage(p);
            const batch = this.extractAndNormalize(pageData, attemptTime);
            for (const record of batch) {
              stagedRecordsMap.set(record.id, record);
            }
          } catch (pageError: any) {
            logger.warn(`[BulkExport] Warning: Failed to fetch page ${p}: ${pageError.message}`);
            break;
          }
        }
      }

      const allNormalized = Array.from(stagedRecordsMap.values());

      // Atomically commit staged records into the index
      this.index.replaceRecords(allNormalized);

      // Invalidate query caches after new data is committed
      cacheService.invalidateAll();

      const completionTime = new Date().toISOString();
      this.status.status = 'completed';
      this.status.lastSuccessfulRefresh = completionTime;
      this.status.importedCount = allNormalized.length;
      this.status.totalIndexed = this.index.count();
      this.status.lastError = null;

      logger.info(
        `[BulkExport] Bulk import completed successfully. Indexed ${allNormalized.length} records.`
      );

      return {
        importedCount: allNormalized.length,
        totalIndexed: this.index.count(),
        timestamp: completionTime,
        status: 'completed',
      };
    } catch (error: any) {
      // Retain previously indexed valid data on error
      this.status.status = 'failed';
      this.status.lastError = error instanceof Error ? error.message : 'Unknown export error';
      this.status.totalIndexed = this.index.count();

      logger.error(`[BulkExport] Bulk import failed: ${this.status.lastError}`, {
        existingIndexedRetained: this.index.count(),
      });

      throw error;
    }
  }

  private async fetchExportPage(page: number): Promise<PortalBulkExportResponse | PortalExportMeterRecord[]> {
    const url = `${PORTAL_ENDPOINTS.BULK_EXPORT}?page=${page}`;
    const signingHeaders = await this.signer.generateHeaders(url);

    try {
      const response = await this.client.get<PortalBulkExportResponse | PortalExportMeterRecord[]>(url, {
        headers: {
          ...signingHeaders,
        },
      });

      const data = response.data;
      if (data === null || data === undefined || (typeof data !== 'object')) {
        throw new AppError(
          'INTERNAL_SERVER_ERROR',
          `Portal bulk export returned an invalid response format on page ${page}`,
          502
        );
      }

      return data;
    } catch (error: any) {
      if (error instanceof AppError && (error.code === 'PORTAL_AUTH_FAILED' || error.code === 'PORTAL_SESSION_EXPIRED')) {
        if (!this.signer.isConfigured) {
          throw new AppError(
            'PORTAL_AUTH_FAILED',
            `Bulk export authentication failed: Upstream endpoint requires verified request signing (x-signature, x-timestamp), but signing algorithm is unverified (${this.signer.getAlgorithmDetails()}).`,
            401
          );
        }
        await this.auth.clearInvalidSession();
      }
      throw error;
    }
  }

  private extractAndNormalize(
    data: PortalBulkExportResponse | PortalExportMeterRecord[],
    importedAt: string
  ): NormalizedIndexedMeter[] {
    let rawList: PortalExportMeterRecord[] = [];

    if (Array.isArray(data)) {
      rawList = data;
    } else if (typeof data === 'object' && data !== null) {
      rawList =
        data.meters ||
        data.data ||
        data.records ||
        data.items ||
        [];
    }

    if (!Array.isArray(rawList)) {
      throw new AppError(
        'INTERNAL_SERVER_ERROR',
        'Portal export payload does not contain a valid records array',
        502
      );
    }

    const normalizedList: NormalizedIndexedMeter[] = [];

    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue;
      const normalized = this.normalizeRecord(raw, importedAt);
      if (normalized.id) {
        normalizedList.push(normalized);
      }
    }

    return normalizedList;
  }

  public normalizeRecord(raw: PortalExportMeterRecord, importedAt: string): NormalizedIndexedMeter {
    const id = String(
      raw.id ||
      raw.meterId ||
      (raw as any).meter_id ||
      raw.meterNo ||
      (raw as any).meter_no ||
      (raw as any).serialNo ||
      (raw as any).serial_no ||
      ''
    ).trim();

    // Hierarchy extraction: Zone -> Circle -> Division -> Subdivision -> Substation -> Feeder -> Transformer -> Meter
    const rawHierarchy = (raw.hierarchy || {}) as Record<string, unknown>;
    const zone =
      raw.zone != null
        ? String(raw.zone)
        : rawHierarchy.zone != null
        ? String(rawHierarchy.zone)
        : null;
    const circle =
      raw.circle != null
        ? String(raw.circle)
        : rawHierarchy.circle != null
        ? String(rawHierarchy.circle)
        : null;
    const division =
      raw.division != null
        ? String(raw.division)
        : rawHierarchy.division != null
        ? String(rawHierarchy.division)
        : null;
    const subdivision =
      raw.subdivision != null
        ? String(raw.subdivision)
        : (raw as any).sub_division != null
        ? String((raw as any).sub_division)
        : rawHierarchy.subdivision != null
        ? String(rawHierarchy.subdivision)
        : (rawHierarchy as any).sub_division != null
        ? String((rawHierarchy as any).sub_division)
        : null;
    const substation =
      raw.substation != null
        ? String(raw.substation)
        : (raw as any).sub_station != null
        ? String((raw as any).sub_station)
        : rawHierarchy.substation != null
        ? String(rawHierarchy.substation)
        : (rawHierarchy as any).sub_station != null
        ? String((rawHierarchy as any).sub_station)
        : null;
    const feeder =
      raw.feederCode != null
        ? String(raw.feederCode)
        : (raw as any).feeder_code != null
        ? String((raw as any).feeder_code)
        : raw.feeder != null
        ? String(raw.feeder)
        : (rawHierarchy as any).feederCode != null
        ? String((rawHierarchy as any).feederCode)
        : (rawHierarchy as any).feeder_code != null
        ? String((rawHierarchy as any).feeder_code)
        : rawHierarchy.feeder != null
        ? String(rawHierarchy.feeder)
        : null;
    const dtName =
      raw.dtName != null
        ? String(raw.dtName)
        : (raw as any).dt_name != null
        ? String((raw as any).dt_name)
        : raw.transformerName != null
        ? String(raw.transformerName)
        : (raw as any).transformer_name != null
        ? String((raw as any).transformer_name)
        : raw.transformer != null
        ? String(raw.transformer)
        : rawHierarchy.dtName != null
        ? String(rawHierarchy.dtName)
        : (rawHierarchy as any).dt_name != null
        ? String((rawHierarchy as any).dt_name)
        : rawHierarchy.transformerName != null
        ? String(rawHierarchy.transformerName)
        : rawHierarchy.transformer != null
        ? String(rawHierarchy.transformer)
        : null;
    const dtId =
      raw.dtCode != null
        ? String(raw.dtCode)
        : (raw as any).dt_code != null
        ? String((raw as any).dt_code)
        : raw.dtId != null
        ? String(raw.dtId)
        : (raw as any).dt_id != null
        ? String((raw as any).dt_id)
        : raw.transformerId != null
        ? String(raw.transformerId)
        : (raw as any).transformer_id != null
        ? String((raw as any).transformer_id)
        : (rawHierarchy as any).dtCode != null
        ? String((rawHierarchy as any).dtCode)
        : (rawHierarchy as any).dt_code != null
        ? String((rawHierarchy as any).dt_code)
        : rawHierarchy.dtId != null
        ? String(rawHierarchy.dtId)
        : (rawHierarchy as any).dt_id != null
        ? String((rawHierarchy as any).dt_id)
        : rawHierarchy.transformerId != null
        ? String(rawHierarchy.transformerId)
        : null;
    const transformer = dtName || dtId;
    const transformerId = dtId || dtName;

    const rawLoc = (raw.location || raw) as Record<string, unknown>;
    const rawLat = rawLoc.latitude ?? rawLoc.lat ?? raw.latitude ?? raw.lat;
    const rawLng =
      rawLoc.longitude ??
      rawLoc.lng ??
      rawLoc.lon ??
      (rawLoc as any).long ??
      raw.longitude ??
      raw.lng ??
      raw.lon ??
      (raw as any).long;

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
    const address =
      raw.address != null
        ? String(raw.address)
        : (raw.location && (raw.location as any).address != null ? String((raw.location as any).address) : null);

    const meterNo =
      raw.meterNo != null
        ? String(raw.meterNo)
        : (raw as any).meter_no != null
        ? String((raw as any).meter_no)
        : (raw as any).serialNo != null
        ? String((raw as any).serialNo)
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
        : null;

    const consumerNo =
      raw.consumerNo != null
        ? String(raw.consumerNo)
        : (raw as any).consumer_no != null
        ? String((raw as any).consumer_no)
        : (raw as any).consumerNumber != null
        ? String((raw as any).consumerNumber)
        : (raw as any).accountNo != null
        ? String((raw as any).accountNo)
        : null;

    const status =
      raw.status != null
        ? String(raw.status)
        : (raw as any).installStatus != null
        ? String((raw as any).installStatus)
        : (raw as any).install_status != null
        ? String((raw as any).install_status)
        : null;

    const manufacturer =
      (raw as any).make != null
        ? String((raw as any).make)
        : (raw as any).manufacturer != null
        ? String((raw as any).manufacturer)
        : null;

    const phase =
      (raw as any).phaseType != null
        ? String((raw as any).phaseType)
        : (raw as any).phase_type != null
        ? String((raw as any).phase_type)
        : (raw as any).phase != null
        ? String((raw as any).phase)
        : null;

    return {
      id,
      meterNo,
      consumerName,
      consumerNo,
      status,
      manufacturer,
      phase,
      hierarchy: {
        zone,
        circle,
        division,
        subdivision,
        substation,
        feeder,
        transformer,
        transformerId,
        dtName: dtName || transformer,
        dtId: dtId || transformerId,
      },
      location: {
        latitude,
        longitude,
        address,
      },
      importedAt,
      raw: {
        ...raw,
        ...(manufacturer ? { make: (raw as any).make || manufacturer, manufacturer } : {}),
        ...(phase ? { phaseType: (raw as any).phaseType || phase, phase } : {}),
      },
    };
  }
}

export const bulkExportService = new BulkExportService(
  portalClient,
  authService,
  localMeterIndex,
  requestSigner
);

