/**
 * Minimal, dependency-free RAJAR X API client for bots and scripts.
 * - API key from the environment only (never hard-coded, never logged)
 * - request timeouts, retries with exponential backoff + jitter (429 / 5xx / network)
 * - strict response-envelope validation
 * - streamed downloads with a hard size cap
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export class RajarApiError extends Error {
  constructor(code, message, requestId, status) {
    super(message);
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}

function assertEnvelope(body) {
  if (!body || typeof body !== 'object' || typeof body.success !== 'boolean' || typeof body.requestId !== 'string') {
    throw new RajarApiError('BAD_RESPONSE', 'Unexpected response from RAJAR X.', null, 0);
  }
  if (!body.success) {
    const e = body.error ?? {};
    throw new RajarApiError(String(e.code ?? 'UNKNOWN'), String(e.message ?? 'Request failed.'), body.requestId, 0);
  }
  return body;
}

export class RajarClient {
  constructor({ baseUrl, apiKey, timeoutMs = 15_000, maxRetries = 3, fetchImpl = fetch } = {}) {
    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) throw new Error('RAJAR_X_BASE_URL is required');
    if (!apiKey || !/^rjar_live_[0-9A-Za-z]{40}$/.test(apiKey)) throw new Error('RAJAR_X_API_KEY is missing or malformed');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    // Keep the key off enumerable properties so it never shows up in accidental logging.
    Object.defineProperty(this, 'auth', { value: `Bearer ${apiKey}`, enumerable: false });
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    this.fetch = fetchImpl;
  }

  async request(method, path, body) {
    let attempt = 0;
    for (;;) {
      let res;
      try {
        res = await this.fetch(this.baseUrl + path, {
          method,
          headers: { Authorization: this.auth, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt++ >= this.maxRetries) throw new RajarApiError('NETWORK_FAILURE', 'RAJAR X is unreachable.', null, 0);
        await this.backoff(attempt);
        continue;
      }
      if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
        attempt++;
        await this.backoff(attempt, Number(res.headers.get('retry-after')) || 0);
        continue;
      }
      let json;
      try {
        json = await res.json();
      } catch {
        throw new RajarApiError(
          'BAD_RESPONSE',
          'RAJAR X returned a non-JSON response.',
          res.headers.get('x-request-id'),
          res.status,
        );
      }
      const env = assertEnvelope(json);
      return { data: env.data, requestId: env.requestId };
    }
  }

  backoff(attempt, retryAfterSeconds = 0) {
    const base = Math.min(30_000, 500 * 2 ** attempt);
    const ms = Math.max(retryAfterSeconds * 1000, base / 2 + Math.random() * (base / 2));
    return new Promise((r) => setTimeout(r, ms));
  }

  async analyze(url) {
    const { data } = await this.request('POST', '/api/v1/analyze', { url });
    if (typeof data?.title !== 'string' || typeof data?.sourceUrl !== 'string')
      throw new RajarApiError('BAD_RESPONSE', 'Malformed analysis.', null, 0);
    return data;
  }

  async process(url, options) {
    const { data } = await this.request('POST', '/api/v1/process', { url, options, rightsConfirmed: true });
    if (typeof data?.id !== 'string') throw new RajarApiError('BAD_RESPONSE', 'Malformed job.', null, 0);
    return data;
  }

  async job(id) {
    if (!/^job_[A-Za-z0-9_-]+$/.test(id)) throw new Error('invalid job id');
    return (await this.request('GET', `/api/v1/jobs/${id}`)).data;
  }

  async waitForJob(id, { intervalMs = 2500, timeoutMs = 15 * 60_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let job = await this.job(id);
    while ((job.status === 'queued' || job.status === 'active') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, intervalMs));
      job = await this.job(id);
    }
    return job;
  }

  /** Downloads a finished file into memory, aborting if it exceeds maxBytes. */
  async downloadFile(id, maxBytes) {
    const res = await this.fetch(`${this.baseUrl}/api/v1/jobs/${id}/file`, {
      headers: { Authorization: this.auth },
      signal: AbortSignal.timeout(Math.max(this.timeoutMs, 120_000)),
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null);
      assertEnvelope(
        body ?? { success: false, requestId: res.headers.get('x-request-id') ?? '', error: { code: 'DOWNLOAD_FAILED' } },
      );
    }
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new RajarApiError('FILE_TOO_LARGE', 'File exceeds the bot limit.', null, 413);
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > maxBytes) throw new RajarApiError('FILE_TOO_LARGE', 'File exceeds the bot limit.', null, 413);
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), mimetype: res.headers.get('content-type') ?? 'application/octet-stream' };
  }
}
