import { useEffect, useMemo, useState } from 'react';
import { type AnalysisResult, type JobView, type ProcessOptions, type Quality, TERMINAL_STATUSES } from '@shared/types';
import { get, post, toApiError, type ApiError } from '../../lib/api';
import { QUALITY_LABEL, formatBytes } from '../../lib/format';
import { usePolling } from '../../lib/hooks';
import { Link } from '../../lib/router';
import { useSession } from '../../lib/session';
import { Icon, Spinner } from '../../components/Icon';
import { ErrorCallout, Segmented, StatusChip, Toggle } from '../../components/ui';
import { notifyJobsChanged } from '../activity/ActivityList';

const HEIGHTS: Record<string, number> = { '2160': 2160, '1440': 1440, '1080': 1080, '720': 720, '480': 480 };

function previewName(title: string, o: ProcessOptions): string {
  const base =
    title
      .normalize('NFKC')
      .replace(/[/\\?%*:|"<>#]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'rajar-x-media';
  const label =
    o.mediaType === 'thumbnail'
      ? 'thumbnail'
      : o.mediaType === 'audio'
        ? `${o.audioFormat}${o.audioBitrate !== 'auto' && o.audioFormat !== 'wav' ? ` ${o.audioBitrate}k` : ''}${o.audioMode === 'normalized' ? ' normalized' : ''}`
        : o.quality === 'best'
          ? `best ${o.container}`
          : `${o.quality}p ${o.container}`;
  const ext = o.mediaType === 'thumbnail' ? 'jpg' : o.mediaType === 'audio' ? o.audioFormat : o.container;
  return `${base} [${label}].${ext}`;
}

export function ProcessPanel({ analysis }: { analysis: AnalysisResult }) {
  const { me, status } = useSession();
  const [o, setO] = useState<ProcessOptions>({
    mediaType: analysis.hasVideo ? 'video' : 'audio',
    container: 'mp4',
    audioFormat: 'mp3',
    quality: 'best',
    audioMode: 'original',
    audioBitrate: 'auto',
    embedMetadata: true,
    embedThumbnail: false,
    subtitleLang: null,
  });
  const [rights, setRights] = useState(false);
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);

  useEffect(() => {
    setJob(null);
    setError(null);
    setRights(false);
  }, [analysis.analysisId]);

  const set = <K extends keyof ProcessOptions>(k: K, v: ProcessOptions[K]) => setO((prev) => ({ ...prev, [k]: v }));

  const qualityAvailable = (q: Quality) => {
    if (q === 'best') return true;
    const want = HEIGHTS[q];
    if (!want) return false;
    return analysis.availableHeights.some((h) => h >= want * 0.9) && analysis.availableHeights.some((h) => h <= want * 1.1);
  };

  const estimate =
    o.mediaType === 'audio' ? analysis.estimatedSizes.audio : o.mediaType === 'video' ? analysis.estimatedSizes[o.quality] : null;
  const tooLarge = !!estimate && estimate > analysis.limits.maxFileSizeBytes;
  const filename = useMemo(() => previewName(analysis.title, o), [analysis.title, o]);

  const canProcess = !!me?.user || !!me?.anonymous.processingAllowed;
  const maintenance = status?.processingEnabled === false;
  const running = job && !TERMINAL_STATUSES.includes(job.status) && job.status !== 'ready';

  const refreshJob = async () => {
    if (!job) return;
    try {
      const next = await get<JobView>(`/api/jobs/${job.id}`);
      setJob(next);
      if (next.status !== job.status) notifyJobsChanged();
    } catch (e) {
      setError(toApiError(e));
    }
  };
  usePolling(refreshJob, 1000, !!running);
  // After "Save", the server deletes the file once the download finishes — poll until it reports completed.
  usePolling(refreshJob, 2000, job?.status === 'ready');

  const start = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const options: ProcessOptions = { ...o, quality: o.mediaType === 'audio' ? 'audio' : o.quality };
      const created = await post<JobView>('/api/jobs', { url: analysis.sourceUrl, options, rightsConfirmed: true });
      setJob(created);
      notifyJobsChanged();
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    try {
      setJob(await post<JobView>(`/api/jobs/${job.id}/cancel`));
      notifyJobsChanged();
    } catch (e) {
      setError(toApiError(e));
    }
  };

  const stageLabel: Record<string, string> = {
    queued: 'Processing queued — waiting for a free worker',
    active: 'Processing active — the authorized engine is working',
    ready: 'Ready — your file is prepared',
    completed: 'Completed — file delivered and deleted from the server',
    blocked: 'Blocked — restricted media was not processed',
    failed: 'Failed — no file was produced',
    cancelled: 'Cancelled — no file was produced',
    expired: 'Expired — temporary file deleted',
  };

  return (
    <section className="holo p-4 sm:p-5 animate-rise" aria-labelledby="process-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] tracking-[0.2em] text-signal-bright uppercase">
            Step 2 · Choose an authorized output
          </div>
          <h2 id="process-title" className="font-display text-lg font-semibold text-white">
            Processing panel
          </h2>
        </div>
        {job && <StatusChip status={job.status} />}
      </div>

      <fieldset disabled={!!running || submitting} className="space-y-5">
        <div>
          <span className="label">Media type</span>
          <Segmented
            label="Media type"
            value={o.mediaType}
            onChange={(v) => set('mediaType', v)}
            options={[
              {
                value: 'video',
                label: 'Video',
                icon: 'video',
                disabled: !analysis.hasVideo,
                hint: analysis.hasVideo ? undefined : 'No video stream available',
              },
              { value: 'audio', label: 'Audio', icon: 'music', disabled: !analysis.hasAudio },
              { value: 'thumbnail', label: 'Thumbnail', icon: 'image' },
            ]}
          />
        </div>

        {o.mediaType === 'video' && (
          <div className="grid gap-5 md:grid-cols-[1fr_1.6fr]">
            <div>
              <span className="label">Container</span>
              <Segmented
                label="Video format"
                value={o.container}
                onChange={(v) => set('container', v)}
                options={[
                  { value: 'mp4', label: 'MP4' },
                  { value: 'webm', label: 'WebM' },
                ]}
              />
            </div>
            <div>
              <label className="label" htmlFor="quality">
                Quality
              </label>
              <select
                id="quality"
                className="field"
                value={o.quality}
                onChange={(e) => set('quality', e.target.value as Quality)}
              >
                {(['best', '2160', '1440', '1080', '720', '480'] as Quality[]).map((q) => {
                  const ok = qualityAvailable(q);
                  const size = analysis.estimatedSizes[q];
                  return (
                    <option key={q} value={q} disabled={!ok}>
                      {QUALITY_LABEL[q]}
                      {ok ? (size ? ` · ~${formatBytes(size)}` : '') : ' · not available'}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        )}

        {o.mediaType === 'audio' && (
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <span className="label">Audio format</span>
              <Segmented
                label="Audio format"
                value={o.audioFormat}
                onChange={(v) => set('audioFormat', v)}
                options={[
                  { value: 'mp3', label: 'MP3' },
                  { value: 'm4a', label: 'M4A' },
                  { value: 'wav', label: 'WAV' },
                ]}
              />
            </div>
            <div>
              <span className="label">Audio processing</span>
              <Segmented
                label="Audio processing"
                value={o.audioMode}
                onChange={(v) => set('audioMode', v)}
                options={[
                  { value: 'original', label: 'Original' },
                  { value: 'highest', label: 'Highest' },
                  { value: 'normalized', label: 'Normalized', hint: 'EBU R128 loudness normalization via FFmpeg' },
                ]}
              />
            </div>
            <div>
              <label className="label" htmlFor="bitrate">
                Bitrate
              </label>
              <select
                id="bitrate"
                className="field"
                value={o.audioBitrate}
                disabled={o.audioFormat === 'wav'}
                onChange={(e) => set('audioBitrate', e.target.value as ProcessOptions['audioBitrate'])}
              >
                <option value="auto">Automatic</option>
                {['128', '192', '256', '320'].map((b) => (
                  <option key={b} value={b}>
                    {b} kbps
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {o.mediaType !== 'thumbnail' && (
          <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
            <Toggle
              checked={o.embedMetadata}
              onChange={(v) => set('embedMetadata', v)}
              label="Preserve metadata"
              hint="Title, uploader and date tags"
            />
            <Toggle
              checked={o.embedThumbnail}
              onChange={(v) => set('embedThumbnail', v)}
              label="Embed thumbnail"
              hint={
                o.mediaType === 'video' && o.container === 'webm'
                  ? 'Not supported for WebM'
                  : o.audioFormat === 'wav' && o.mediaType === 'audio'
                    ? 'Not supported for WAV'
                    : 'Cover art for authorized media'
              }
              disabled={
                (o.mediaType === 'video' && o.container === 'webm') || (o.mediaType === 'audio' && o.audioFormat === 'wav')
              }
            />
          </div>
        )}

        {o.mediaType === 'video' && (
          <div>
            <label className="label" htmlFor="subs">
              Subtitles
            </label>
            <select
              id="subs"
              className="field"
              value={o.subtitleLang ?? ''}
              disabled={!analysis.subtitles.length}
              onChange={(e) => set('subtitleLang', e.target.value || null)}
            >
              <option value="">{analysis.subtitles.length ? 'No subtitles' : 'No uploader-published subtitles'}</option>
              {analysis.subtitles.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid gap-3 rounded-xl border border-white/[0.07] bg-obsidian-950/60 p-3 font-mono text-[12px] sm:grid-cols-[auto_1fr]">
          <span className="text-ink-dim">Estimated size</span>
          <span className={tooLarge ? 'text-danger' : 'text-ink'}>
            {o.mediaType === 'thumbnail' ? 'Small image' : estimate ? `~${formatBytes(estimate)}` : 'Unknown until processed'}
            {tooLarge && ` · exceeds ${formatBytes(analysis.limits.maxFileSizeBytes)} limit`}
          </span>
          <span className="text-ink-dim">Output file</span>
          <span className="break-all text-ink">{filename}</span>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-cyan/20 bg-cyan/[0.04] p-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#8b5cf6]"
            checked={rights}
            onChange={(e) => setRights(e.target.checked)}
          />
          <span className="text-sm text-ink-muted">
            <span className="font-semibold text-white">I own this media or have permission to process it.</span> I understand that
            a public link does not grant unrestricted use, and I will follow the platform’s terms and copyright law.
          </span>
        </label>
      </fieldset>

      {error && (
        <div className="mt-4">
          <ErrorCallout error={error} />
        </div>
      )}

      {job && (
        <div className="mt-5 rounded-2xl border border-white/[0.08] bg-obsidian-950/70 p-4" aria-live="polite">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="text-ink">{stageLabel[job.status]}</span>
            <span className="font-mono text-[12px] text-ink-dim">{Math.round(job.progress * 100)}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-white/5"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(job.progress * 100)}
            aria-label="Processing progress"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${running ? 'progress-scan' : ''} ${
                job.status === 'failed'
                  ? 'bg-danger'
                  : job.status === 'blocked'
                    ? 'bg-warn'
                    : 'bg-gradient-to-r from-signal via-signal-bright to-cyan'
              }`}
              style={{ width: `${job.status === 'queued' ? 3 : Math.max(3, job.progress * 100)}%` }}
            />
          </div>
          {job.errorMessage && (job.status === 'failed' || job.status === 'blocked') && (
            <p className="mt-3 text-sm text-ink-muted">
              {job.errorMessage} <span className="font-mono text-[11px] text-ink-dim">({job.errorCode})</span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(job.status === 'ready' || job.status === 'completed') && (
              <a
                href={`/api/jobs/${job.id}/file`}
                download
                className="btn-primary"
                onClick={() => window.setTimeout(() => void refreshJob(), 1500)}
              >
                <Icon name="download" /> Save {job.outputFilename ? `(${formatBytes(job.outputSizeBytes)})` : 'file'}
              </a>
            )}
            {running && (
              <button type="button" className="btn-danger" onClick={cancel}>
                <Icon name="stop" size={15} /> Cancel processing
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => setLogsOpen((v) => !v)} aria-expanded={logsOpen}>
              <Icon name="terminal" size={15} /> {logsOpen ? 'Hide' : 'Show'} technical log
            </button>
            <span className="font-mono text-[11px] text-ink-dim">req · {job.requestId}</span>
          </div>
          {logsOpen && (
            <pre className="mt-3 max-h-56 overflow-auto rounded-xl border border-white/[0.06] bg-void p-3 text-[11px] leading-relaxed text-ink-muted">
              {job.logs.join('\n') || 'Waiting for the engine…'}
            </pre>
          )}
          {job.expiresAt && job.status === 'ready' && (
            <p className="mt-3 text-xs text-ink-dim">
              Temporary file — deleted automatically {new Date(job.expiresAt).toLocaleTimeString()}.
            </p>
          )}
        </div>
      )}

      {/* Sticky on mobile so the main action is always reachable */}
      <div className="sticky bottom-[72px] z-10 -mx-4 mt-5 border-t border-white/[0.06] bg-obsidian-900/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        {!canProcess ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-muted">Sign in to process media and use API features.</p>
            <Link href="/login" className="btn-primary">
              <Icon name="user" /> Sign in to process
            </Link>
          </div>
        ) : (
          <button
            type="button"
            className="btn-primary w-full md:w-auto"
            disabled={!rights || submitting || !!running || tooLarge || maintenance}
            onClick={start}
          >
            {submitting ? <Spinner /> : <Icon name="bolt" />}
            {maintenance
              ? 'Processing paused for maintenance'
              : running
                ? 'Processing…'
                : job && TERMINAL_STATUSES.includes(job.status)
                  ? 'Process again'
                  : 'Start processing'}
          </button>
        )}
      </div>
    </section>
  );
}
