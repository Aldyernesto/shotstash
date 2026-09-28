/**
 * Story 2.3: unlock a PRIVATE share link with its access code.
 * Right code: sets `shotstash_share_<slug>` (HttpOnly; Path=/s/<slug>) and
 * answers the page payload. Wrong code: 401. 5 attempts per 15 min per IP,
 * 20 per hour per link.
 */
import { NextResponse } from 'next/server';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { clientIp } from '@/lib/request';
import { limitBy, rateLimitedResponse } from '@/lib/rateLimit';
import { isHttpsRequest } from '@/lib/sessionStore';
import { findLiveShare, resolveShare } from '@/lib/shareLink';
import { mintShareAccess, shareCookieName, shareCookiePath, shareSigner, verifyAccessCode } from '@/modules/share';

export const dynamic = 'force-dynamic';

export const POST = defineRoute<{ slug: string }>({
  auth: 'public',
  handler: async ({ req, params }) => {
    const ip = clientIp(req.headers) ?? 'unknown';
    const limited = await limitBy('shareUnlock', ip);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfter);
    // A distributed guess against one link is capped too (20 per hour per slug).
    const perSlug = await limitBy('shareUnlockPerSlug', params.slug);
    if (!perSlug.ok) return rateLimitedResponse(perSlug.retryAfter);

    const link = await findLiveShare({ slug: params.slug });
    if (!link) return jsonError(404, 'NOT_FOUND', 'Link not found');

    const body = (await req.json().catch(() => null)) as { code?: unknown; section?: unknown } | null;
    const code = typeof body?.code === 'string' ? body.code : '';
    if (link.mode === 'PRIVATE' && !verifyAccessCode(code, link.accessCodeHash)) {
      return jsonError(401, 'INVALID_CODE', 'Wrong access code');
    }

    const sectionId = typeof body?.section === 'string' ? body.section : null;
    const resolution = await resolveShare(params.slug, { unlocked: true, signer: shareSigner, sectionId });
    const res = NextResponse.json(resolution);
    if (link.mode === 'PRIVATE') {
      const access = mintShareAccess(link.id);
      res.cookies.set(shareCookieName(link.slug), access.value, {
        httpOnly: true,
        sameSite: 'lax',
        path: shareCookiePath(link.slug),
        secure: isHttpsRequest(req),
        expires: access.expires,
      });
    }
    return res;
  },
});
