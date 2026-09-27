/**
 * Stories 3.9 / 3.10 / 3.11 — SATU sumber kebenaran server untuk
 * `/s/[slug]`: memutuskan keadaan link dan merakit payload klien.
 *
 * ============================================================
 * ATURAN PRIVASI (bagian dari acceptance criteria, bukan hiasan)
 * ============================================================
 *  1. Payload klien TIDAK PERNAH memuat `accessCount`, `mimeType`
 *     mentah, nama pengunggah, atau Section lain di project yang tidak
 *     ikut dibagikan. Yang dikirim adalah `kind` turunan ("video") dan
 *     kalimat manusiawi — bukan kolom database.
 *  2. Link PRIVATE tidak pernah mengirim isi sebelum penerima terbukti
 *     punya sesi valid: `resolve()` mengembalikan keadaan `private`
 *     kecuali pemanggil menyertakan token sesi yang sah.
 *  3. Klien mengunduh BERKAS ASLI — tidak ada jalur "versi aman"
 *     di sini, termasuk untuk link yang dibuat role VIEWER (OQ-X27).
 *
 * Catatan lingkungan: database dev PGlite berkolam SATU koneksi, jadi
 * modul ini sengaja TIDAK memakai `Promise.all` untuk agregat. Setiap
 * keadaan dirakit dari satu `findUnique` bersarang lalu dihitung di
 * memori.
 */

import prisma from "@/lib/prisma";
import { formatDate, formatFileSize, formatNumber } from "@/lib/format";
import { parseSectionName } from "@/lib/sectionNumber";
import {
  FILE_SORTS,
  SECTION_SORTS,
  SHARE_PAGE_SIZE,
  type ShareFile,
  type ShareFileKind,
  type SharePayload,
  type ShareResolution,
  type ShareSection,
  type ShareSort,
} from "@/lib/shareTypes";

export type { ShareFile, ShareFileKind, SharePayload, ShareResolution, ShareSection, ShareSort };
export { FILE_SORTS, SECTION_SORTS, SHARE_PAGE_SIZE, KIND_WORD } from "@/lib/shareTypes";

const REP_MAX = 3;

export function fileKindOf(mimeType?: string | null): ShareFileKind {
  const m = String(mimeType || "");
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

type RawFile = {
  id: string;
  originalName: string;
  mimeType: string;
  size: bigint | number;
  thumbnailPath: string | null;
  createdAt: Date;
};

/** Memetakan baris database ke bentuk klien — `mimeType` TIDAK ikut. */
function toShareFile(f: RawFile): ShareFile {
  const bytes = Number(f.size) || 0;
  return {
    id: f.id,
    name: f.originalName,
    kind: fileKindOf(f.mimeType),
    sizeBytes: bytes,
    sizeText: formatFileSize(bytes),
    thumbnailUrl: f.thumbnailPath ? `/api/thumbnail/${f.id}` : null,
    duration: null,
  };
}

function breakdownOf(files: { mimeType: string }[]): string | null {
  let photos = 0;
  let videos = 0;
  let docs = 0;
  for (const f of files) {
    const k = fileKindOf(f.mimeType);
    if (k === "image") photos++;
    else if (k === "video") videos++;
    else docs++;
  }
  const parts: string[] = [];
  if (photos) parts.push(`${formatNumber(photos)} foto`);
  if (videos) parts.push(`${formatNumber(videos)} video`);
  if (docs) parts.push(`${formatNumber(docs)} dokumen`);
  if (!parts.length) return null;
  if (parts.length === 1) return `Berisi ${parts[0]}.`;
  return `Berisi ${parts.slice(0, -1).join(", ")}, dan ${parts[parts.length - 1]}.`;
}

function newestDate(rows: { createdAt: Date }[], fallback: Date): string {
  let best = fallback;
  for (const r of rows) if (r.createdAt > best) best = r.createdAt;
  return formatDate(best);
}

function totalSizeText(files: { size: bigint | number }[]): string {
  let total = 0;
  for (const f of files) total += Number(f.size) || 0;
  return formatFileSize(total);
}

function repThumbsOf(files: RawFile[]): (string | null)[] {
  const withThumb = files.filter((f) => f.thumbnailPath);
  const picked = (withThumb.length ? withThumb : files).slice(0, REP_MAX);
  return picked.map((f) => (f.thumbnailPath ? `/api/thumbnail/${f.id}` : null));
}

/** Sesi valid? Dipakai HANYA untuk membuka link PRIVATE. */
async function hasValidSession(token?: string | null): Promise<boolean> {
  if (!token) return false;
  const session = await prisma.session.findUnique({ where: { token } });
  return !!session && session.expiresAt > new Date();
}

const KIND_ORDER: Record<ShareFileKind, number> = { video: 0, image: 1, audio: 2, document: 3 };

function sortFiles<T extends { originalName: string; mimeType: string; size: bigint | number; createdAt: Date }>(
  rows: T[],
  sort: ShareSort,
): T[] {
  const out = [...rows];
  if (sort === "nama") out.sort((a, b) => a.originalName.localeCompare(b.originalName, "id"));
  else if (sort === "ukuran") out.sort((a, b) => Number(b.size) - Number(a.size));
  else if (sort === "tipe")
    out.sort(
      (a, b) =>
        KIND_ORDER[fileKindOf(a.mimeType)] - KIND_ORDER[fileKindOf(b.mimeType)] ||
        a.originalName.localeCompare(b.originalName, "id"),
    );
  else out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()); // "tanggal" ▼
  return out;
}

