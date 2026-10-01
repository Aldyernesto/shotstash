// Project cover or user avatar (cookie session), looked up by exact file name.
import { defineRoute } from '@/lib/defineRoute';
import { coverResponse } from '@/modules/media';

export const dynamic = 'force-dynamic';

/**
 * Cover or avatar image
 * @description A project cover or user avatar as JPEG; for any signed-in account that may view projects.
 * @tag Media
 * @auth cookie
 * @pathParams CoverPathParams
 * @params CoverQuery
 * @response 200:JpegImage:The image
 * @response 401:ErrorBody:No valid session
 * @response 403:ErrorBody:FORBIDDEN
 * @response 404:ErrorBody:NOT_FOUND
 * @openapi
 */
export const GET = defineRoute<{ kind: string; id: string }>({
  auth: 'cookie',
  action: 'project.view',
  handler: ({ req, actor, params }) => coverResponse(req, actor, params.kind, params.id),
});
