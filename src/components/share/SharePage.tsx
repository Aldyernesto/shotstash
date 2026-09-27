"use client";

/**
 * Stories 3.9 / 3.10 — halaman publik `/s/[slug]`.
 *
 * SATU komponen untuk kedua lebar. Story 3.9 memiliki komposisinya
 * (kerangka, topbar, susunan HP); Story 3.10 hanya MENAMBAHKAN cabang
 * ≥ 900 px lewat CSS (kolom, ukuran, baris paging). Tidak ada breakpoint
 * di JavaScript, jadi tidak ada ketidakcocokan hidrasi dan tidak ada
 * berkas kedua yang bisa berbeda diam-diam.
 *
 * Yang TIDAK ada di halaman ini, dan tidak boleh muncul:
 *   - `select-check`, tombol "⋯", tombol Share;
 *   - label blur / "Versi aman" apa pun — klien mengunduh BERKAS ASLI,
 *     termasuk untuk link buatan role VIEWER (OQ-X27);
 *   - "Access count", mime "Type", nama pengunggah, dan Section lain di
 *     project — ketiganya tidak pernah ikut di payload (lihat
 *     `src/lib/shareLink.ts`).
 *
 * Story 2.3: every media URL is a signed `/media/s/<token>` URL valid for
 * 5 minutes. The page re-mints them through `POST /s/<slug>/sign` every
 * 4 minutes; the inline video keeps its source and is re-signed only when
 * it fails, resuming at the same position.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import Logo from "@/components/Logo";
import { brand } from "@/lib/brand";
import ThemeToggle from "@/components/ThemeToggle";
import TagPill from "@/components/tag-pill/TagPill";
import { ButtonPrimary, PillButton } from "@/components/form/buttons";
import { ErrorBox } from "@/components/dashboard/states";
import VideoPlayer, { type VideoPlayerHandle } from "@/components/media/VideoPlayer";
import { KIND_WORD, SHARE_PAGE_SIZE, type ShareFile, type ShareSection, type SharePayload } from "@/lib/shareTypes";
import { formatDate, formatNumber, formatTimeWIB } from "@/lib/format";
import ShareInvalid, { type ShareInvalidKind } from "./ShareInvalid";
import styles from "./sharePage.module.css";

/* ------------------------------------------------------------------ */
/* ikon                                                                */
/* ------------------------------------------------------------------ */

const ICON_FILES = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3l2 2.5h6A2.5 2.5 0 0 1 20 10v6.5A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
  </svg>
);

const ICON_CLOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const ICON_INFINITY = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M7 8C4.5 8 3 9.8 3 12s1.5 4 4 4c3.5 0 6.5-8 10-8 2.5 0 4 1.8 4 4s-1.5 4-4 4c-3.5 0-6.5-8-10-8z" />
  </svg>
);

const ICON_DOWNLOAD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const ICON_PLAY = (
  <svg viewBox="0 0 9 10" aria-hidden="true">
    <path d="M0 0l9 5-9 5z" />
  </svg>
);

/* ------------------------------------------------------------------ */
/* number-sticker                                                      */
/* ------------------------------------------------------------------ */

