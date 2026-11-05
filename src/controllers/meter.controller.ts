import { Request, Response, NextFunction } from 'express';
import { meterService, MeterService } from '../services/meter.service';
import { AppError } from '../types/portal.types';
import {
  MeterSearchQuerySchema,
  MeterIdParamSchema,
  ApiSuccessResponse,
  NormalizedMeter,
  NormalizedMeterLocation,
  NormalizedConsumption,
  PaginationMeta,
} from '../types/meter.types';

export class MeterController {
  private readonly service: MeterService;

  constructor(service: MeterService = meterService) {
    this.service = service;
  }

  // GET /api/v1/meters
  searchMeters = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = MeterSearchQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid query parameters: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const { q, page } = parsed.data;
      const result = await this.service.searchMeters(q, page);

      const response: ApiSuccessResponse<NormalizedMeter[]> & { pagination: PaginationMeta } = {
        success: true,
        data: result.meters,
        pagination: {
          page: result.page,
          total: result.total,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/meters/:meterId/location
  getMeterLocation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = MeterIdParamSchema.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid path parameters: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const { meterId } = parsed.data;
      const location = await this.service.getMeterLocation(meterId);

      const response: ApiSuccessResponse<NormalizedMeterLocation> = {
        success: true,
        data: location,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/meters/:meterId/consumption
  getMeterConsumption = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = MeterIdParamSchema.safeParse(req.params);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid path parameters: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const { meterId } = parsed.data;
      const consumption = await this.service.getMeterConsumption(meterId);

      const response: ApiSuccessResponse<NormalizedConsumption> = {
        success: true,
        data: consumption,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };
}

export const meterController = new MeterController(meterService);

