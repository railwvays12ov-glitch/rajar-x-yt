import type { JobStatus } from '../../shared/types.js';

/**
 * queued ──▶ active ──▶ ready ──▶ completed ──▶ expired
 *   │          │  │        └──────────────────▲
 *   │          │  └─▶ queued (automatic retry)
 *   ├──────────┴──▶ blocked | failed | cancelled
 */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['active', 'cancelled', 'blocked', 'failed'],
  active: ['ready', 'failed', 'blocked', 'cancelled', 'queued'],
  ready: ['completed', 'expired'],
  completed: ['expired'],
  blocked: [],
  failed: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Invalid job transition ${from} → ${to}`);
  }
}

export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isCancellable(status: JobStatus): boolean {
  return canTransition(status, 'cancelled');
}
