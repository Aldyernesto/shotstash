// Dashboard ZIP (cookie session): `projectId` plus `folderId` or `fileIds`.
import { defineRoute } from '@/lib/defineRoute';
import { projectZipResponse } from '@/modules/media';

export const dynamic = 'force-dynamic';

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
