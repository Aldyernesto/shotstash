/**
 * Stories 3.9 / 3.10 / 3.11 — halaman publik `/s/[slug]`.
 *
 * Komposisi berkas ini dimiliki Story 3.9 (kerangka, pengambilan data,
 * aturan privasi payload, topbar, susunan HP). Story 3.10 menambahkan
 * cabang ≥ 900 px — seluruhnya lewat CSS di `sharePage.module.css`,
 * bukan berkas kedua. Story 3.11 menyumbang keadaan gagalnya.
 *
 * Story 4.5: slug yang tidak ada (salah ketik ATAU baru dicabut — barisnya
 * memang dihapus) memanggil `notFound()` sehingga statusnya HTTP 404 dan
 * wujudnya `not-found.tsx` (tampilan "Link tidak ditemukan" Story 3.11
 * yang sama persis). Keadaan lain (kedaluwarsa, hilang, PRIVATE) tetap
 * dirender di dalam halaman seperti sebelumnya.
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
import { brand } from "@/lib/brand";
import { findLiveShare, recordShareView, resolveShare } from "@/lib/shareLink";
import { shareSigner, shareUnlocked } from "@/modules/share";
import ShareRoot from "@/components/share/ShareRoot";

export const dynamic = "force-dynamic";

// Story 1.19: og-image SATU berkas statis generik.
const OG_IMAGE = {
  ...brand.ogImage,
  alt: `${brand.productName}: ${brand.tagline}`,
};

function shareMetadata(title: string, description: string): Metadata {
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3005"),
    title,
    description,
    openGraph: { title, description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}

const GENERIC_METADATA = shareMetadata(brand.productName, `${brand.tagline}.`);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const res = await resolveShare(slug, { limit: 0 });

  // Expired, revoked, gone or PRIVATE: generic metadata. A PRIVATE link
  // never leaks names through chat previews, even for an unlocked visitor,
  // because metadata is resolved without the share cookie.
  if (res.state !== "ok") return GENERIC_METADATA;

  const p = res.payload;
  const title = `${p.title} | ${brand.productName}`;
  const description = `${p.fileCount} file footage dari ${p.projectName ?? brand.productName}.`;
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

  // PRIVATE links open only with the `shotstash_share_<slug>` cookie set by
  // `POST /s/<slug>/unlock`; media URLs in the payload are signed.
  const link = await findLiveShare({ slug });
  const unlocked = link ? shareUnlocked(await cookies(), link) : false;

  let resolution = await resolveShare(slug, { sectionId, unlocked, signer: shareSigner });
  // A stale or trashed `?section=` inside a live share: ignore it and show
  // the share itself instead of answering 404 for the whole link.
  if (sectionId && resolution.state === "gone") {
    const whole = await resolveShare(slug, { unlocked, signer: shareSigner });
    if (whole.state !== "gone") {
      resolution = whole;
      sectionId = null;
    }
  }

  // Story 4.5: `prisma.shareLink.findUnique({ where: { slug } })` null →
  // 404 lewat `not-found.tsx`, bukan 200 dengan tampilan yang sama.
  // Story 2.8: a trashed or deleted target answers 404 like a revoked link;
  // the page never says whether the item still exists.
  if (resolution.state === "not-found" || resolution.state === "gone") notFound();
  // One view per successful page render (media requests are not counted).
  if (resolution.state === "ok") await recordShareView(slug);

  return <ShareRoot resolution={resolution} slug={slug} sectionId={sectionId} />;
}
