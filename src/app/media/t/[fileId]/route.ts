// Thumbnail of a library file (cookie session). `?v=<thumb_version>` equal
// to the current version is cached for a year (immutable); other values get
// the short policy. Trashed files keep their thumbnail for Trash viewers.
import { defineRoute } from '@/lib/defineRoute';
import { serveFile, thumbnailCache, thumbnailGuard } from '@/modules/media';

export const dynamic = 'force-dynamic';

const handler = defineRoute<{ fileId: string }>({
  auth: 'cookie',
  action: 'media.download',
  handler: async ({ req, actor, params }) => {
    const g = await thumbnailGuard(actor, params.fileId);
    if (!g.ok) return g.response;
    const v = new URL(req.url).searchParams.get('v');
    return serveFile(req, g.file, 'thumbnail', thumbnailCache(g.file, v, g.trashed));
  },
});

/**
 * File thumbnail
 * @description The JPEG thumbnail of a library file. With v equal to the current thumbnail version the answer is cached for a year.
 * @tag Media
 * @auth cookie
 * @pathParams FilePathParams
 * @params ThumbnailQuery
 * @response 200:JpegImage:The thumbnail
 * @response 401:ErrorBody:No valid session
 * @response 403:ErrorBody:FORBIDDEN
 * @response 404:ErrorBody:NOT_FOUND
 * @openapi
 */
export const GET = handler;
/**
 * File thumbnail (headers only)
 * @description Same as GET without the body. The JPEG thumbnail of a library file. With v equal to the current thumbnail version the answer is cached for a year.
 * @tag Media
 * @auth cookie
 * @pathParams FilePathParams
 * @params ThumbnailQuery
 * @response 200:JpegImage:The thumbnail
 * @response 401:ErrorBody:No valid session
 * @response 403:ErrorBody:FORBIDDEN
 * @response 404:ErrorBody:NOT_FOUND
 * @openapi
 */
export const HEAD = handler;
