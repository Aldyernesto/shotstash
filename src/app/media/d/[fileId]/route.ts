// Original bytes as an attachment (Range for parallel download). Cookie session.
import { defineRoute } from '@/lib/defineRoute';
import { mediaGuard, serveFile } from '@/modules/media';

export const dynamic = 'force-dynamic';

const handler = defineRoute<{ fileId: string }>({
  auth: 'cookie',
  action: 'media.download',
  handler: async ({ req, actor, params }) => {
    const g = await mediaGuard(actor, params.fileId);
    if (!g.ok) return g.response;
    return serveFile(req, g.file, 'download', 'cookie');
  },
});

/**
 * Download a file
 * @description The original bytes as an attachment; Range is supported for parallel and resumed downloads.
 * @tag Media
 * @auth cookie
 * @pathParams FilePathParams
 * @response 200:MediaBytes:The whole file
 * @response 206:MediaBytes:One byte range
 * @response 401:ErrorBody:No valid session
 * @response 403:ErrorBody:FORBIDDEN
 * @response 404:ErrorBody:NOT_FOUND
 * @response 416:NoBody:Range not satisfiable
 * @openapi
 */
export const GET = handler;
/**
 * Download a file (headers only)
 * @description Same as GET without the body. The original bytes as an attachment; Range is supported for parallel and resumed downloads.
 * @tag Media
 * @auth cookie
 * @pathParams FilePathParams
 * @response 200:MediaBytes:The whole file
 * @response 206:MediaBytes:One byte range
 * @response 401:ErrorBody:No valid session
 * @response 403:ErrorBody:FORBIDDEN
 * @response 404:ErrorBody:NOT_FOUND
 * @response 416:NoBody:Range not satisfiable
 * @openapi
 */
export const HEAD = handler;
