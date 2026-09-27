import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import prisma from '@/lib/prisma';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;

  const file = await prisma.mediaFile.findUnique({ where: { id: fileId } });
  if (!file?.thumbnailPath) {
    return new NextResponse('No thumbnail', { status: 404 });
  }

  try {
    const fileStat = await stat(file.thumbnailPath);
    const stream = createReadStream(file.thumbnailPath);
    const webStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => controller.enqueue(chunk));
        stream.on('end', () => controller.close());
        stream.on('error', (err) => controller.error(err));
      },
      cancel() { stream.destroy(); },
    });

    return new NextResponse(webStream, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new NextResponse('Thumbnail not found', { status: 404 });
  }
}
