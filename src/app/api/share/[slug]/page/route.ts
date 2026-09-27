/**
 * Story 3.10 — halaman berikutnya grid share ("Tampilkan N file lagi").
 *
 * Paging adalah permintaan SUNGGUHAN ke server, bukan potongan array yang
 * sudah ada di klien: itulah yang membuat kegagalan paging (AC 3.10) dan
 * link yang mati di tengah kunjungan bisa dibedakan. Aturan privasi ikut
 * dari `resolveSharePage` — tidak ada `accessCount`, mime, pengunggah,
 * atau Section di luar share yang pernah ikut terkirim.
 *
 * Jawaban:
 *   200 { files, sections, total }
 *   410 { state: "expired" | "gone" }   → klien pindah ke keadaan 3.11
 *   404 { state: "not-found" }          → klien pindah ke keadaan 3.11
 *   401 { state: "private" }            → klien pindah ke keadaan 3.11
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveShare, resolveSharePage, SHARE_PAGE_SIZE, type ShareSort } from "@/lib/shareLink";

export const dynamic = "force-dynamic";

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get("limit") ?? SHARE_PAGE_SIZE) || SHARE_PAGE_SIZE));
  const sectionId = url.searchParams.get("section");
  const sort = url.searchParams.get("sort") as ShareSort | null;
  const token = bearer(req);

  const page = await resolveSharePage(slug, { token, sectionId, sort, offset, limit });
  if (page) return NextResponse.json(page);

  // Link tidak lagi sah — kirim SEBABNYA supaya klien bisa pindah ke
  // keadaan Story 3.11 alih-alih menampilkan "gagal memuat".
  const res = await resolveShare(slug, { token });
  const status =
    res.state === "not-found" ? 404 : res.state === "private" ? 401 : 410;
  return NextResponse.json(
    res.state === "gone" ? { state: res.state, target: res.target } : { state: res.state },
    { status },
  );
}
