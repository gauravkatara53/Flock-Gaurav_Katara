import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env file
dotenv.config();

const envSchema = z.object({
  PORT: z
    .string()
    .default('3000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive().max(65535)),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORTAL_BASE_URL: z
    .string()
    .url('PORTAL_BASE_URL must be a valid URL')
    .default('https://urja-ops.flockenergy.tech'),
  PORTAL_USERNAME: z.string().default(''),
  PORTAL_PASSWORD: z.string().default(''),
  PORTAL_TIMEOUT_MS: z
    .string()
    .default('10000')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive()),
  PORTAL_SESSION_TOKEN: z.string().default(''),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validates raw environment variables against the Zod schema.
 * Throws a descriptive error if validation fails (fail fast).
 */
export function validateEnv(rawEnv: Record<string, string | undefined> = process.env): EnvConfig {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const formattedErrors = result.error.errors
      .map((err) => `${err.path.join('.')}: ${err.message}`)
      .join(', ');
    throw new Error(`[INVALID_CONFIGURATION] Environment configuration error: ${formattedErrors}`);
  }

  return result.data;
}

/**
 * Returns a sanitized copy of configuration safe for logging (secrets redacted).
 */
export function getSanitizedConfig(config: EnvConfig): Record<string, unknown> {
  return {
    PORT: config.PORT,
    NODE_ENV: config.NODE_ENV,
    PORTAL_BASE_URL: config.PORTAL_BASE_URL,
    PORTAL_USERNAME: config.PORTAL_USERNAME ? `${config.PORTAL_USERNAME.substring(0, 3)}***` : '(empty)',
    PORTAL_PASSWORD: config.PORTAL_PASSWORD ? '******' : '(empty)',
    PORTAL_TIMEOUT_MS: config.PORTAL_TIMEOUT_MS,
    PORTAL_SESSION_TOKEN: config.PORTAL_SESSION_TOKEN ? '******' : '(empty)',
  };
}

// Active singleton configuration instance
export const env: EnvConfig = validateEnv(process.env);
