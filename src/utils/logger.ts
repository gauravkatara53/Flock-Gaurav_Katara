type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'session_token',
  'sessiontoken',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  '__secure-better-auth.session_token',
  'x-signature',
]);

/**
 * Recursively redacts sensitive values from objects or arrays before logging.
 */
export function sanitizeForLogging(data: unknown): unknown {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Redact potential cookie strings or token-like assignments
    return data.replace(
      /(__Secure-better-auth\.session_token=)([^;]+)/gi,
      '$1[REDACTED]'
    );
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForLogging(item));
  }

  if (typeof data === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitizeForLogging(value);
      }
    }
    return sanitized;
  }

  return data;
}

class Logger {
  private currentLevel: LogLevel = 'info';

  constructor() {
    const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
    if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
      this.currentLevel = envLevel;
    } else if (process.env.NODE_ENV === 'test') {
      this.currentLevel = 'error'; // Keep test runs clean unless overridden
    }
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.currentLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const timestamp = new Date().toISOString();
    const sanitizedMeta = meta ? ` ${JSON.stringify(sanitizeForLogging(meta))}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${sanitizedMeta}`;
  }

  debug(message: string, meta?: unknown): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: unknown): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: unknown): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }
}

export const logger = new Logger();

