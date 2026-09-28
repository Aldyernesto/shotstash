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
 *  2. A PRIVATE link never sends content before the visitor proved the
 *     access code: `resolveShare()` answers `private` unless the caller
 *     verified the `shotstash_share_<slug>` cookie (`unlocked: true`).
 *  4. Media URLs are signed `/media/s/<token>` URLs minted by the caller's
 *     `signer` (the media module); this file never imports modules.
 *  5. Revoked links answer `not-found`; a trashed target (or a trashed
 *     ancestor Section) answers `gone`.
 *  3. Klien mengunduh BERKAS ASLI — tidak ada jalur "versi aman"
 *     di sini, termasuk untuk link yang dibuat role VIEWER (OQ-X27).
 *
 * Catatan lingkungan: database dev PGlite berkolam SATU koneksi, jadi
 * modul ini sengaja TIDAK memakai `Promise.all` untuk agregat. Setiap
 * keadaan dirakit dari satu `findUnique` bersarang lalu dihitung di
 * memori.
 */

import prisma from "@/lib/prisma";
import { formatFileSize, formatNumber, formatServerDate } from "@/lib/format";
import { parseSectionName } from "@/lib/sectionNumber";
import { liveSubtree, zipFileName, zipPlanForFolders, type ZipPlan } from "@/lib/mediaTree";
import { linkInactiveReason } from "@/lib/shareState";

export { linkInactiveReason };
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

/** Mints a signed media URL for `target` of share `shareId` (see `@/modules/media`). */
export type ShareSigner = (shareId: string, target: string) => string;

/** Signs URLs of one share; without a signer every URL is null (metadata, tests). */
type BoundSigner = (target: string) => string | null;

function bindSigner(shareId: string, signer?: ShareSigner | null): BoundSigner {
  return (target) => (signer ? signer(shareId, target) : null);
}

