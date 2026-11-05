import { Request, Response, NextFunction } from 'express';
import { transformerService, TransformerService } from '../services/transformer.service';
import { AppError } from '../types/portal.types';
import {
  TransformerListQuerySchema,
  ApiSuccessResponse,
  NormalizedTransformer,
  PaginationMeta,
} from '../types/meter.types';

export class TransformerController {
  private readonly service: TransformerService;

  constructor(service: TransformerService = transformerService) {
    this.service = service;
  }

  // GET /api/v1/transformers
  listTransformers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = TransformerListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid query parameters: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const { page } = parsed.data;
      const result = await this.service.listTransformers(page);

      const response: ApiSuccessResponse<NormalizedTransformer[]> & { pagination: PaginationMeta } = {
        success: true,
        data: result.transformers,
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
}

export const transformerController = new TransformerController(transformerService);

