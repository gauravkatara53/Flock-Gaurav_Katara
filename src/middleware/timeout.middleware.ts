import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { AppError } from '../types/portal.types';

/**
 * Aborts long-hanging requests with 504 PORTAL_TIMEOUT.
 */
export function requestTimeout(timeoutMs: number = env.REQUEST_TIMEOUT_MS) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        const error = new AppError(
          'PORTAL_TIMEOUT',
          `Request timeout: ${req.method} ${req.originalUrl} exceeded ${timeoutMs}ms`,
          504
        );
        next(error);
      }
    }, timeoutMs);

    res.on('finish', () => {
      clearTimeout(timer);
    });

    res.on('close', () => {
      clearTimeout(timer);
    });

    next();
  };
}

