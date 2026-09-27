// Signed share media (file, thumbnail or ZIP). The token is re-checked against the ShareLink row.
import { defineRoute } from '@/lib/defineRoute';
import { signedMediaResponse } from '@/modules/media';

export const dynamic = 'force-dynamic';

const handler = defineRoute<{ token: string }>({
  auth: 'signed',
  handler: ({ req, params }) => signedMediaResponse(req, params.token),
});

export const GET = handler;
export const HEAD = handler;
