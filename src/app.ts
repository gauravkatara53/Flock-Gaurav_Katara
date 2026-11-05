import express, { Express, Request, Response, NextFunction } from 'express';
import healthRoutes from './routes/health.routes';
import portalRoutes from './routes/portal.routes';
import meterRoutes from './routes/meter.routes';
import transformerRoutes from './routes/transformer.routes';
import hierarchyRoutes from './routes/hierarchy.routes';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { requestTimeout } from './middleware/timeout.middleware';
import { logger } from './utils/logger';

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(requestTimeout());

  // Request duration logging
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    logger.debug(`[Incoming Request] ${req.method} ${req.url}`);

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      logger.info(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} (${durationMs}ms)`);
    });

    next();
  });

  app.use('/api/v1/health', healthRoutes);
  app.use('/api/v1/portal', portalRoutes);
  app.use('/api/v1/meters', meterRoutes);
  app.use('/api/v1/transformers', transformerRoutes);
  app.use('/api/v1/hierarchy', hierarchyRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();

