import { logger } from '../utils/logger';
import { AppError } from '../types/portal.types';

export interface RequestSigningHeaders {
  'x-timestamp'?: string;
  'x-signature'?: string;
  'X-Timestamp'?: string;
  'X-Signature'?: string;
  [key: string]: string | undefined;
}

export interface IRequestSigner {
  readonly isConfigured: boolean;
  readonly name: string;
  generateHeaders(url: string, body?: unknown): Promise<RequestSigningHeaders> | RequestSigningHeaders;
  getAlgorithmDetails(): string;
}

/**
 * Default signer that no-ops until a verified signature algorithm is configured.
 */
export class DefaultRequestSigner implements IRequestSigner {
  readonly name = 'DefaultUnverifiedSigner';

  get isConfigured(): boolean {
    return false;
  }

  generateHeaders(_url: string, _body?: unknown): RequestSigningHeaders {
    logger.debug('[RequestSigner] Signing skipped: algorithm unverified');
    return {};
  }

  getAlgorithmDetails(): string {
    return 'Urja portal export signing algorithm (X-Signature, X-Timestamp) was not verified in discovery findings and is intentionally not guessed.';
  }
}

export interface VerifiedSignerOptions {
  name: string;
  signFn: (url: string, timestamp: string, body?: unknown) => Promise<string> | string;
  timestampFn?: () => string;
  algorithmDetails?: string;
}

/**
 * Signer implementation used when a verified signing algorithm is provided.
 */
export class VerifiedRequestSigner implements IRequestSigner {
  readonly name: string;
  private readonly signFn: (url: string, timestamp: string, body?: unknown) => Promise<string> | string;
  private readonly timestampFn?: () => string;
  private readonly algorithmDetails?: string;

  constructor(
    nameOrOptions: string | VerifiedSignerOptions,
    signFn?: (url: string, timestamp: string, body?: unknown) => Promise<string> | string
  ) {
    if (typeof nameOrOptions === 'object') {
      this.name = nameOrOptions.name;
      this.signFn = nameOrOptions.signFn;
      this.timestampFn = nameOrOptions.timestampFn;
      this.algorithmDetails = nameOrOptions.algorithmDetails;
    } else {
      this.name = nameOrOptions;
      if (!signFn) {
        throw new AppError('INVALID_CONFIGURATION', 'signFn function is required for VerifiedRequestSigner', 500);
      }
      this.signFn = signFn;
    }
  }

  get isConfigured(): boolean {
    return true;
  }

  async generateHeaders(url: string, body?: unknown): Promise<RequestSigningHeaders> {
    const timestamp = this.timestampFn ? this.timestampFn() : Math.floor(Date.now() / 1000).toString();
    if (!timestamp || typeof timestamp !== 'string') {
      throw new AppError('INVALID_CONFIGURATION', 'Request signer generated an invalid timestamp', 500);
    }

    let signature: string;
    try {
      signature = await this.signFn(url, timestamp, body);
    } catch (err: any) {
      throw new AppError(
        'INVALID_CONFIGURATION',
        `Request signer failed to compute signature: ${err instanceof Error ? err.message : String(err)}`,
        500
      );
    }

    if (!signature || typeof signature !== 'string' || !signature.trim()) {
      throw new AppError('INVALID_CONFIGURATION', 'Request signer produced an empty or invalid signature', 500);
    }

    const trimmedSig = signature.trim();

    return {
      'x-timestamp': timestamp,
      'x-signature': trimmedSig,
      'X-Timestamp': timestamp,
      'X-Signature': trimmedSig,
    };
  }

  getAlgorithmDetails(): string {
    return this.algorithmDetails || `Verified signer configured with: ${this.name}`;
  }
}

export const requestSigner = new DefaultRequestSigner();

