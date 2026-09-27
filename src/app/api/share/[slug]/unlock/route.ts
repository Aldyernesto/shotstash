/**
 * Story 3.11 — membuka link PRIVATE untuk penerima yang SUDAH login.
 *
 * Halaman server tidak pernah melihat token sesi (sesi Shotstash disimpan di
 * `localStorage`, bukan cookie), jadi `/s/[slug]` selalu merender keadaan
 * "Link privat" untuk link PRIVATE. Komponen klien memanggil rute ini
 * dengan `Authorization: Bearer` bila ada token tersimpan — baru di sini
 * isinya dirakit dan dikirim. Tidak ada satu pun nama file, jumlah file,
 * thumbnail, atau nama Section yang meninggalkan server sebelum itu.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveShare } from "@/lib/shareLink";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section");
  const h = req.headers.get("authorization");
  const token = h?.startsWith("Bearer ") ? h.slice(7) : null;

  if (!token) return NextResponse.json({ state: "private" }, { status: 401 });

  const res = await resolveShare(slug, { token, sectionId });
  if (res.state === "ok") return NextResponse.json(res);

  const status = res.state === "not-found" ? 404 : res.state === "private" ? 401 : 410;
  return NextResponse.json(
    res.state === "gone" ? { state: res.state, target: res.target } : { state: res.state },
    { status },
  );
}
