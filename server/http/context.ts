import type { AppConfig } from '../config.js';
import type { Store } from '../db/store.js';
import type { CleanupWorker } from '../jobs/cleanup.js';
import type { JobQueue } from '../jobs/queue.js';
import type { MediaEngine } from '../media/engine.js';
import type { RateLimiter } from '../security/rateLimit.js';
import type { AnalysisService } from '../services/analysisService.js';
import type { ApiKeyService } from '../services/apiKeyService.js';
import type { AuthService } from '../services/authService.js';
import type { JobService } from '../services/jobService.js';
import type { WebhookService } from '../services/webhookService.js';

export interface AppContext {
  config: AppConfig;
  store: Store;
  engine: MediaEngine;
  queue: JobQueue;
  limiter: RateLimiter;
  cleanup: CleanupWorker;
  auth: AuthService;
  apiKeys: ApiKeyService;
  analysis: AnalysisService;
  jobs: JobService;
  webhooks: WebhookService;
  redisPing: (() => Promise<void>) | null;
  startedAt: Date;
  /** Absolute path to the built client (production only). */
  clientDir: string | null;
}
