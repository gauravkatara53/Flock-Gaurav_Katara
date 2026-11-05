import { Request, Response, NextFunction } from 'express';
import { bulkExportService, BulkExportService } from '../services/bulk-export.service';
import { localMeterIndex, LocalMeterIndex } from '../services/local-index.service';
import { AppError } from '../types/portal.types';
import { logger } from '../utils/logger';
import {
  ExportTriggerQuerySchema,
  LocalMeterSearchQuerySchema,
  LocalMeterIdParamSchema,
  ExportResult,
  ExportStatus,
  NormalizedIndexedMeter,
  LocalSearchPaginationMeta,
} from '../types/export.types';
import { ApiSuccessResponse } from '../types/meter.types';

export class ExportController {
  private readonly exportService: BulkExportService;
  private readonly indexService: LocalMeterIndex;

  constructor(
    exportService: BulkExportService = bulkExportService,
    indexService: LocalMeterIndex = localMeterIndex
  ) {
    this.exportService = exportService;
    this.indexService = indexService;
  }

  // GET /api/v1/meters/export
  triggerExport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = ExportTriggerQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid query parameters: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const page = parsed.data.page || 1;
      let result: ExportResult;
      if (parsed.data.sync || parsed.data.source === 'search') {
        result = await this.exportService.syncFromMeterSearch();
      } else {
        result = await this.exportService.triggerImport(page);
      }

      const response: ApiSuccessResponse<ExportResult> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/meters/export/status
  getExportStatus = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const status: ExportStatus = this.exportService.getStatus();

      const response: ApiSuccessResponse<ExportStatus> = {
        success: true,
        data: status,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/meters/local
  searchLocalMeters = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = LocalMeterSearchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid query parameters: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      // If local index is unpopulated, trigger safe synchronization
      if (this.indexService.count() === 0) {
        try {
          await this.exportService.syncFromMeterSearch();
        } catch (syncErr: any) {
          logger.warn(`[ExportController] Auto-sync attempt on local search encountered: ${syncErr?.message}`);
        }
      }

      const { q, page, limit, zone, circle, division, subdivision, substation, feeder, transformer } = parsed.data;
      const searchResult = this.indexService.search({
        query: q,
        page,
        limit,
        zone,
        circle,
        division,
        subdivision,
        substation,
        feeder,
        transformer,
      });

      const response: ApiSuccessResponse<NormalizedIndexedMeter[]> & {
        pagination: LocalSearchPaginationMeta;
      } = {
        success: true,
        data: searchResult.meters,
        pagination: searchResult.pagination,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/meters/local/:meterId
  getLocalMeterById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = LocalMeterIdParamSchema.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid path parameters: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const { meterId } = parsed.data;

      // If local index is unpopulated, trigger safe synchronization
      if (this.indexService.count() === 0) {
        try {
          await this.exportService.syncFromMeterSearch();
        } catch (syncErr: any) {
          logger.warn(`[ExportController] Auto-sync attempt on meter lookup encountered: ${syncErr?.message}`);
        }
      }

      const meter = this.indexService.getById(meterId);

      if (!meter) {
        throw new AppError(
          'NOT_FOUND',
          `Meter '${meterId}' not found in local index. Trigger an export to synchronize data.`,
          404
        );
      }

      const response: ApiSuccessResponse<NormalizedIndexedMeter> = {
        success: true,
        data: meter,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };
}

export const exportController = new ExportController(bulkExportService, localMeterIndex);

