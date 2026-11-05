import { Router, Request, Response } from 'express';
import { HealthResponse } from '../types/portal.types';

const router = Router();

/**
 * GET /api/v1/health
 * Returns service health status. Does not require portal connectivity or authentication.
 */
router.get('/', (req: Request, res: Response<HealthResponse>) => {
  res.status(200).json({
    success: true,
    service: 'urja-meter-api',
    status: 'healthy',
  });
});

export default router;
