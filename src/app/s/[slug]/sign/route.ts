/**
 * Story 2.3: re-mint signed media URLs for a share page.
 * Body: `{ fileIds?: string[], zip?: boolean, section?: string, thumbs?: boolean }`.
 * `thumbs: true` also re-mints the stage thumbnails and every Section card's
 * representative thumbnails (they expire like any signed URL).
 * PRIVATE links need the `shotstash_share_<slug>` cookie (401 otherwise).
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { findLiveShare, resolveShare, shareFilesInScope, shareRoots, shareZipPlan } from '@/lib/shareLink';
import { shareSigner, shareUnlocked } from '@/modules/share';
import { storage } from '@/modules/storage';

export const dynamic = 'force-dynamic';

async function deadResponse(slug: string) {
  const res = await resolveShare(slug, { limit: 0 });
  if (res.state === 'gone') {
    return NextResponse.json({ code: 'GONE', state: res.state, target: res.target }, { status: 410 });
  }
  if (res.state === 'expired' || res.state === 'revoked') return NextResponse.json({ code: 'GONE', state: res.state }, { status: 410 });
  return NextResponse.json({ code: 'NOT_FOUND', state: 'not-found' }, { status: 404 });
}

/** The object can be read from storage (a missing object or an unreachable backend answers false). */
async function readable(key: string): Promise<boolean> {
  return storage().exists(key).catch(() => false);
}

type SignBody = { fileIds?: unknown; zip?: unknown; section?: unknown; thumbs?: unknown } | null;

export const POST = defineRoute<{ slug: string }>({
  auth: 'share',
  handler: async ({ req, params }) => {
    const link = await findLiveShare({ slug: params.slug });
    if (!link) return deadResponse(params.slug);
    if (!shareUnlocked(req.cookies, link)) {
      return NextResponse.json({ code: 'UNAUTHENTICATED', state: 'private' }, { status: 401 });
    }
    const roots = await shareRoots(link);
    if (!roots) return deadResponse(params.slug);

    const body = (await req.json().catch(() => null)) as SignBody;
    const rawIds: unknown[] = Array.isArray(body?.fileIds) ? (body?.fileIds as unknown[]) : [];
    const ids = rawIds.filter((x) => typeof x === 'string').slice(0, 200) as string[];

    const files: Record<string, { thumbnailUrl: string | null; inlineUrl: string; downloadUrl: string }> = {};
    for (const f of await shareFilesInScope(link, ids)) {
      const url = shareSigner(link.id, f.id);
      files[f.id] = {
        thumbnailUrl: f.thumbVersion ? shareSigner(link.id, `t:${f.id}`) : null,
        inlineUrl: url,
        downloadUrl: `${url}?dl=1`,
      };
    }

    let zipUrl: string | null = null;
    let cause: 'EMPTY' | 'UNREADABLE' | 'NOT_FOUND' | null = null;
    if (body?.zip === true) {
      if (roots.kind === 'file') {
        const [file] = await shareFilesInScope(link, [roots.fileId]);
        if (!file) cause = 'NOT_FOUND';
        else if (!(await readable(file.storageKey))) cause = 'UNREADABLE';
        else zipUrl = `${shareSigner(link.id, file.id)}?dl=1`;
      } else {
        const section = typeof body.section === 'string' && body.section ? body.section : null;
        const plan = await shareZipPlan(link, section);
        if (!plan) cause = 'NOT_FOUND';
        else if (!plan.entries.length) cause = 'EMPTY';
        else if (!(await readable(plan.entries[0].key))) cause = 'UNREADABLE';
        else zipUrl = shareSigner(link.id, section ? `zip:${section}` : 'zip');
      }
    }

    let stageThumbs: (string | null)[] | null = null;
    let sectionThumbs: Record<string, (string | null)[]> | null = null;
    if (body?.thumbs === true) {
      const section = typeof body.section === 'string' && body.section ? body.section : null;
      const res = await resolveShare(params.slug, {
        unlocked: true,
        signer: shareSigner,
        sectionId: section,
        limit: Number.MAX_SAFE_INTEGER,
      });
      if (res.state === 'ok') {
        stageThumbs = res.payload.stageThumbs;
        sectionThumbs = Object.fromEntries(res.payload.sections.map((s) => [s.id, s.repThumbs]));
      }
    }

    return NextResponse.json({ files, zipUrl, cause, stageThumbs, sectionThumbs });
  },
});
