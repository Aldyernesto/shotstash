/**
 * Byte responses for `/media/**`: single files with Range support and
 * streamed ZIP archives. The only place that opens media files for reading.
 */

import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { stat } from 'fs/promises';
import archiver from 'archiver';
import { parseRange } from './range';

export const CACHE_COOKIE = 'private, max-age=3600';
export const CACHE_SIGNED = 'private, max-age=300';

export type CachePolicy = 'cookie' | 'signed';

function cacheHeaders(policy: CachePolicy): Record<string, string> {
  return policy === 'cookie'
    ? { 'Cache-Control': CACHE_COOKIE, Vary: 'Cookie' }
    : { 'Cache-Control': CACHE_SIGNED };
}

export function notFoundResponse() {
  return Response.json({ code: 'NOT_FOUND', message: 'Not found' }, { status: 404 });
}

export function forbiddenResponse() {
  return Response.json({ code: 'FORBIDDEN', message: 'Forbidden' }, { status: 403 });
}

/** `attachment; filename="..."; filename*=UTF-8''...` with an ASCII fallback. */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Pull-based web stream: the file is read only as fast as the client consumes it. */
function nodeToWeb(path: string, opts?: { start: number; end: number }): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path, opts)) as unknown as ReadableStream<Uint8Array>;
}

export type FileResponseInput = {
  req: Request;
  path: string;
  mimeType: string;
  cache: CachePolicy;
  /** Omit for thumbnails and covers (no Content-Disposition). */
  disposition?: { kind: 'inline' | 'attachment'; filename: string };
};

/** 200 / 206 / 416 file response; HEAD answers headers only. Missing file on disk: 404. */
export async function fileResponse(input: FileResponseInput): Promise<Response> {
  let size: number;
  try {
    const s = await stat(input.path);
    if (!s.isFile()) return notFoundResponse();
    size = s.size;
  } catch {
    return notFoundResponse();
  }

  const base: Record<string, string> = {
    'Content-Type': input.mimeType || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    ...cacheHeaders(input.cache),
  };
  if (input.disposition) base['Content-Disposition'] = contentDisposition(input.disposition.kind, input.disposition.filename);

  const head = input.req.method === 'HEAD';
  const range = parseRange(input.req.headers.get('range'), size);

  if (range.kind === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  }
  if (range.kind === 'ok') {
    const headers = {
      ...base,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Content-Length': String(range.end - range.start + 1),
    };
    return new Response(head ? null : nodeToWeb(input.path, { start: range.start, end: range.end }), {
      status: 206,
      headers,
    });
  }
  return new Response(head ? null : nodeToWeb(input.path), {
    status: 200,
    headers: { ...base, 'Content-Length': String(size) },
  });
}

export type ZipEntry = { path: string; name: string };

/** Streams a ZIP. Missing files are skipped and listed in `_MISSING_FILES.txt`. */
export async function zipResponse(input: {
  entries: ZipEntry[];
  emptyDirs?: string[];
  zipName: string;
  cache: CachePolicy;
}): Promise<Response> {
  const archive = archiver('zip', { zlib: { level: 1 } });
  const skipped: string[] = [];
  const present: ZipEntry[] = [];
  for (const e of input.entries) {
    try {
      const s = await stat(e.path);
      if (s.isFile()) present.push(e);
      else skipped.push(e.name);
    } catch {
      skipped.push(e.name);
    }
  }
  for (const e of present) archive.file(e.path, { name: e.name });
  for (const d of input.emptyDirs ?? []) archive.append('', { name: d.endsWith('/') ? d : `${d}/` });
  if (skipped.length) {
    archive.append(
      `These files were skipped because they could not be read from storage:\n\n${skipped.map((s) => `  - ${s}`).join('\n')}\n`,
      { name: '_MISSING_FILES.txt' },
    );
  }

  // Readable.toWeb pulls from the archive, so a slow client pauses zipping
  // instead of buffering the whole archive in memory.
  const body = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
  void archive.finalize().catch(() => archive.abort());

  return new Response(body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('attachment', input.zipName),
      'X-Content-Type-Options': 'nosniff',
      ...cacheHeaders(input.cache),
    },
  });
}