function sortSections(rows: ShareSection[], sort: ShareSort): ShareSection[] {
  const out = [...rows];
  if (sort === "nama") out.sort((a, b) => a.title.localeCompare(b.title, "id"));
  else if (sort === "jumlah") out.sort((a, b) => b.fileCount - a.fileCount);
  else
    out.sort((a, b) => {
      // "Nomor ▲" — nama tanpa nomor selalu di belakang.
      const na = a.number === null ? Infinity : Number(a.number.split(".")[0]);
      const nb = b.number === null ? Infinity : Number(b.number.split(".")[0]);
      return na - nb || a.title.localeCompare(b.title, "id");
    });
  return out;
}

export type ResolveOptions = {
  /** Bearer token penerima — hanya relevan untuk link PRIVATE. */
  token?: string | null;
  /** Drill-in Section di dalam share Project (`?section=`). */
  sectionId?: string | null;
  /** Berapa baris pertama yang ikut dirender (grid berpaging). */
  limit?: number;
  /** Urutan `sort-pills`; bawaan "tanggal" (file) / "nomor" (Section). */
  sort?: ShareSort | null;
};

export async function resolveShare(
  slug: string,
  options: ResolveOptions = {},
): Promise<ShareResolution> {
  const limit = options.limit ?? SHARE_PAGE_SIZE;
  const fileSort: ShareSort = FILE_SORTS.includes(options.sort as ShareSort)
    ? (options.sort as ShareSort)
    : "tanggal";
  const sectionSort: ShareSort = SECTION_SORTS.includes(options.sort as ShareSort)
    ? (options.sort as ShareSort)
    : "nomor";

  const link = await prisma.shareLink.findUnique({
    where: { slug },
    include: {
      file: { include: { project: true, folder: true } },
      folder: {
        include: {
          project: true,
          files: { where: { trashedAt: null }, orderBy: { createdAt: "desc" } },
          children: {
            where: { trashedAt: null },
            include: { files: { where: { trashedAt: null }, orderBy: { createdAt: "desc" } } },
          },
        },
      },
      projectRef: {
        include: {
          folders: {
            where: { parentId: null, trashedAt: null },
            orderBy: { name: "asc" },
            include: {
              files: { where: { trashedAt: null }, orderBy: { createdAt: "desc" } },
              children: {
                where: { trashedAt: null },
                include: { files: { where: { trashedAt: null }, orderBy: { createdAt: "desc" } } },
              },
            },
          },
        },
      },
    },
  });

  if (!link) return { state: "not-found" };
  if (link.expiresAt && link.expiresAt < new Date()) return { state: "expired" };

  // Link PRIVATE: TIDAK ada isi yang dirakit sebelum sesi terbukti valid.
  if (link.mode === "PRIVATE" && !(await hasValidSession(options.token))) {
    return { state: "private" };
  }

  /* ---------------- varian Project ---------------- */
  if (link.projectId2) {
    const project = link.projectRef;
    if (!project) return { state: "gone", target: "project" };

    const folders = project.folders;
    const filesOf = (f: (typeof folders)[number]) => [
      ...f.files,
      ...f.children.flatMap((c) => c.files),
    ];

    const allFiles = folders.flatMap(filesOf);

    // Drill-in: HANYA Section yang benar-benar ikut dibagikan.
    const drill = options.sectionId
      ? folders.find((f) => f.id === options.sectionId) ?? null
      : null;
    if (options.sectionId && !drill) return { state: "gone", target: "section" };

    const drillFiles = drill ? sortFiles(filesOf(drill), fileSort) : [];
    const drillName = drill ? parseSectionName(drill.name) : null;

    const sectionRows = drill
      ? []
      : sortSections(
          folders.map((f) => {
            const parsed = parseSectionName(f.name);
            const own = filesOf(f);
            return {
              id: f.id,
              number: parsed.number,
              title: parsed.title,
              fileCount: own.length,
              repThumbs: repThumbsOf(own),
            };
          }),
          sectionSort,
        );

    return {
      state: "ok",
      payload: {
        slug,
        kind: "project",
        title: project.title,
        number: null,
        projectId: project.id,
        folderId: drill ? drill.id : null,
        zipFolderIds: folders.map((f) => f.id),
        projectName: project.title,
        sectionLabel: null,
        fileCount: drill ? drillFiles.length : allFiles.length,
        sectionCount: folders.length,
        totalSizeText: totalSizeText(drill ? drillFiles : allFiles),
        dateText: newestDate(drill ? drillFiles : allFiles, project.createdAt),
        breakdown: breakdownOf(drill ? drillFiles : allFiles),
        expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
        stageThumbs: repThumbsOf(drill ? drillFiles : allFiles),
        files: drill ? drillFiles.slice(0, limit).map(toShareFile) : [],
        sections: sectionRows.slice(0, limit),
        single: null,
        section: drill
          ? {
              id: drill.id,
              number: drillName!.number,
              title: drillName!.title,
              fileCount: drillFiles.length,
            }
          : null,
      },
    };
  }

  /* ---------------- varian Section ---------------- */
  if (link.folderId) {
    const folder = link.folder;
    if (!folder) return { state: "gone", target: "section" };

    const files = sortFiles([...folder.files, ...folder.children.flatMap((c) => c.files)], fileSort);
    const parsed = parseSectionName(folder.name);

    return {
      state: "ok",
      payload: {
        slug,
        kind: "section",
        title: parsed.title,
        number: parsed.number,
        projectId: folder.projectId,
        folderId: folder.id,
        zipFolderIds: [],
        projectName: folder.project?.title ?? null,
        sectionLabel: null,
        fileCount: files.length,
        sectionCount: null,
        totalSizeText: totalSizeText(files),
        dateText: newestDate(files, folder.createdAt),
        breakdown: breakdownOf(files),
        expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
        stageThumbs: repThumbsOf(files),
        files: files.slice(0, limit).map(toShareFile),
        sections: [],
        single: null,
        section: null,
      },
    };
  }

  /* ---------------- varian file tunggal ---------------- */
  const file = link.file;
  if (!file || file.trashedAt) return { state: "gone", target: "file" };

  const parsedSection = file.folder ? parseSectionName(file.folder.name) : null;

  return {
    state: "ok",
    payload: {
      slug,
      kind: "file",
      title: file.originalName,
      number: null,
      projectId: file.projectId,
      folderId: null,
      zipFolderIds: [],
      projectName: file.project?.title ?? null,
      sectionLabel: parsedSection
        ? [parsedSection.number ? `NO ${parsedSection.number}` : null, parsedSection.title]
            .filter(Boolean)
            .join(" ")
        : null,
      fileCount: 1,
      sectionCount: null,
      totalSizeText: formatFileSize(Number(file.size) || 0),
      dateText: formatDate(file.createdAt),
      breakdown: null,
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
      stageThumbs: repThumbsOf([file as RawFile]),
      files: [],
      sections: [],
      single: toShareFile(file as RawFile),
      section: null,
    },
  };
}

