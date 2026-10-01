// Dashboard ZIP (cookie session): `projectId` plus `folderId` or `fileIds`.
import { defineRoute } from '@/lib/defineRoute';
import { projectZipResponse } from '@/modules/media';

export const dynamic = 'force-dynamic';

/**
 * Download a ZIP
 * @description A ZIP of a whole folder (folderId) or of chosen files (fileIds) of one project; streamed without compression.
 * @tag Media
 * @auth cookie
 * @params ZipQuery
 * @response 200:ZipArchive:The archive
 * @response 400:ErrorBody:BAD_REQUEST (projectId and folderId or fileIds are required)
 * @response 401:ErrorBody:No valid session
 * @response 403:ErrorBody:FORBIDDEN
 * @response 404:ErrorBody:NOT_FOUND
 * @openapi
 */
export const GET = defineRoute({
  auth: 'cookie',
  action: 'media.download',
  handler: ({ req, actor }) => {
    const q = req.nextUrl.searchParams;
    return projectZipResponse(actor, {
      projectId: q.get('projectId'),
      folderId: q.get('folderId'),
      fileIds: (q.get('fileIds') ?? '').split(',').filter(Boolean),
    });
  },
});
