// Cover upload: project covers (`kind=project`, needs `section.create`) and
// user avatars (`kind=user`, any writable account). Answers the relative
// cookie-authorised URL `/media/c/<kind>/<id>`; nothing absolute is stored.
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { can } from '@/modules/auth';
import { COVER_EXTENSIONS, coverUrl, coversDir, type CoverKind } from '@/modules/media';

const MAX_COVER_BYTES = 10 * 1024 * 1024;

export const POST = defineRoute({
  auth: 'session',
  action: 'section.create (project) / self (user)',
  handler: async ({ req, actor }) => {
    const formData = await req.formData().catch(() => null);
    if (!formData) return jsonError(400, 'BAD_REQUEST', 'Invalid form data');
    const kind: CoverKind = formData.get('kind') === 'user' ? 'user' : 'project';

    const allowed =
      kind === 'user'
        ? !!actor && actor.active && actor.accountStatus === 'ACTIVE' && !actor.readOnly
        : can(actor, 'section.create');
    if (!allowed) return jsonError(403, 'FORBIDDEN', 'Forbidden');

    const file = formData.get('file');
    if (!(file instanceof File)) return jsonError(400, 'BAD_REQUEST', 'No file provided');
    if (file.size > MAX_COVER_BYTES) return jsonError(413, 'TOO_LARGE', 'Cover is too large');

    const ext = path.extname(file.name).toLowerCase() || '.jpg';
    if (!COVER_EXTENSIONS.includes(ext)) return jsonError(415, 'UNSUPPORTED_TYPE', 'Unsupported image type');

    const id = randomUUID();
    await fs.mkdir(coversDir(), { recursive: true });
    await fs.writeFile(path.join(coversDir(), `${id}${ext}`), Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({ url: coverUrl(kind, id), id });
  },
});