/**
 * Satu halaman berikutnya untuk tombol "Tampilkan N {file|Section} lagi".
 * Varian Project tanpa drill-in memberi halaman `section-card`; varian
 * lain memberi halaman `file-card`.
 *
 * Mengembalikan `null` bila link sudah tidak sah — pemanggil memetakannya
 * ke keadaan Story 3.11, BUKAN ke pesan "paging gagal".
 */
export async function resolveSharePage(
  slug: string,
  options: {
    token?: string | null;
    sectionId?: string | null;
    sort?: ShareSort | null;
    offset: number;
    limit: number;
  },
): Promise<{ files: ShareFile[]; sections: ShareSection[]; total: number } | null> {
  const res = await resolveShare(slug, {
    token: options.token,
    sectionId: options.sectionId,
    sort: options.sort,
    // Semua baris dirakit di server lalu dipotong di sini; yang DIKIRIM
    // tetap hanya satu halaman.
    limit: Number.MAX_SAFE_INTEGER,
  });
  if (res.state !== "ok") return null;
  const p = res.payload;
  const end = options.offset + options.limit;
  const pagesSections = p.kind === "project" && !p.section;
  return {
    files: pagesSections ? [] : p.files.slice(options.offset, end),
    sections: pagesSections ? p.sections.slice(options.offset, end) : [],
    total: pagesSections ? (p.sectionCount ?? 0) : p.fileCount,
  };
}
