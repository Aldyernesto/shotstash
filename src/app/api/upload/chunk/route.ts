import { NextRequest, NextResponse } from 'next/server';
import { uploadChunk } from '@/services/upload.service';
import prisma from '@/lib/prisma';

async function getUserFromHeader(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true }
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

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

export async function POST(req: NextRequest) {
  const startMs = Date.now();
  console.log(`[chunk] REQ content-type=${req.headers.get('content-type')} content-length=${req.headers.get('content-length')} cf-ray=${req.headers.get('cf-ray')} cf-ipcountry=${req.headers.get('cf-ipcountry')}`);
  try {
    const user = await getUserFromHeader(req);
    console.log(`[chunk] user=${user?.id || 'null'} email=${user?.email || 'null'}`);

    const parsed = await parseMultipart(req);
    if (!parsed) {
      console.log(`[chunk] PARSE FAILED after ${Date.now() - startMs}ms`);
      return NextResponse.json({ error: 'Invalid multipart data' }, { status: 400 });
    }

    console.log(`[chunk] PARSED sessionId=${parsed.sessionId} chunkIndex=${parsed.chunkIndex} dataSize=${parsed.chunkData.length}`);

    await uploadChunk({
      sessionId: parsed.sessionId,
      chunkIndex: parsed.chunkIndex,
      chunkData: parsed.chunkData,
    });

    console.log(`[chunk] DONE sessionId=${parsed.sessionId} chunkIndex=${parsed.chunkIndex} elapsed=${Date.now() - startMs}ms`);
    return NextResponse.json({ success: true, chunkIndex: parsed.chunkIndex });
  } catch (error: any) {
    console.error(`[chunk] ERROR after ${Date.now() - startMs}ms:`, error.message || error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
