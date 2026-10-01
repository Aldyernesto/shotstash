// Signed share media (file, thumbnail or ZIP). The token is re-checked against the ShareLink row.
import { defineRoute } from '@/lib/defineRoute';
import { signedMediaResponse } from '@/modules/media';

export const dynamic = 'force-dynamic';

const handler = defineRoute<{ token: string }>({
  auth: 'signed',
  handler: ({ req, params }) => signedMediaResponse(req, params.token),
});

/**
 * Signed share media
 * @description A file or thumbnail or ZIP of a share link through an HMAC-signed URL minted by the share page (valid 5 minutes; ZIPs 24 hours). The token is checked again against the live share link. Range is supported for files.
 * @tag Media
 * @auth signed
 * @pathParams SignedMediaPathParams
 * @params SignedMediaQuery
 * @response 200:MediaBytes:The file or thumbnail or ZIP
 * @response 206:MediaBytes:One byte range
 * @response 404:ErrorBody:NOT_FOUND (bad or expired token or a dead link)
 * @response 416:NoBody:Range not satisfiable
 * @openapi
 */
export const GET = handler;
/**
 * Signed share media (headers only)
 * @description Same as GET without the body. A file or thumbnail or ZIP of a share link through an HMAC-signed URL minted by the share page (valid 5 minutes; ZIPs 24 hours). The token is checked again against the live share link. Range is supported for files.
 * @tag Media
 * @auth signed
 * @pathParams SignedMediaPathParams
 * @params SignedMediaQuery
 * @response 200:MediaBytes:The file or thumbnail or ZIP
 * @response 206:MediaBytes:One byte range
 * @response 404:ErrorBody:NOT_FOUND (bad or expired token or a dead link)
 * @response 416:NoBody:Range not satisfiable
 * @openapi
 */
export const HEAD = handler;
