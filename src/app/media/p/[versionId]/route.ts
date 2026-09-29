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

export const GET = handler;
export const HEAD = handler;
