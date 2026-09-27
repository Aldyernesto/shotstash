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

import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import { resolveShare } from "@/lib/shareLink";
import ShareRoot from "@/components/share/ShareRoot";

export const dynamic = "force-dynamic";

// Story 1.19: og-image SATU berkas statis generik.
const OG_IMAGE = {
  url: "/brand/og.png",
  width: 1200,
  height: 630,
  alt: "Shotstash: self-hosted media cloud for creators",
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

const GENERIC_METADATA = shareMetadata("Shotstash", "Self-hosted media cloud for creators.");

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const res = await resolveShare(slug, { limit: 0 });

  // Kedaluwarsa, dicabut, hilang, ATAU PRIVATE → metadata generik.
  // Link PRIVATE tidak pernah membocorkan nama atau jumlah file lewat
  // pratinjau pesan (AC 3.11).
  if (res.state !== "ok") return GENERIC_METADATA;

  const p = res.payload;
  const title = `${p.title} — Shotstash`;
  const description = `${p.fileCount} file footage dari ${p.projectName ?? "Shotstash"}.`;
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
  const sectionId = section ?? null;

  // Kartu chat lama memakai /s/<slug> langsung sebagai <video src>:
  // permintaan media dialihkan ke aliran MP4, navigasi browser tidak.
  const h = await headers();
  const fetchDest = h.get("sec-fetch-dest") || "";
  const rangeHeader = h.get("range") || "";
  const accept = h.get("accept") || "";
  const requestedAsMedia =
    fetchDest === "video" || !!rangeHeader || (!accept.includes("text/html") && accept.includes("video"));
  if (requestedAsMedia) {
    const link = await prisma.shareLink.findUnique({
      where: { slug },
      select: { fileId: true, file: { select: { id: true, projectId: true, mimeType: true } } },
    });
    if (link?.file?.mimeType.startsWith("video/")) {
      redirect(
        `/api/download?projectId=${link.file.projectId}&fileIds=${link.file.id}&inline=1&shareSlug=${slug}`,
      );
    }
  }

  const resolution = await resolveShare(slug, { sectionId });

  // Story 4.5: `prisma.shareLink.findUnique({ where: { slug } })` null →
  // 404 lewat `not-found.tsx`, bukan 200 dengan tampilan yang sama.
  if (resolution.state === "not-found") notFound();

  return <ShareRoot resolution={resolution} slug={slug} sectionId={sectionId} />;
}
