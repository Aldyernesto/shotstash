/**
 * Next page of a share grid ("Tampilkan N file lagi"), with signed media URLs.
 *   200 { files, sections, total }
 *   410 { state: "expired" | "gone" }, 404 { state: "not-found" }, 401 { state: "private" }
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { SHARE_PAGE_SIZE, findLiveShare, resolveShare, resolveSharePage, shareLocale } from '@/lib/shareLink';
import { LOCALE_COOKIE } from '@/modules/i18n';
import { shareSigner, shareUnlocked } from '@/modules/share';

export const dynamic = 'force-dynamic';

export const GET = defineRoute<{ slug: string }>({
  auth: 'share',
  handler: async ({ req, params }) => {
    const url = req.nextUrl;
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
    const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit') ?? SHARE_PAGE_SIZE) || SHARE_PAGE_SIZE));
    const sectionId = url.searchParams.get('section');
    const sort = url.searchParams.get('sort');
    // Anonymous visitor: cookie, then DEFAULT_LOCALE, then English (names sort in it).
    const locale = shareLocale(req.cookies.get(LOCALE_COOKIE)?.value);

    const link = await findLiveShare({ slug: params.slug });
    const unlocked = link ? shareUnlocked(req.cookies, link) : false;
    const page = link
      ? await resolveSharePage(params.slug, { unlocked, signer: shareSigner, sectionId, sort, locale, offset, limit })
      : null;
    if (page) return NextResponse.json(page);

    const res = await resolveShare(params.slug, { unlocked, limit: 0 });
    const status = res.state === 'not-found' ? 404 : res.state === 'private' ? 401 : 410;
    const code = status === 401 ? 'UNAUTHENTICATED' : status === 404 ? 'NOT_FOUND' : 'GONE';
    return NextResponse.json(
      res.state === 'gone' ? { code, state: res.state, target: res.target } : { code, state: res.state },
      { status },
    );
  },
});
