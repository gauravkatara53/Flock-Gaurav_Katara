import { Request, Response, NextFunction } from 'express';
import { isAxiosError } from 'axios';
import { AppError, ApiErrorResponse, ErrorCode } from '../types/portal.types';
import { logger } from '../utils/logger';

/**
 * 404 Not Found Middleware.
 */
export function notFoundHandler(req: Request, res: Response, next: NextFunction): void {
  const error = new AppError('ROUTE_NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl}`, 404);
  next(error);
}

/**
 * Centralized Error Handling Middleware.
 * Standardizes all error responses and ensures no stack traces or secrets leak in production.
 */
export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  let statusCode = 500;
  let errorCode: ErrorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected internal error occurred';
  let details: unknown = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.code;
    message = err.message;
    details = err.details;
  } else if (isAxiosError(err)) {
    if (err.code === 'ECONNABORTED' || err.message.toLowerCase().includes('timeout')) {
      statusCode = 504;
      errorCode = 'PORTAL_TIMEOUT';
      message = 'Request to Urja Meter Ops portal timed out';
    } else if (
      err.code === 'ECONNREFUSED' ||
      err.code === 'ENOTFOUND' ||
      (err.response && [502, 503, 504].includes(err.response.status))
    ) {
      statusCode = 503;
      errorCode = 'PORTAL_UNAVAILABLE';
      message = 'Urja Meter Ops portal is currently unavailable or unreachable';
    } else if (err.response?.status === 401) {
      statusCode = 401;
      errorCode = 'PORTAL_AUTH_FAILED';
      message = 'Authentication failed with Urja Meter Ops portal';
    } else if (err.response?.status === 403) {
      statusCode = 403;
      errorCode = 'PORTAL_SESSION_EXPIRED';
      message = 'Urja Meter Ops portal session has expired or is unauthorized';
    } else {
      statusCode = err.response?.status || 500;
      message = err.message || 'Error communicating with Urja Meter Ops portal';
    }
  } else if (err.message && err.message.startsWith('[INVALID_CONFIGURATION]')) {
    statusCode = 500;
    errorCode = 'INVALID_CONFIGURATION';
    message = err.message.replace('[INVALID_CONFIGURATION] ', '');
  } else {
    message = process.env.NODE_ENV === 'production' ? 'An unexpected internal error occurred' : err.message;
  }

  // Log error (safely sanitized)
  logger.error(`${errorCode} on ${req.method} ${req.originalUrl}: ${message}`, {
    statusCode,
    errorCode,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  const responseBody: ApiErrorResponse = {
    success: false,
    error: {
      code: errorCode,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };

  res.status(statusCode).json(responseBody);
}
