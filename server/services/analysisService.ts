import type { AnalysisResult } from '../../shared/types.js';
import type { Store } from '../db/store.js';
import { newId } from '../db/store.js';
import { AppError } from '../http/appError.js';
import type { MediaEngine } from '../media/engine.js';
import { availableHeights, estimateSizes, pickThumbnail, summarizeFormats } from '../media/metadata.js';
import { assertPublicHost, validateUrlSyntax, type Resolver, type UrlPolicyOptions } from '../security/urlPolicy.js';

export const SAFE_USE_NOTICE =
  'Public URL does not automatically mean unrestricted use. Process only media you own or are authorized to use, and follow the platform’s terms.';

export interface EffectiveLimits {
  maxFileSizeBytes: number;
  maxDurationSeconds: number;
}

/** Resolves admin overrides (runtime settings) on top of environment limits. */
export async function effectiveLimits(
  store: Store,
  base: { maxFileSizeBytes: number; maxDurationSeconds: number },
): Promise<EffectiveLimits> {
  const s = await store.getSettings();
  return {
    maxFileSizeBytes: s.maxFileSizeBytes ?? base.maxFileSizeBytes,
    maxDurationSeconds: s.maxDurationSeconds ?? base.maxDurationSeconds,
  };
}

interface CacheEntry {
  result: AnalysisResult;
  at: number;
}

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;

export class AnalysisService {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly deps: {
      store: Store;
      engine: MediaEngine;
      urlPolicy: UrlPolicyOptions;
      baseLimits: { maxFileSizeBytes: number; maxDurationSeconds: number };
      resolver?: Resolver;
    },
  ) {}

  async analyze(rawUrl: string, signal?: AbortSignal): Promise<AnalysisResult> {
    // 1–3: structural validation, allow-list, platform detection, SSRF/private-IP check.
    const v = validateUrlSyntax(rawUrl, this.deps.urlPolicy);
    await assertPublicHost(v.host, this.deps.resolver);

    const cached = this.cache.get(v.url);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

    const health = await this.deps.engine.health();
    if (health.ytdlp.status !== 'up') throw new AppError('YTDLP_UNAVAILABLE');

    const limits = await effectiveLimits(this.deps.store, this.deps.baseLimits);
    // 4: metadata extraction only after validation. Throws on private/DRM/login/age/live.
    const info = await this.deps.engine.analyze(v.url, limits.maxDurationSeconds, signal);

    const formats = summarizeFormats(info.formats ?? []);
    const sizes = estimateSizes(formats);
    const result: AnalysisResult = {
      analysisId: newId('anl'),
      platform: v.platform.id,
      platformName: v.platform.name,
      sourceUrl: v.url,
      title: String(info.title ?? 'Untitled media').slice(0, 300),
      uploader: (info.uploader ?? info.channel ?? null)?.toString().slice(0, 120) ?? null,
      durationSeconds: typeof info.duration === 'number' ? Math.round(info.duration) : null,
      thumbnailUrl: pickThumbnail(info),
      hasVideo: formats.some((f) => f.kind !== 'audio'),
      hasAudio: formats.some((f) => f.kind !== 'video'),
      availableHeights: availableHeights(formats),
      formats,
      // Uploader-published subtitles only (never auto-generated captions).
      subtitles: Object.keys(info.subtitles ?? {})
        .filter((l) => /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(l))
        .slice(0, 40),
      estimatedSizes: sizes,
      safeUse: { status: 'allowed', reason: null, notice: SAFE_USE_NOTICE },
      limits,
    };

    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(v.url, { result, at: Date.now() });
    return result;
  }

  clearCache() {
    this.cache.clear();
  }
}
