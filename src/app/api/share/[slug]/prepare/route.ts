/**
 * Stories 3.9 / 3.10 — pemeriksaan sebelum "Download ZIP".
 *
 * `/api/download` MENGALIRKAN arsip, jadi kegagalannya tidak pernah
 * sampai ke antarmuka: navigasi sudah lepas dari halaman. Rute ini
 * menjalankan pemeriksaan yang SAMA lebih dulu — link masih sah, target
 * masih ada, ada berkas untuk diunduh, dan berkasnya masih terbaca di
 * penyimpanan — supaya tombol bisa kembali ke keadaan semula dan
 * `error-box` menulis sebab dalam Bahasa Indonesia.
 *
 * Batasnya jujur: kegagalan yang terjadi DI TENGAH aliran arsip tetap
 * tidak terdeteksi di sini. Yang tertangkap adalah semua sebab yang bisa
 * diketahui sebelum aliran dimulai.
 */

import { NextRequest, NextResponse } from "next/server";
import { stat } from "fs/promises";
import prisma from "@/lib/prisma";
import { resolveShare } from "@/lib/shareLink";

export const dynamic = "force-dynamic";

function bearer(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const url = new URL(req.url);
  const sectionId = url.searchParams.get("section");
  const fileId = url.searchParams.get("file");
  const token = bearer(req);

  const res = await resolveShare(slug, { token, sectionId });
  if (res.state !== "ok") {
    const status = res.state === "not-found" ? 404 : res.state === "private" ? 401 : 410;
    return NextResponse.json(
      res.state === "gone" ? { state: res.state, target: res.target } : { state: res.state },
      { status },
    );
  }

  const payload = res.payload;

  // Kumpulkan id berkas yang akan masuk arsip — cukup untuk memastikan
  // ada isinya dan berkas pertamanya masih terbaca.
  let ids: string[] = [];
  if (fileId) ids = [fileId];
  else if (payload.kind === "file" && payload.single) ids = [payload.single.id];
  else ids = payload.files.map((f) => f.id);

  if (payload.fileCount === 0) {
    return NextResponse.json(
      { ok: false, cause: "Tidak ada file untuk diunduh di link ini." },
      { status: 200 },
    );
  }

  if (!ids.length) {
    // Varian Project tanpa drill-in: ambil satu berkas mana pun di
    // project itu sebagai sampel keterbacaan.
    const sample = await prisma.mediaFile.findFirst({
      where: { projectId: payload.projectId, trashedAt: null },
      select: { id: true },
    });
    ids = sample ? [sample.id] : [];
  }

  if (!ids.length) {
    return NextResponse.json(
      { ok: false, cause: "Tidak ada file untuk diunduh di link ini." },
      { status: 200 },
    );
  }

  const first = await prisma.mediaFile.findUnique({
    where: { id: ids[0] },
    select: { storagePath: true, trashedAt: true },
  });
  if (!first || first.trashedAt) {
    return NextResponse.json(
      { ok: false, cause: "Berkasnya sudah tidak ada lagi." },
      { status: 200 },
    );
  }

  try {
    await stat(first.storagePath);
  } catch {
    return NextResponse.json(
      { ok: false, cause: "Berkasnya tidak bisa dibaca di penyimpanan." },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true });
}
