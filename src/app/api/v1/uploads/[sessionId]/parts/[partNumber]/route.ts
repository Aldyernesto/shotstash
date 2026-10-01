/**
 * Upload part (Story 4.3): `PUT /api/v1/uploads/:sessionId/parts/:partNumber`.
 *
 * Bearer session, `can(upload)` on the uploader's own session. The raw body
 * streams to the storage backend, capped at the part size the server chose
 * at initiate; `Content-MD5` (base64, RFC 1864) is required and checked.
 * Idempotent per part: sending a part again replaces it.
 *
 *   200 { partNumber, size, confirmedParts, partCount }
 *   400 PART_CHECKSUM_MISMATCH | PART_CHECKSUM_REQUIRED | PART_SIZE_MISMATCH | INVALID_PART_NUMBER
 *   403 FORBIDDEN (another user's session)   404 UPLOAD_SESSION_NOT_FOUND
 *   409 UPLOAD_SESSION_CLOSED   410 UPLOAD_SESSION_EXPIRED   429 RATE_LIMITED
 *   503 STORAGE_UNAVAILABLE
 */
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import type { UploadPartResponse } from '@/lib/apiContract/uploads';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { limitBy, rateLimitedResponse } from '@/lib/rateLimit';
import { can } from '@/modules/auth';
import { UploadFailure, putPart } from '@/modules/upload';

export const dynamic = 'force-dynamic';

const ID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Upload one part
 * @description Streams one part of a resumable upload started with the initiateUpload mutation. The body is the raw bytes; Content-MD5 is required and checked. Sending a part again replaces it.
 * @tag Uploads
 * @auth session
 * @pathParams UploadPartPathParams
 * @header UploadPartHeaders
 * @contentType application/octet-stream
 * @body BinaryBody
 * @response 200:UploadPartResponse:Part stored
 * @response 400:ErrorBody:PART_CHECKSUM_MISMATCH or PART_CHECKSUM_REQUIRED or PART_SIZE_MISMATCH or INVALID_PART_NUMBER
 * @response 401:ErrorBody:No valid session
 * @response 403:ErrorBody:FORBIDDEN (another user session)
 * @response 404:ErrorBody:UPLOAD_SESSION_NOT_FOUND
 * @response 409:ErrorBody:UPLOAD_SESSION_CLOSED
 * @response 410:ErrorBody:UPLOAD_SESSION_EXPIRED
 * @response 429:ErrorBody:RATE_LIMITED
 * @response 503:ErrorBody:STORAGE_UNAVAILABLE
 * @openapi
 */
export const PUT = defineRoute<{ sessionId: string; partNumber: string }>({
  auth: 'session',
  action: 'upload',
  handler: async ({ req, actor, params }) => {
    if (!can(actor, 'upload')) return jsonError(403, 'FORBIDDEN', 'Forbidden: upload');
    if (!ID_RE.test(params.sessionId)) return jsonError(404, 'UPLOAD_SESSION_NOT_FOUND', 'Upload session not found');
    const partNumber = Number(params.partNumber);
    if (!/^\d{1,5}$/.test(params.partNumber) || !Number.isInteger(partNumber) || partNumber < 1) {
      return jsonError(400, 'INVALID_PART_NUMBER', 'Invalid part number');
    }
    const limited = await limitBy('uploadPart', actor!.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfter);

    const lengthHeader = req.headers.get('content-length');
    const contentLength = lengthHeader !== null && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
    const body = req.body ? Readable.fromWeb(req.body as never) : Readable.from([]);
    try {
      const result = await putPart({
        actor: actor!,
        sessionId: params.sessionId,
        partNumber,
        body,
        contentLength,
        md5: req.headers.get('content-md5'),
      });
      // Exactly the documented body: no field more, no field less.
      const answer: UploadPartResponse = {
        partNumber: result.partNumber,
        size: result.size,
        confirmedParts: result.confirmedParts,
        partCount: result.partCount,
      } satisfies Record<keyof typeof result, unknown>;
      return NextResponse.json(answer);
    } catch (err) {
      body.destroy();
      if (err instanceof UploadFailure) return jsonError(err.status, err.code, err.message, err.details);
      throw err;
    }
  },
});
