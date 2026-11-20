import { ERROR_CATALOG, isErrorCode, type ApiEnvelope, type ErrorCode } from '@shared/errors';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly nextAction: string,
    readonly requestId: string | null,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let csrfToken = '';
export function setCsrfToken(t: string) {
  csrfToken = t;
}

function networkError(): ApiError {
  const e = ERROR_CATALOG.NETWORK_FAILURE;
  return new ApiError('NETWORK_FAILURE', 'Could not reach the RAJAR X server.', e.nextAction, null, 0);
}

export async function api<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  opts: { signal?: AbortSignal } = {},
): Promise<{ data: T; requestId: string }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(method !== 'GET' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw networkError();
  }

  let env: ApiEnvelope<T> | null = null;
  try {
    env = (await res.json()) as ApiEnvelope<T>;
  } catch {
    /* non-JSON (proxy error page etc.) */
  }
  if (env?.success && env.data !== null) return { data: env.data, requestId: env.requestId };

  const code =
    env?.error && isErrorCode(env.error.code) ? env.error.code : res.status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR';
  const catalog = ERROR_CATALOG[code];
  throw new ApiError(
    code,
    env?.error?.message ?? catalog.message,
    env?.error?.nextAction ?? catalog.nextAction,
    env?.requestId ?? res.headers.get('x-request-id'),
    res.status,
    env?.error?.details,
  );
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>('GET', path, undefined, { signal }).then((r) => r.data);
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body ?? {}).then((r) => r.data);
export const put = <T>(path: string, body?: unknown) => api<T>('PUT', path, body ?? {}).then((r) => r.data);
export const del = <T>(path: string) => api<T>('DELETE', path).then((r) => r.data);

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const e = ERROR_CATALOG.INTERNAL_ERROR;
  return new ApiError('INTERNAL_ERROR', e.message, e.nextAction, null, 0);
}
