import type { ProcessOptions } from '../../shared/types.js';
import { QUALITY_HEIGHTS } from './metadata.js';

/**
 * All yt-dlp arguments are assembled from enumerated options — no user-supplied
 * string ever becomes a flag or a format expression. The URL is always passed
 * after `--` so it can never be parsed as an option.
 */

/** Flags applied to every invocation. */
export function baseArgs(): string[] {
  return [
    '--ignore-config', // never load operator/user config files that could add cookies or exec hooks
    '--no-cookies',
    '--no-cookies-from-browser',
    '--no-playlist',
    '--no-warnings',
    '--no-color',
    '--socket-timeout',
    '20',
    '--retries',
    '2',
    '--fragment-retries',
    '3',
    '--no-mtime',
    '--no-cache-dir',
  ];
}

export function analyzeArgs(url: string): string[] {
  return [...baseArgs(), '--skip-download', '--dump-single-json', '--no-progress', '--', url];
}

export const PROGRESS_MARK = 'RXP|';

export function videoFormatSelector(opts: ProcessOptions): string {
  const h = opts.quality === 'best' || opts.quality === 'audio' ? null : QUALITY_HEIGHTS[opts.quality];
  const hf = h ? `[height<=${h}]` : '';
  if (opts.container === 'webm') {
    return `bv*${hf}[ext=webm]+ba[ext=webm]/bv*${hf}[vcodec~='^(vp0?9|av01)']+ba[acodec=opus]/b${hf}[ext=webm]`;
  }
  return `bv*${hf}[ext=mp4]+ba[ext=m4a]/bv*${hf}+ba/b${hf}`;
}

export function expectedStreams(opts: ProcessOptions): number {
  return opts.mediaType === 'video' ? 2 : 1;
}

export interface DownloadArgsInput {
  url: string;
  outputTemplate: string;
  options: ProcessOptions;
  maxFileSizeBytes: number;
  ffmpegBin: string;
  /** Subtitle languages actually published by the uploader (from analysis). */
  allowedSubtitleLangs: string[];
}

export function downloadArgs(input: DownloadArgsInput): string[] {
  const { options: o } = input;
  const args = [
    ...baseArgs(),
    '--newline',
    '--progress-template',
    `download:${PROGRESS_MARK}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s`,
    '--max-filesize',
    String(input.maxFileSizeBytes),
    '-o',
    input.outputTemplate,
  ];

  if (input.ffmpegBin.includes('/')) args.push('--ffmpeg-location', input.ffmpegBin);

  if (o.mediaType === 'thumbnail') {
    args.push('--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg');
    return [...args, '--', input.url];
  }

  if (o.mediaType === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', o.audioFormat);
    if (o.audioFormat !== 'wav') {
      if (o.audioBitrate !== 'auto') args.push('--audio-quality', `${o.audioBitrate}K`);
      else if (o.audioMode === 'highest' || o.audioMode === 'normalized') args.push('--audio-quality', '0');
    }
  } else {
    args.push('-f', videoFormatSelector(o), '--merge-output-format', o.container);
  }

  if (o.embedMetadata) args.push('--embed-metadata');
  const thumbCapable = o.mediaType === 'video' ? o.container === 'mp4' : o.audioFormat !== 'wav';
  if (o.embedThumbnail && thumbCapable) args.push('--embed-thumbnail', '--convert-thumbnails', 'jpg');

  if (o.mediaType === 'video' && o.subtitleLang && input.allowedSubtitleLangs.includes(o.subtitleLang)) {
    // Uploader-published subtitles only — never auto-generated captions.
    args.push('--write-subs', '--no-write-auto-subs', '--sub-langs', o.subtitleLang, '--embed-subs');
  }

  return [...args, '--', input.url];
}

export function qualityLabel(o: ProcessOptions): string {
  if (o.mediaType === 'thumbnail') return 'thumbnail';
  if (o.mediaType === 'audio') {
    const br = o.audioBitrate !== 'auto' && o.audioFormat !== 'wav' ? ` ${o.audioBitrate}k` : '';
    return `${o.audioFormat}${br}${o.audioMode === 'normalized' ? ' normalized' : ''}`;
  }
  return o.quality === 'best' ? `best ${o.container}` : `${o.quality}p ${o.container}`;
}

export function outputExtension(o: ProcessOptions): string {
  if (o.mediaType === 'thumbnail') return 'jpg';
  if (o.mediaType === 'audio') return o.audioFormat;
  return o.container;
}
