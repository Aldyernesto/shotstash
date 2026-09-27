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

export const GET = handler;
export const HEAD = handler;