function NumberSticker({ value, className }: { value: string; className?: string }) {
  return (
    <span className={`spine-display-label ${styles.sticker} ${className ?? ""}`}>
      <small className="spine-sticker-unit" aria-hidden="true">
        NO
      </small>
      <span className="spine-visually-hidden">Nomor </span>
      {value}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* kartu file publik                                                   */
/* ------------------------------------------------------------------ */

function PublicFileCard({
  file,
  onOpen,
}: {
  file: ShareFile;
  onOpen?: (file: ShareFile) => void;
}) {
  const href = file.downloadUrl ?? undefined;
  const inline = file.inlineUrl ?? undefined;
  const label = [file.name, KIND_WORD[file.kind].toLowerCase(), file.sizeText].join(", ");
  return (
    <article className={styles.fileCell}>
      <div className={styles.photo}>
        {file.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={file.thumbnailUrl} alt="" loading="lazy" decoding="async" draggable={false} />
        ) : null}
        {file.kind === "video" ? (
          <span className={`spine-tag-mobile ${styles.videoMarker}`}>
            {ICON_PLAY}
            {file.duration ?? "Video"}
          </span>
        ) : null}
      </div>
      <div className={styles.caption}>
        <span className={styles.captionText}>
          {/* Kartu = TAUTAN dengan area ::after seluas sel. */}
          <a
            className={`spine-focus-ring ${styles.openLink}`}
            href={inline}
            target="_blank"
            rel="noreferrer"
            title={file.name}
            aria-label={label}
            onClick={(e) => {
              if (onOpen) {
                e.preventDefault();
                onOpen(file);
              }
            }}
          >
            <span className={`spine-chip ${styles.fileName}`} aria-hidden="true">
              {file.name}
            </span>
          </a>
          <span className={`spine-chip ${styles.fileSize}`} aria-hidden="true">
            {file.sizeText}
          </span>
        </span>
        {/* Tombol unduh = kontrol SIBLING di atas tautan kartu. */}
        <a
          className={`spine-focus-ring spine-hit-area ${styles.downloadButton}`}
          href={href}
          aria-label={`Unduh ${file.name}`}
          download
        >
          {ICON_DOWNLOAD}
        </a>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* kartu Section publik (varian Project)                               */
/* ------------------------------------------------------------------ */

function PublicSectionCard({
  section,
  slug,
  onZip,
  zipBusy,
}: {
  section: ShareSection;
  slug: string;
  onZip: (id: string, title: string) => void;
  zipBusy: string | null;
}) {
  const [a, b, c] = section.repThumbs;
  const bg = (url: string | null | undefined) =>
    url ? { backgroundImage: `url(${url})` } : undefined;
  return (
    <article className={styles.sectionCell}>
      <span className={`${styles.sectionBack} ${styles.sectionBack1}`} style={bg(b)} aria-hidden="true" />
      <span className={`${styles.sectionBack} ${styles.sectionBack2}`} style={bg(c)} aria-hidden="true" />
      <div className={styles.sectionFront} style={bg(a)}>
        <p className={`spine-display-card ${styles.sectionTitle}`}>{section.title}</p>
      </div>
      {section.number ? (
        <NumberSticker value={section.number} className={styles.sectionSticker} />
      ) : null}
      {/* Tautan drill-in: SATU kontrol pembuka seluas kartu, sibling dari
          tombol ZIP (bukan kontrol bersarang di dalam tautan). */}
      <a
        className={`spine-focus-ring ${styles.openLink}`}
        href={`/s/${slug}?section=${section.id}`}
        aria-label={`Buka isi Section ${section.title}, ${formatNumber(section.fileCount)} file`}
      >
        <span className="spine-visually-hidden">Buka</span>
      </a>
      <div className={styles.sectionFoot}>
        <span className={`spine-chip ${styles.chip}`}>
          {formatNumber(section.fileCount)} file
        </span>
        <button
          type="button"
          className={`spine-focus-ring spine-hit-area ${styles.downloadButton}`}
          aria-label={`Download ZIP ${section.title}`}
          aria-busy={zipBusy === section.id || undefined}
          onClick={() => onZip(section.id, section.title)}
        >
          {ICON_DOWNLOAD}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* halaman                                                             */
/* ------------------------------------------------------------------ */

const FILE_SORT_LABELS: { value: string; label: string }[] = [
  { value: "nama", label: "Nama" },
  { value: "tanggal", label: "Tanggal ▼" },
  { value: "ukuran", label: "Ukuran" },
  { value: "tipe", label: "Tipe" },
];

const SECTION_SORT_LABELS: { value: string; label: string }[] = [
  { value: "nomor", label: "Nomor ▲" },
  { value: "nama", label: "Nama" },
  { value: "jumlah", label: "Jumlah file" },
];

export default function SharePage({ payload }: { payload: SharePayload }) {
  const [files, setFiles] = useState<ShareFile[]>(payload.files);
  const [sections, setSections] = useState<ShareSection[]>(payload.sections);
  const [sort, setSort] = useState<string>(payload.kind === "project" && !payload.section ? "nomor" : "tanggal");
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const [dead, setDead] = useState<ShareInvalidKind | null>(null);
  /* Rasio tampil media file tunggal (video: videoWidth/videoHeight, foto:
     naturalWidth/Height). Membatasi lebar viewer inline supaya media potret
     tidak lebih tinggi dari ±78 % tinggi layar — lanskap tetap 960px. */
  const [mediaRatio, setMediaRatio] = useState<number | null>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const [live, setLive] = useState("");
  const gridId = useId();
  /* Signed URLs of the single-file variant. The media source stays put
     (re-signed only on error) so playback never restarts on a refresh. */
  const [single, setSingle] = useState<ShareFile | null>(payload.single);
  const [mediaSrc, setMediaSrc] = useState<string | null>(payload.single?.inlineUrl ?? null);
  /** Stage thumbnails are signed too, so they are refreshed with the rest. */
  const [stageThumbs, setStageThumbs] = useState<(string | null)[]>(payload.stageThumbs);
  /** True while an error re-sign is in flight or failed: at most one retry per failure. */
  const mediaRetryRef = useRef(false);
  const videoRef = useRef<VideoPlayerHandle>(null);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const mapDeadRef = useRef<(body: { state?: string; target?: string } | null) => ShareInvalidKind | null>(() => null);

  /** Re-mints signed URLs for these files. Null when the link died meanwhile. */
  type SignResult = {
    files?: Record<string, Pick<ShareFile, "thumbnailUrl" | "inlineUrl" | "downloadUrl">>;
    stageThumbs?: (string | null)[] | null;
    sectionThumbs?: Record<string, (string | null)[]> | null;
  };
  const signFiles = useCallback(
    async (fileIds: string[], thumbs = false): Promise<SignResult | null> => {
      const res = await fetch(`/s/${payload.slug}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds, thumbs, section: payload.section?.id ?? null }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const kind = mapDeadRef.current(body);
        if (kind) setDead(kind);
        return null;
      }
      return (body ?? {}) as SignResult;
    },
    [payload.slug, payload.section],
  );

  // Refresh every 4 minutes (signed URLs live 5).
  useEffect(() => {
    const t = window.setInterval(async () => {
      const ids = filesRef.current.map((f) => f.id);
      if (payload.single) ids.push(payload.single.id);
      const result = await signFiles(ids, true).catch(() => null);
      if (!result) return;
      const fresh = result.files ?? {};
      setFiles((prev) => prev.map((f) => (fresh[f.id] ? { ...f, ...fresh[f.id] } : f)));
      setSingle((prev) => (prev && fresh[prev.id] ? { ...prev, ...fresh[prev.id] } : prev));
      if (result.stageThumbs) setStageThumbs(result.stageThumbs);
      const sectionThumbs = result.sectionThumbs;
      if (sectionThumbs) {
        setSections((prev) => prev.map((s) => (sectionThumbs[s.id] ? { ...s, repThumbs: sectionThumbs[s.id] } : s)));
      }
    }, 4 * 60 * 1000);
    return () => window.clearInterval(t);
  }, [payload.single, signFiles]);

  /** The inline media failed (expired URL): re-sign and resume where it was. */
  const onMediaError = useCallback(async () => {
    // One retry per failure: if the fresh URL fails too, stop (no loop).
    if (!payload.single || mediaRetryRef.current) return;
    mediaRetryRef.current = true;
    const el = videoRef.current?.element() ?? null;
    const at = el ? el.currentTime : 0;
    const wasPlaying = el ? !el.paused : false;
    const fresh = await signFiles([payload.single.id]).catch(() => null);
    const next = fresh?.files?.[payload.single.id]?.inlineUrl;
    if (!next || next === mediaSrc) return;
    setMediaSrc(next);
    if (el) {
      const resume = () => {
        mediaRetryRef.current = false; // loaded again: a later expiry may retry once more
        el.currentTime = at;
        if (wasPlaying) void el.play().catch(() => undefined);
      };
      el.addEventListener("loadedmetadata", resume, { once: true });
    }
  }, [payload.single, signFiles, mediaSrc]);

  const pagesSections = payload.kind === "project" && !payload.section;
  const shown = pagesSections ? sections.length : files.length;
  const total = pagesSections ? payload.sectionCount ?? 0 : payload.fileCount;
  const unit = pagesSections ? "Section" : "file";
  const remaining = Math.max(0, total - shown);

  /** Link mati di tengah kunjungan → pindah ke keadaan Story 3.11. */
  const mapDead = (body: { state?: string; target?: string } | null): ShareInvalidKind | null => {
    if (!body?.state) return null;
    if (body.state === "expired") return "expired";
    if (body.state === "not-found") return "not-found";
    if (body.state === "private") return "private";
    if (body.state === "gone") {
      return body.target === "project" ? "project-gone" : body.target === "file" ? "file-gone" : "section-gone";
    }
    return null;
  };
  useEffect(() => {
    mapDeadRef.current = mapDead;
  });

  const fetchPage = useCallback(
    async (offset: number, nextSort: string, replace: boolean) => {
      const q = new URLSearchParams({
        offset: String(offset),
        limit: String(SHARE_PAGE_SIZE),
        sort: nextSort,
      });
      if (payload.section) q.set("section", payload.section.id);
      const res = await fetch(`/s/${payload.slug}/items?${q.toString()}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const kind = mapDead(body);
        if (kind) {
          setDead(kind);
          return null;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as { files: ShareFile[]; sections: ShareSection[] };
      if (replace) {
        setFiles(body.files);
        setSections(body.sections);
      } else {
        // Isi yang SUDAH tampil tidak pernah dikosongkan.
        setFiles((prev) => (body.files.length ? [...prev, ...body.files] : prev));
        setSections((prev) => (body.sections.length ? [...prev, ...body.sections] : prev));
      }
      return body;
    },
    [payload.slug, payload.section],
  );

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setPageError(null);
    try {
      const body = await fetchPage(shown, sort, false);
      if (body) {
        const added = pagesSections ? body.sections.length : body.files.length;
        setLive(`${formatNumber(added)} ${unit} lagi ditampilkan.`);
      }
    } catch {
      // Fokus TIDAK dipindah: pengguna keyboard tetap di tombol yang
      // baru ditekan, dan baris yang sudah tampil tetap tampil.
      setPageError("Gagal memuat file berikutnya. Coba lagi.");
    } finally {
      setLoadingMore(false);
    }
  };

  const changeSort = async (next: string) => {
    if (next === sort || loadingMore) return;
    setSort(next);
    setLoadingMore(true);
    setPageError(null);
    try {
      await fetchPage(0, next, true);
    } catch {
      setPageError("Gagal mengurutkan ulang. Coba lagi.");
    } finally {
      setLoadingMore(false);
    }
  };

  /**
   * "Download ZIP". The archive STREAMS, so its failures never come back to
   * the page: `POST /s/<slug>/sign` checks the link, the target and the
   * first file first and mints a fresh signed ZIP URL. The button never
   * stays stuck on "Menyiapkan...".
   */
  const downloadZip = async (sectionId: string | null, key: string) => {
    if (zipBusy) return;
    setZipBusy(key);
    setZipError(null);
    try {
      const section = sectionId ?? payload.section?.id ?? null;
      const res = await fetch(`/s/${payload.slug}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip: true, section }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as
        | { zipUrl?: string | null; cause?: string | null; state?: string; target?: string }
        | null;
      if (!res.ok) {
        const kind = mapDead(body);
        if (kind) {
          setDead(kind);
          return;
        }
        setZipError("Server sedang bermasalah.");
        return;
      }
      if (!body?.zipUrl) {
        setZipError(
          body?.cause === "EMPTY"
            ? "Tidak ada file untuk diunduh di link ini."
            : body?.cause === "UNREADABLE"
              ? "Berkasnya tidak bisa dibaca di penyimpanan."
              : "Berkasnya sudah tidak ada lagi.",
        );
        return;
      }
      window.location.href = body.zipUrl;
    } catch {
      setZipError("Sambungan ke server terputus.");
    } finally {
      setZipBusy(null);
    }
  };

  if (dead) return <ShareInvalid kind={dead} slug={payload.slug} />;

  const headline = payload.section ? payload.section.title : payload.title;
  const stickerNumber = payload.section ? payload.section.number : payload.number;

  return (
    <main className={styles.page} lang="id">
      <div className={styles.topbar}>
        {/* Logo tidak bisa diklik — identitas, bukan navigasi. */}
        <Logo size="login" />
        <ThemeToggle />
      </div>

      <div className={styles.hero}>
        <div className={styles.stage}>
          <div className={styles.copy}>
            <div className={styles.tagrow}>
              <TagPill>Arsip premium</TagPill>
              {stickerNumber ? <NumberSticker value={stickerNumber} /> : null}
            </div>
            <h1
              className={`spine-display-hero ${styles.headline} ${
                payload.kind === "file" ? styles.headlineFile : ""
              }`}
            >
              {headline}
            </h1>
          </div>
          <div className={styles.stack} aria-hidden="true">
            {(payload.kind === "file" ? [stageThumbs[0] ?? null] : stageThumbs)
              .slice(0, 3)
              .map((url, i) => (
                <span
                  key={i}
                  className={styles.stackCard}
                  style={
                    {
                      "--x": payload.kind === "file" ? "0px" : ["-70px", "70px", "0px"][i],
                      "--r": payload.kind === "file" ? "-2deg" : ["-14deg", "14deg", "-2deg"][i],
                      backgroundImage: url ? `url(${url})` : undefined,
                    } as React.CSSProperties
                  }
                />
              ))}
          </div>
          <div className={styles.fade} aria-hidden="true" />
        </div>

        <div className={styles.card}>
          <p className={`spine-label ${styles.kick}`}>
            Project · <b>{payload.projectName ?? brand.productName}</b>
            {payload.sectionLabel ? (
              <>
                <br />
                Section · <b>{payload.sectionLabel}</b>
              </>
            ) : null}
          </p>
          <div className={styles.chips}>
            <span className={`spine-chip ${styles.chip}`}>
              {ICON_FILES}
              {payload.kind === "file"
                ? KIND_WORD[single!.kind]
                : payload.kind === "project" && !payload.section
                  ? `${formatNumber(payload.sectionCount ?? 0)} Section`
                  : `${formatNumber(payload.fileCount)} file`}
            </span>
            {payload.kind === "project" && !payload.section ? (
              <span className={`spine-chip ${styles.chip}`}>{formatNumber(payload.fileCount)} file</span>
            ) : null}
            <span className={`spine-chip ${styles.chip}`}>{payload.totalSizeText}</span>
            <span className={`spine-chip ${styles.chip}`}>{payload.dateText}</span>
          </div>
          {payload.breakdown ? (
            <p className={`spine-body-sm ${styles.breakdown}`}>{payload.breakdown}</p>
          ) : null}
          <ButtonPrimary
            type="button"
            arrow={false}
            className={styles.zipButton}
            busy={zipBusy === "main"}
            busyLabel="Menyiapkan..."
            onClick={() => downloadZip(null, "main")}
          >
            {payload.kind === "file" ? "Download" : "Download ZIP"}
          </ButtonPrimary>
          {zipError ? (
            <ErrorBox
              className={styles.cardError}
              title="Gagal menyiapkan unduhan. Coba lagi."
              text={zipError}
              onRetry={() => downloadZip(null, "main")}
            />
          ) : null}
          <p className={`spine-footnote ${styles.expiry}`}>
            {payload.expiresAt ? ICON_CLOCK : ICON_INFINITY}
            <span>
              {payload.expiresAt ? (
                <>
                  Link berlaku sampai{" "}
                  <b>
                    {formatDate(payload.expiresAt)}, {formatTimeWIB(payload.expiresAt)}
                  </b>
                </>
              ) : (
                "Link tanpa batas waktu"
              )}
            </span>
          </p>
        </div>
      </div>

      {/* Drill-in Section di dalam halaman share (varian Project). */}
      {payload.section ? (
        <div className={styles.backRow}>
          <a className={`spine-button spine-focus-ring spine-hit-area ${styles.backPill}`} href={`/s/${payload.slug}`}>
            ← {payload.title}
          </a>
        </div>
      ) : null}

      {/* Varian file tunggal: viewer inline, tanpa Share / ⓘ / prev-next. */}
      {single ? (
        <div className={styles.inline}>
          <div
            className={styles.inlineMedia}
            style={mediaRatio ? { maxWidth: `min(960px, calc(78dvh * ${mediaRatio}))` } : undefined}
          >
            {single.kind === "video" ? (
              <VideoPlayer
                ref={videoRef}
                src={mediaSrc ?? ""}
                poster={single.thumbnailUrl}
                label={single.name}
                playSize="lg"
                onMetadata={(m) => setMediaRatio(m.width / m.height)}
                onSourceError={onMediaError}
              />
            ) : single.kind === "image" ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={mediaSrc ?? undefined}
                alt={single.name}
                onError={onMediaError}
                // Halaman ini di-render server: foto (apalagi dari cache) bisa
                // selesai dimuat SEBELUM listener React terpasang, sehingga
                // onLoad tidak pernah menyala — baca juga saat elemen dipasang.
                ref={(img) => {
                  if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
                    setMediaRatio(img.naturalWidth / img.naturalHeight);
                  }
                }}
                onLoad={(e) => {
                  mediaRetryRef.current = false;
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) setMediaRatio(img.naturalWidth / img.naturalHeight);
                }}
              />
            ) : null}
          </div>
          <p className={`spine-body-sm ${styles.inlineCaption}`}>
            {single.name}
            <span>
              {KIND_WORD[single.kind]} · {single.sizeText} · {payload.dateText}
            </span>
          </p>
        </div>
      ) : (
        <>
          <div className={styles.lhead}>
            <p className={`spine-label ${styles.lt}`}>
              {pagesSections ? "Isi project · " : "Isi Section · "}
              <b>
                {formatNumber(total)} {unit}
              </b>
            </p>
            <div className={styles.sortPills} role="group" aria-label="Urutkan">
              {(pagesSections ? SECTION_SORT_LABELS : FILE_SORT_LABELS).map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={sort === p.value}
                  className={`spine-sort spine-focus-ring--inset ${styles.sortPill} ${
                    sort === p.value ? styles.sortPillOn : ""
                  }`}
                  onClick={() => changeSort(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div
            id={gridId}
            className={`${styles.grid} ${pagesSections ? styles.gridSections : ""}`}
          >
            {pagesSections
              ? sections.map((s) => (
                  <PublicSectionCard
                    key={s.id}
                    section={s}
                    slug={payload.slug}
                    zipBusy={zipBusy}
                    onZip={(id) => downloadZip(id, id)}
                  />
                ))
              : files.map((f) => (
                  <PublicFileCard key={f.id} file={f} />
                ))}
          </div>

          {remaining > 0 || pageError ? (
            <div className={styles.moreRow}>
              <p className={`spine-body-sm ${styles.moreCount}`}>
                Menampilkan {formatNumber(shown)} dari {formatNumber(total)} {unit}.
              </p>
              {remaining > 0 ? (
                <PillButton
                  variant="surface"
                  busy={loadingMore}
                  busyLabel="Memuat..."
                  onClick={loadMore}
                >
                  Tampilkan {formatNumber(remaining)} {unit} lagi
                </PillButton>
              ) : null}
              {pageError ? (
                <ErrorBox className={styles.moreError} title={pageError} onRetry={loadMore} />
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <p ref={liveRef} className="spine-visually-hidden" role="status">
        {live}
      </p>

      <footer className={`spine-footnote ${styles.foot}`}>
        <Logo size="mobile" />
        Self-hosted media cloud for creators
      </footer>
    </main>
  );
}