/** Memetakan baris database ke bentuk klien — `mimeType` TIDAK ikut. */
function toShareFile(f: RawFile, sign: BoundSigner): ShareFile {
  const bytes = Number(f.size) || 0;
  const original = sign(f.id);
  return {
    id: f.id,
    name: f.originalName,
    kind: fileKindOf(f.mimeType),
    sizeBytes: bytes,
    sizeText: formatFileSize(bytes),
    thumbnailUrl: f.thumbnailPath ? sign(`t:${f.id}`) : null,
    inlineUrl: original,
    downloadUrl: original ? `${original}?dl=1` : null,
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
  return formatServerDate(best);
}

function totalSizeText(files: { size: bigint | number }[]): string {
  let total = 0;
  for (const f of files) total += Number(f.size) || 0;
  return formatFileSize(total);
}

function repThumbsOf(files: RawFile[], sign: BoundSigner): (string | null)[] {
  const withThumb = files.filter((f) => f.thumbnailPath);
  const picked = (withThumb.length ? withThumb : files).slice(0, REP_MAX);
  return picked.map((f) => (f.thumbnailPath ? sign(`t:${f.id}`) : null));
}

/** True when the folder or any ancestor Section is in the Trash (or the folder is gone). */
export async function folderChainTrashed(folderId: string | null | undefined): Promise<boolean> {
  let cursor = folderId ?? null;
  let guard = 0;
  while (cursor && guard++ < 64) {
    const f = await prisma.folder.findUnique({
      where: { id: cursor },
      select: { parentId: true, trashedAt: true },
    });
    if (!f) return true;
    if (f.trashedAt) return true;
    cursor = f.parentId;
  }
  // Too deep (or a parent cycle): fail closed and treat it as inactive.
  return cursor !== null;
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
  /** PRIVATE links only: the caller verified the share access cookie. */
  unlocked?: boolean;
  /** Mints signed media URLs; omitted for metadata (no URLs needed). */
  signer?: ShareSigner | null;
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
  const inactive = linkInactiveReason(link);
  // A revoked link looks exactly like one that never existed.
  if (inactive === "revoked") return { state: "not-found" };
  if (inactive === "expired") return { state: "expired" };

  // PRIVATE: nothing is assembled before the access code was proven.
  if (link.mode === "PRIVATE" && !options.unlocked) {
    return { state: "private" };
  }

  const sign = bindSigner(link.id, options.signer);

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
              repThumbs: repThumbsOf(own, sign),
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
        zipUrl: sign(drill ? `zip:${drill.id}` : "zip"),
        projectName: project.title,
        sectionLabel: null,
        fileCount: drill ? drillFiles.length : allFiles.length,
        sectionCount: folders.length,
        totalSizeText: totalSizeText(drill ? drillFiles : allFiles),
        dateText: newestDate(drill ? drillFiles : allFiles, project.createdAt),
        breakdown: breakdownOf(drill ? drillFiles : allFiles),
        expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
        stageThumbs: repThumbsOf(drill ? drillFiles : allFiles, sign),
        files: drill ? drillFiles.slice(0, limit).map((f) => toShareFile(f, sign)) : [],
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
    if (!folder || (await folderChainTrashed(folder.id))) return { state: "gone", target: "section" };

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
        zipUrl: sign("zip"),
        projectName: folder.project?.title ?? null,
        sectionLabel: null,
        fileCount: files.length,
        sectionCount: null,
        totalSizeText: totalSizeText(files),
        dateText: newestDate(files, folder.createdAt),
        breakdown: breakdownOf(files),
        expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
        stageThumbs: repThumbsOf(files, sign),
        files: files.slice(0, limit).map((f) => toShareFile(f, sign)),
        sections: [],
        single: null,
        section: null,
      },
    };
  }

  /* ---------------- varian file tunggal ---------------- */
  const file = link.file;
  if (!file || file.trashedAt || (await folderChainTrashed(file.folderId))) {
    return { state: "gone", target: "file" };
  }
  const singleUrl = sign(file.id);

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
      zipUrl: singleUrl ? `${singleUrl}?dl=1` : null,
      projectName: file.project?.title ?? null,
      sectionLabel: parsedSection
        ? [parsedSection.number ? `NO ${parsedSection.number}` : null, parsedSection.title]
            .filter(Boolean)
            .join(" ")
        : null,
      fileCount: 1,
      sectionCount: null,
      totalSizeText: formatFileSize(Number(file.size) || 0),
      dateText: formatServerDate(file.createdAt),
      breakdown: null,
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
      stageThumbs: repThumbsOf([file as RawFile], sign),
      files: [],
      sections: [],
      single: toShareFile(file as RawFile, sign),
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
    unlocked?: boolean;
    signer?: ShareSigner | null;
    sectionId?: string | null;
    sort?: ShareSort | null;
    offset: number;
    limit: number;
  },
): Promise<{ files: ShareFile[]; sections: ShareSection[]; total: number } | null> {
  const res = await resolveShare(slug, {
    unlocked: options.unlocked,
    signer: options.signer,
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

/* ------------------------------------------------------------------ */
/* Scope checks for signed media (Story 2.3)                           */
/* ------------------------------------------------------------------ */

export type LiveShare = {
  id: string;
  slug: string;
  mode: "PUBLIC" | "PRIVATE";
  fileId: string | null;
  folderId: string | null;
  projectId2: string | null;
  accessCodeHash: string | null;
  createdById: string;
};

const LIVE_SHARE_SELECT = {
  id: true,
  slug: true,
  mode: true,
  fileId: true,
  folderId: true,
  projectId2: true,
  accessCodeHash: true,
  createdById: true,
  revokedAt: true,
  expiresAt: true,
} as const;

/** The link row when it exists, is not revoked and not expired; otherwise null. */
export async function findLiveShare(where: { id: string } | { slug: string }): Promise<LiveShare | null> {
  const link = await prisma.shareLink.findUnique({ where, select: LIVE_SHARE_SELECT });
  if (!link || linkInactiveReason(link)) return null;
  const { revokedAt: _r, expiresAt: _e, ...rest } = link;
  void _r;
  void _e;
  return rest;
}

/**
 * Folder roots of a live share, or null when the target is gone or trashed.
 * File links answer `{ fileId }`.
 */
export async function shareRoots(
  link: LiveShare,
): Promise<{ kind: "file"; fileId: string } | { kind: "folders"; rootIds: string[]; name: string } | null> {
  if (link.fileId) {
    const f = await prisma.mediaFile.findUnique({
      where: { id: link.fileId },
      select: { trashedAt: true, folderId: true },
    });
    if (!f || f.trashedAt || (await folderChainTrashed(f.folderId))) return null;
    return { kind: "file", fileId: link.fileId };
  }
  if (link.folderId) {
    const folder = await prisma.folder.findUnique({ where: { id: link.folderId }, select: { name: true } });
    if (!folder || (await folderChainTrashed(link.folderId))) return null;
    return { kind: "folders", rootIds: [link.folderId], name: folder.name };
  }
  if (link.projectId2) {
    const project = await prisma.project.findUnique({ where: { id: link.projectId2 }, select: { title: true } });
    if (!project) return null;
    const roots = await prisma.folder.findMany({
      where: { projectId: link.projectId2, parentId: null, trashedAt: null },
      select: { id: true },
    });
    return { kind: "folders", rootIds: roots.map((r) => r.id), name: project.title };
  }
  return null;
}

export type ShareMediaFile = {
  id: string;
  originalName: string;
  mimeType: string;
  storagePath: string;
  thumbnailPath: string | null;
};

/** The file when it is live and inside the share; otherwise null. */
export async function shareFileInScope(link: LiveShare, fileId: string): Promise<ShareMediaFile | null> {
  const roots = await shareRoots(link);
  if (!roots) return null;
  const file = await prisma.mediaFile.findUnique({
    where: { id: fileId },
    select: { id: true, originalName: true, mimeType: true, storagePath: true, thumbnailPath: true, trashedAt: true, folderId: true },
  });
  if (!file || file.trashedAt) return null;
  if (roots.kind === "file") return roots.fileId === file.id ? file : null;
  const scope = await liveSubtree(roots.rootIds);
  if (!scope.some((f) => f.id === file.folderId)) return null;
  const { trashedAt: _t, folderId: _f, ...rest } = file;
  void _t;
  void _f;
  return rest;
}

/** ZIP plan for the whole share, or for one Section inside it. Null when out of scope or gone. */
export async function shareZipPlan(
  link: LiveShare,
  sectionId: string | null,
): Promise<(ZipPlan & { zipName: string }) | null> {
  const roots = await shareRoots(link);
  if (!roots || roots.kind === "file") return null;
  if (sectionId) {
    const scope = await liveSubtree(roots.rootIds);
    const section = scope.find((f) => f.id === sectionId);
    if (!section) return null;
    const plan = await zipPlanForFolders([section.id]);
    return { ...plan, zipName: zipFileName(section.name) };
  }
  const plan = await zipPlanForFolders(roots.rootIds);
  return { ...plan, zipName: zipFileName(roots.name) };
}

/** Batch form of `shareFileInScope` (one scope walk for many ids). */
export async function shareFilesInScope(link: LiveShare, fileIds: string[]): Promise<ShareMediaFile[]> {
  if (!fileIds.length) return [];
  const roots = await shareRoots(link);
  if (!roots) return [];
  const files = await prisma.mediaFile.findMany({
    where: { id: { in: fileIds }, trashedAt: null },
    select: { id: true, originalName: true, mimeType: true, storagePath: true, thumbnailPath: true, folderId: true },
  });
  let allowed: (f: { id: string; folderId: string }) => boolean;
  if (roots.kind === "file") {
    allowed = (f) => f.id === roots.fileId;
  } else {
    const scope = new Set((await liveSubtree(roots.rootIds)).map((f) => f.id));
    allowed = (f) => scope.has(f.folderId);
  }
  return files.filter(allowed).map(({ folderId: _f, ...rest }) => {
    void _f;
    return rest;
  });
}

/** Story 2.3: one page view of a live link (not counted per media request). */
export async function recordShareView(slug: string): Promise<void> {
  await prisma.shareLink
    .update({ where: { slug }, data: { accessCount: { increment: 1 } } })
    .catch(() => undefined);
}
