import express, { Express, Request, Response, NextFunction } from 'express';
import healthRoutes from './routes/health.routes';
import portalRoutes from './routes/portal.routes';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { logger } from './utils/logger';

export function createApp(): Express {
  const app = express();

  // Parse JSON request bodies
  app.use(express.json());

  // Safe Request Logging Middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    logger.debug(`[Incoming Request] ${req.method} ${req.url}`);
    next();
  });

  // Mount API Routes
  app.use('/api/v1/health', healthRoutes);
  app.use('/api/v1/portal', portalRoutes);

  // 404 Route Handler
  app.use(notFoundHandler);

  // Centralized Error Handling Middleware
  app.use(errorHandler);

  return app;
}

export const app = createApp();
