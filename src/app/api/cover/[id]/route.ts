import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const STORAGE_LOCAL_ROOT = process.env.STORAGE_LOCAL_ROOT || './data/media';
const COVERS_DIR = path.join(STORAGE_LOCAL_ROOT, 'covers');

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const dir = await fs.readdir(COVERS_DIR).catch(() => [] as string[]);
    const match = dir.find((f) => f.startsWith(id));
    if (!match) return NextResponse.json({ error: 'Cover not found' }, { status: 404 });

    const filePath = path.join(COVERS_DIR, match);
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(match).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.gif': 'image/gif',
    };

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeTypes[ext] || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
