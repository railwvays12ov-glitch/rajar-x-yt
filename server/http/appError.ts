import { ERROR_CATALOG, type ApiEnvelope, type ErrorCode } from '../../shared/errors.js';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>, message?: string) {
    super(message ?? ERROR_CATALOG[code].message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CATALOG[code].status;
    this.details = details;
  }
}

export function ok<T>(requestId: string, data: T): ApiEnvelope<T> {
  return { success: true, requestId, data, error: null };
}

export function fail(requestId: string, code: ErrorCode, details?: Record<string, unknown>): ApiEnvelope<never> {
  const entry = ERROR_CATALOG[code];
  return {
    success: false,
    requestId,
    data: null,
    error: { code, message: entry.message, nextAction: entry.nextAction, ...(details ? { details } : {}) },
  };
}
