// Thumbnail of a library file (cookie session). `?v=` is a cache buster only.
import { defineRoute } from '@/lib/defineRoute';
import { mediaGuard, serveFile } from '@/modules/media';

export const dynamic = 'force-dynamic';

export const GET = defineRoute<{ fileId: string }>({
  auth: 'cookie',
  action: 'media.download',
  handler: async ({ req, actor, params }) => {
    const g = await mediaGuard(actor, params.fileId);
    if (!g.ok) return g.response;
    return serveFile(req, g.file, 'thumbnail', 'cookie');
  },
});
