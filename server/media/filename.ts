const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Produces a filename safe for every major filesystem and for Content-Disposition.
 * Strips path separators, control chars, reserved names, leading dots and bidi overrides.
 */
export function sanitizeFilename(input: string | null | undefined, fallback = 'rajar-x-media', maxLength = 120): string {
  let s = (input ?? '')
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069\u200b-\u200f\ufeff]/g, '')
    .replace(/[/\\?%*:|"<>#]/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s-]+|[.\s]+$/g, '');

  if (!s || RESERVED.test(s.split('.')[0] ?? '')) s = fallback;
  if (s.length > maxLength) s = s.slice(0, maxLength).trim();
  return s;
}

export function buildOutputFilename(title: string | null, label: string, ext: string): string {
  const safeExt =
    ext
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 5)
      .toLowerCase() || 'bin';
  const base = sanitizeFilename(title, 'rajar-x-media', 100);
  const suffix = sanitizeFilename(label, '', 20);
  return `${base}${suffix ? ` [${suffix}]` : ''}.${safeExt}`;
}

/** RFC 6266 / 5987 Content-Disposition with an ASCII fallback. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
