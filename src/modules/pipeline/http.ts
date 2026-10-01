/**
 * Small helpers shared by the `/api/v1/pipeline/*` route handlers: bounded
 * JSON bodies and the `{ code, message }` answer of a refused call.
 */
import { PipelineFailure } from './contract.ts';

/** JSON bodies of the contract are small; anything larger is refused. */
const MAX_JSON_BYTES = 64 * 1024;

/** Parses a JSON body of at most 64 KiB. An empty body reads as `{}`. Throws INVALID_BODY. */
export async function readJsonBody(req: Request): Promise<unknown> {
  const length = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) throw new PipelineFailure(400, 'INVALID_BODY', 'The body is too large');
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new PipelineFailure(400, 'INVALID_BODY', 'The body is too large');
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
