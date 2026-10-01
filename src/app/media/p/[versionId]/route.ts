// A processed version (Story 4.4) as an attachment, authorised like its
// parent file (cookie session, media.download, parent live). Range and HEAD.
import { defineRoute } from '@/lib/defineRoute';
import { processedVersionResponse } from '@/modules/media';

export const dynamic = 'force-dynamic';

const handler = defineRoute<{ versionId: string }>({
  auth: 'cookie',
  action: 'media.download',
  handler: ({ req, actor, params }) => processedVersionResponse(req, actor, params.versionId),
});

/**
 * Download a processed version
 * @description A processed version (such as a 720p proxy) as an attachment; allowed like its parent file. Range is supported.
 * @tag Media
 * @auth cookie
 * @pathParams VersionPathParams
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
 * Download a processed version (headers only)
 * @description Same as GET without the body. A processed version (such as a 720p proxy) as an attachment; allowed like its parent file. Range is supported.
 * @tag Media
 * @auth cookie
 * @pathParams VersionPathParams
 * @response 200:MediaBytes:The whole file
 * @response 206:MediaBytes:One byte range
 * @response 401:ErrorBody:No valid session
 * @response 403:ErrorBody:FORBIDDEN
 * @response 404:ErrorBody:NOT_FOUND
 * @response 416:NoBody:Range not satisfiable
 * @openapi
 */
export const HEAD = handler;
