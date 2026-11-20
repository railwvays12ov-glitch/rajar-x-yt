import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { JOB_STATUSES } from '../../../shared/types.js';
import { decodeCursor, encodeCursor, type JobOwner } from '../../db/store.js';
import { contentDisposition } from '../../media/filename.js';
import { toJobView } from '../../services/jobService.js';
import { AppError } from '../appError.js';
import type { AppContext } from '../context.js';

export const activityQuerySchema = z.object({
  platform: z.enum(['youtube', 'instagram', 'tiktok', 'x', 'facebook', 'other']).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function listActivity(ctx: AppContext, owner: JobOwner, query: unknown) {
  const q = activityQuerySchema.parse(query);
  const rows = await ctx.store.listJobs({
    owner,
    platform: q.platform,
    status: q.status,
    cursor: decodeCursor(q.cursor),
    limit: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  return {
    items: page.map(toJobView),
    nextCursor: rows.length > q.limit ? encodeCursor(page[page.length - 1]!) : null,
  };
}

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  jpg: 'image/jpeg',
};

/** Streams a finished job's file. Paths never leave the server. */
export async function sendJobFile(ctx: AppContext, req: Request, res: Response, owner: JobOwner | null, isAdmin = false) {
  const job = await ctx.jobs.getOwned(String(req.params.id), owner, isAdmin);
  if (job.status === 'expired' || (job.expiresAt && job.expiresAt <= new Date())) throw new AppError('JOB_EXPIRED');
  if (job.status === 'completed') throw new AppError('JOB_EXPIRED'); // delivered once, then deleted
  if (job.status !== 'ready' || !job.outputRef) throw new AppError('JOB_NOT_READY');

  const full = ctx.engine.resolveOutput(job.outputRef);
  const s = await stat(full).catch(() => null);
  if (!s?.isFile()) throw new AppError('JOB_EXPIRED');

  const ext = job.outputRef.split('.').pop() ?? '';
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', String(s.size));
  res.setHeader('Content-Disposition', contentDisposition(job.outputFilename ?? `rajar-x-media.${ext}`));
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(full);
    stream.on('error', reject);
    res.on('close', () => {
      stream.destroy();
      resolve();
    });
    res.on('finish', () => {
      void ctx.jobs.markDownloaded(job);
      resolve();
    });
    stream.pipe(res);
  });
}
