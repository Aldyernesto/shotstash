/**
 * Stories 3.9 / 3.10 / 3.11 — halaman publik `/s/[slug]`.
 *
 * Komposisi berkas ini dimiliki Story 3.9 (kerangka, pengambilan data,
 * aturan privasi payload, topbar, susunan HP). Story 3.10 menambahkan
 * cabang ≥ 900 px — seluruhnya lewat CSS di `sharePage.module.css`,
 * bukan berkas kedua. Story 3.11 menyumbang keadaan gagalnya.
 *
 * Story 4.6: every inactive link (unknown, revoked, expired, target gone)
 * answers HTTP 404 through `notFound()`; `not-found.tsx` shows the matching
 * message (it resolves the link again from the request path). A
 * PRIVATE link without its code stays 200 with the unlock form.
 *
 * ATURAN PRATINJAU LINK (Epic 1, tetap berlaku apa adanya):
 * `og:image` SELALU satu template generik untuk SEMUA link — tidak
 * pernah thumbnail isi, nama berkas, atau wajah ahwat — termasuk link
 * PRIVATE dan link kedaluwarsa. Halaman ini tidak menambah satu pun
 * varian gambar pratinjau.
 */

import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { brand } from "@/lib/brand";
import { config } from "@/lib/config";
import { findLiveShare, recordShareView, resolveShare } from "@/lib/shareLink";
import { shareSigner, shareUnlocked } from "@/modules/share";
import ShareRoot from "@/components/share/ShareRoot";
import { inactiveKindOf } from "./inactive";

export const dynamic = "force-dynamic";

// Story 1.19: og-image SATU berkas statis generik.
const OG_IMAGE = {
  ...brand.ogImage,
  alt: `${brand.productName}: ${brand.tagline}`,
};

function shareMetadata(title: string, description: string): Metadata {
  return {
    metadataBase: new URL(config().appUrl),
    title,
    description,
    openGraph: { title, description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}

const genericMetadata = () => shareMetadata(brand.productName, `${brand.tagline}.`);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Locale: the `shotstash_locale` cookie, then SHOTSTASH_DEFAULT_LOCALE, then English (src/i18n/request.ts).
  const locale = await getLocale();
  const res = await resolveShare(slug, { limit: 0, locale });

  // Expired, revoked, gone or PRIVATE: generic metadata. A PRIVATE link
  // never leaks names through chat previews, even for an unlocked visitor,
  // because metadata is resolved without the share cookie.
  if (res.state !== "ok") return genericMetadata();

  const p = res.payload;
  const title = `${p.title} | ${brand.productName}`;
  const t = await getTranslations("share");
  const description = t("metaDescription", {
    count: p.fileCount,
    source: p.projectName ?? brand.productName,
  });
  return shareMetadata(title, description);
}

export default async function SharePageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { slug } = await params;
  const { section } = await searchParams;
  let sectionId = section ?? null;
  const locale = await getLocale();

  // PRIVATE links open only with the `shotstash_share_<slug>` cookie set by
  // `POST /s/<slug>/unlock`; media URLs in the payload are signed.
  const link = await findLiveShare({ slug });
  const unlocked = link ? shareUnlocked(await cookies(), link) : false;

  let resolution = await resolveShare(slug, { sectionId, unlocked, signer: shareSigner, locale });
  // A stale or trashed `?section=` inside a live share: ignore it and show
  // the share itself instead of answering 404 for the whole link.
  if (sectionId && resolution.state === "gone") {
    const whole = await resolveShare(slug, { unlocked, signer: shareSigner, locale });
    if (whole.state !== "gone") {
      resolution = whole;
      sectionId = null;
    }
  }

  // Story 4.6: unknown, revoked, expired and gone links answer 404 with
  // their own message (never a name, count or thumbnail).
  if (inactiveKindOf(resolution)) notFound();
  // One view per successful page render (media requests are not counted).
  if (resolution.state === "ok") await recordShareView(slug);

  return <ShareRoot resolution={resolution} slug={slug} sectionId={sectionId} />;
}
