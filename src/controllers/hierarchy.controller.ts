import { Request, Response, NextFunction } from 'express';
import { hierarchyService, HierarchyService } from '../services/hierarchy.service';
import { AppError } from '../types/portal.types';
import {
  HierarchyNavigationQuerySchema,
  HierarchyFilterCriteriaSchema,
  HierarchyTreeQuerySchema,
  TransformerMetersParamSchema,
  TransformerMetersQuerySchema,
  HierarchySummary,
  HierarchyTreeNode,
  HierarchyNavigationNode,
  TransformerMetersResult,
} from '../types/hierarchy.types';
import { ApiSuccessResponse } from '../types/meter.types';
import { NormalizedIndexedMeter, LocalSearchPaginationMeta } from '../types/export.types';

export class HierarchyController {
  private readonly service: HierarchyService;

  constructor(service: HierarchyService = hierarchyService) {
    this.service = service;
  }

  // GET /api/v1/hierarchy
  getHierarchySummary = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const summary: HierarchySummary = this.service.getSummary();

      const response: ApiSuccessResponse<HierarchySummary> = {
        success: true,
        data: summary,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/hierarchy/children
  getHierarchyChildren = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = HierarchyNavigationQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid hierarchy query parameters: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const nodes: HierarchyNavigationNode[] = this.service.getChildren(parsed.data);

      const response: ApiSuccessResponse<HierarchyNavigationNode[]> = {
        success: true,
        data: nodes,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/hierarchy/tree
  getHierarchyTree = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = HierarchyTreeQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid tree depth parameter: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const tree: HierarchyTreeNode[] = this.service.getTree(parsed.data.depth);

      const response: ApiSuccessResponse<HierarchyTreeNode[]> = {
        success: true,
        data: tree,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/hierarchy/meters
  filterMetersByHierarchy = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = HierarchyFilterCriteriaSchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid filter parameters: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const result = this.service.filterMeters(parsed.data);

      const response: ApiSuccessResponse<NormalizedIndexedMeter[]> & {
        pagination: LocalSearchPaginationMeta;
      } = {
        success: true,
        data: result.meters,
        pagination: result.pagination,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };

  // GET /api/v1/transformers/:transformerId/meters and /api/v1/hierarchy/transformers/:transformerId/meters
  getTransformerMeters = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const paramParsed = TransformerMetersParamSchema.safeParse(req.params);
      if (!paramParsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid transformerId path parameter: ${paramParsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const queryParsed = TransformerMetersQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid query parameters: ${queryParsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          400
        );
      }

      const { transformerId } = paramParsed.data;
      const { page, limit } = queryParsed.data;

      const result: TransformerMetersResult = this.service.getTransformerMeters(
        transformerId,
        page,
        limit
      );

      const response: ApiSuccessResponse<NormalizedIndexedMeter[]> & {
        pagination: LocalSearchPaginationMeta;
        transformer: string;
      } = {
        success: true,
        data: result.meters,
        pagination: result.pagination,
        transformer: result.transformer,
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  };
}

export const hierarchyController = new HierarchyController(hierarchyService);

