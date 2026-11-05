import { app } from './app';
import { env, getSanitizedConfig } from './config/env';
import { logger } from './utils/logger';
import { bulkExportService } from './services/bulk-export.service';

const server = app.listen(env.PORT, () => {
  logger.info(`Urja Meter API server listening on port ${env.PORT}`, {
    config: getSanitizedConfig(env),
  });
  logger.info(`Health check: http://localhost:${env.PORT}/api/v1/health`);
  logger.info(`Portal status: http://localhost:${env.PORT}/api/v1/portal/status`);

  // Trigger non-blocking background synchronization if session token is configured
  if (env.PORTAL_SESSION_TOKEN && env.NODE_ENV !== 'test') {
    bulkExportService.syncFromMeterSearch().catch((err) => {
      logger.warn(`[Startup] Background synchronization deferred: ${err.message}`);
    });
  }
});

// Graceful shutdown handling
function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}. Gracefully shutting down...`);
  server.close(() => {
    logger.info('HTTP server closed. Exiting process.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default server;

