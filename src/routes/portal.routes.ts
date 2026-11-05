import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service';
import { PortalStatusResponse } from '../types/portal.types';

const router = Router();

/**
 * GET /api/v1/portal/status
 * Checks the current Urja Meter Ops portal session status.
 * Never exposes cookies, secrets, or internal tokens.
 */
router.get('/status', async (req: Request, res: Response<PortalStatusResponse>, next: NextFunction) => {
  try {
    const forceCheck = req.query.force === 'true';
    const validation = await authService.validateSession(forceCheck);

    res.status(200).json({
      success: true,
      portal: 'Urja Meter Ops',
      authenticated: validation.authenticated,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
