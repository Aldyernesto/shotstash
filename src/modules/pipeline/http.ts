/**
 * Small helpers shared by the `/api/v1/pipeline/*` route handlers: bounded
 * JSON bodies and the `{ code, message }` answer of a refused call.
 */
import { PipelineFailure } from './contract.ts';

/** JSON bodies of the contract are small; anything larger is refused. */
export const MAX_JSON_BYTES = 64 * 1024;

/**
 * Parses a JSON body of at most 64 KiB, counting bytes as they stream in
 * (with or without Content-Length); a larger body is refused with 413
 * BODY_TOO_LARGE as soon as it passes the limit. An empty body reads as `{}`.
 */
export async function readJsonBody(req: Request): Promise<unknown> {
  const tooLarge = () => new PipelineFailure(413, 'BODY_TOO_LARGE', `The body is larger than ${MAX_JSON_BYTES} bytes`);
  const length = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new PipelineFailure(400, 'INVALID_BODY', 'The body is not valid JSON');
  }
}

/** The JSON answer of a refused contract call, or null when `err` is something else. */
export function pipelineErrorResponse(err: unknown): Response | null {
  if (!(err instanceof PipelineFailure)) return null;
  return Response.json({ code: err.code, message: err.message }, { status: err.status, headers: { 'Cache-Control': 'no-store' } });
}
