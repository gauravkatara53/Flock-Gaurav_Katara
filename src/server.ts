import { app } from './app';
import { env, getSanitizedConfig } from './config/env';
import { logger } from './utils/logger';

const server = app.listen(env.PORT, () => {
  logger.info(`Urja Meter API server listening on port ${env.PORT}`, {
    config: getSanitizedConfig(env),
  });
  logger.info(`Health check: http://localhost:${env.PORT}/api/v1/health`);
  logger.info(`Portal status: http://localhost:${env.PORT}/api/v1/portal/status`);
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
