import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import prisma from '@/lib/prisma';

const STORAGE_LOCAL_ROOT = process.env.STORAGE_LOCAL_ROOT || './data/media';
const COVERS_DIR = path.join(STORAGE_LOCAL_ROOT, 'covers');

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

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromHeader(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const ext = path.extname(file.name).toLowerCase() || '.jpg';
    const id = randomUUID();
    const filename = `${id}${ext}`;

    await fs.mkdir(COVERS_DIR, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(path.join(COVERS_DIR, filename), buffer);

    const url = `http://localhost:3005/api/cover/${id}`;
    return NextResponse.json({ url, id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
