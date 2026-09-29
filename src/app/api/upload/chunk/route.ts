// Chunk upload (Story 2.1 / 2.4): Bearer session, `can(upload)` and
// ownership of the upload session are required before any byte is written.
import { NextRequest, NextResponse } from 'next/server';
import { uploadChunk } from '@/services/upload.service';
import prisma from '@/lib/prisma';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { errorCodeOf } from '@/lib/errorCodes';
import { can } from '@/modules/auth';
import { errMessage, logger } from '@/lib/logger';

// Manual multipart parser — handles chunked transfer encoding from nginx
// proxy_request_buffering off causes req.formData() to fail
async function parseMultipart(req: NextRequest): Promise<{
  sessionId: string; chunkIndex: number; chunkData: Buffer;
} | null> {
  const ct = req.headers.get('content-type') || '';
  const m = ct.match(/boundary=(.+)$/);
  if (!m) return null;
  const boundary = m[1].replace(/^["']|["']$/g, '');

  const buf = Buffer.from(await req.arrayBuffer());
  const bBoundary = Buffer.from(`--${boundary}`);
  const bEnd = Buffer.from(`--${boundary}--`);

  let sessionId = '';
  let chunkIndex = 0;
  let chunkData: Buffer | null = null;

  let pos = bBoundary.length + 2; // past first boundary + \r\n
  while (pos < buf.length) {
    const next = buf.indexOf(bBoundary, pos);
    if (next === -1) break;
    const part = buf.slice(pos, next - 2); // -2 for \r\n before boundary
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString();
      const body = part.slice(headerEnd + 4);
      const nm = headers.match(/name="?([^";\s]+)"?/);
      if (nm) {
        if (nm[1] === 'sessionId') sessionId = body.toString();
        else if (nm[1] === 'chunkIndex') chunkIndex = parseInt(body.toString(), 10);
        else if (nm[1] === 'file') chunkData = body;
      }
    }
    pos = next + bBoundary.length;
    if (buf.slice(next, next + bEnd.length).equals(bEnd)) break;
    pos += 2; // skip \r\n
  }

  if (!sessionId || !chunkData) return null;
  return { sessionId, chunkIndex, chunkData };
}

export const POST = defineRoute({
  auth: 'session',
  action: 'upload',
  handler: async ({ req, actor }) => {
    const startMs = Date.now();
    if (!can(actor, 'upload')) return jsonError(403, 'FORBIDDEN', 'Forbidden: upload');

    const parsed = await parseMultipart(req);
    if (!parsed) return jsonError(400, 'BAD_REQUEST', 'Invalid multipart data');

    const session = await prisma.uploadSession.findUnique({
      where: { id: parsed.sessionId },
      select: { uploadedById: true },
    });
    if (!session) return jsonError(404, 'NOT_FOUND', 'Upload session not found');
    if (!can(actor, 'upload', { ownerId: session.uploadedById })) {
      return jsonError(403, 'FORBIDDEN', 'Upload session belongs to another user');
    }
    if (!Number.isInteger(parsed.chunkIndex) || parsed.chunkIndex < 0) {
      return jsonError(400, 'BAD_REQUEST', 'Invalid chunk index');
    }

    try {
      await uploadChunk({
        sessionId: parsed.sessionId,
        chunkIndex: parsed.chunkIndex,
        chunkData: parsed.chunkData,
      });
    } catch (error) {
      logger('upload-chunk').error('chunk failed', { ms: Date.now() - startMs, err: errMessage(error) });
      // A closed or vanished session keeps its own code; anything else is UPLOAD_FAILED.
      const code = errorCodeOf(error);
      if (code === 'UPLOAD_SESSION_CLOSED' || code === 'UPLOAD_SESSION_NOT_FOUND') {
        return jsonError(409, code, 'Upload session is not open');
      }
      return jsonError(409, 'UPLOAD_FAILED', 'Chunk could not be stored');
    }
    return NextResponse.json({ success: true, chunkIndex: parsed.chunkIndex });
  },
});
