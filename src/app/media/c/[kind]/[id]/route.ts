// Project cover or user avatar (cookie session), looked up by exact file name.
import { defineRoute } from '@/lib/defineRoute';
import { coverResponse } from '@/modules/media';

export const dynamic = 'force-dynamic';

export const GET = defineRoute<{ kind: string; id: string }>({
  auth: 'cookie',
  action: 'project.view',
  handler: ({ req, actor, params }) => coverResponse(req, actor, params.kind, params.id),
});
