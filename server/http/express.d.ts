import type { ApiKeyRow, JobOwner, UserRow } from '../db/store.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      cookieJar: Record<string, string>;
      user?: UserRow;
      sessionId?: string;
      anonId?: string;
      apiKey?: ApiKeyRow;
      auditAction?: string;
      auditMeta?: Record<string, unknown>;
    }
  }
}

export type { JobOwner };
