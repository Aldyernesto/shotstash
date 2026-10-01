// Cover upload: project covers (`kind=project`, needs `section.create`) and
// user avatars (`kind=user`, any writable account). The image is re-encoded
// to JPEG and stored through the storage backend; the answer is the
// relative cookie-authorised URL `/media/c/<kind>/<id>?v=<n>`.
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import type { CoverResponse } from '@/lib/apiContract/uploads';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { can } from '@/modules/auth';
import { MAX_COVER_BYTES, coverUrl, saveCover, type CoverKind } from '@/modules/media';

/**
 * Upload a cover or avatar
 * @description Multipart form with kind (project or user) and file. Project covers need section.create; an avatar needs an active writable account. The image is re-encoded to JPEG; the answer names its cookie-authorised URL under /media/c.
 * @tag Uploads
 * @auth session
 * @contentType multipart/form-data
 * @body CoverUploadForm
 * @response 200:CoverResponse:Cover stored
 * @response 400:ErrorBody:BAD_REQUEST
 * @response 401:ErrorBody:No valid session
 * @response 403:ErrorBody:FORBIDDEN
 * @response 413:ErrorBody:TOO_LARGE (over 10 MiB)
 * @response 415:ErrorBody:UNSUPPORTED_TYPE
 * @openapi
 */
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

    const id = randomUUID();
    const saved = await saveCover(kind, id, Buffer.from(await file.arrayBuffer()));
    if (!saved.ok) return jsonError(415, 'UNSUPPORTED_TYPE', 'Unsupported image type');

    return NextResponse.json({ url: coverUrl(kind, id), id } satisfies CoverResponse);
  },
});
