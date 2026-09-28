/**
 * Story 3.16 — chip percakapan bersama.
 *
 * `mention-chip`, `attachment-chip`, `role-chip`, `project-tag`.
 * Dibangun DI SINI sebagai satu-satunya sumbernya; panel Diskusi project
 * (Story 3.17), Chat Monitor (Story 3.24), dan pipeline
 * (Story 3.29–3.31) mengonsumsinya.
 *
 * NFR15 dijaga di setiap chip: artinya selalu tertulis sebagai TEKS —
 * warna hanya penguat. Ikon selalu `aria-hidden`.
 */

import React from "react";
import Link from "next/link";
import styles from "./chat.module.css";
import { roleChipLabel } from "@/lib/permissions";
import { parseMentionTags, type MentionTagType } from "@/lib/mentions";

/* ------------------------------------------------------------------ */
/* project-tag                                                         */
/* ------------------------------------------------------------------ */

export type ProjectTagProps = {
  name: string;
  /** Tautan ke Project. Tanpa `href` chip dirender sebagai teks biasa. */
  href?: string;
  className?: string;
};

/**
 * Mini Project card label: accent-2 name on a black pill, 28px.
 * Sebagai tautan namanya "Buka Project {nama}" (AC 3.16).
 */
export function ProjectTag({ name, href, className }: ProjectTagProps) {
  const body = <span>{name}</span>;
  const cls = `spine-display-label ${styles.projectTag} ${className ?? ""}`;
  if (!href) {
    return <span className={cls}>{body}</span>;
  }
  return (
    <Link href={href} aria-label={`Buka Project ${name}`} className={`spine-focus-ring ${cls}`}>
      {body}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* mention-chip                                                        */
/* ------------------------------------------------------------------ */

export type MentionTargetType = "PROJECT" | "SECTION" | "FILE";

const TYPE_WORD: Record<MentionTargetType, string> = {
  PROJECT: "Project",
  SECTION: "Section",
  FILE: "File",
};

export type MentionChipProps = {
  name: string;
  type: MentionTargetType;
  className?: string;
};

/**
 * Black pill with an accent-2 name "@Raudhah", read as "@Raudhah, Section".
 * INVARIANT block: it stays a black pill in the light theme, so the accent-2
 * text never lands on a light surface.
 */
export function MentionChip({ name, type, className }: MentionChipProps) {
  return (
    <span className={`${styles.mentionChip} ${className ?? ""}`}>
      @{name}
      <span className="spine-visually-hidden">, {TYPE_WORD[type]}</span>
    </span>
  );
}

/* Tipe tag yang disimpan (`project|folder|file`) → tipe chip; `folder`
   dibaca SECTION (istilah app). */
const TAG_TO_CHIP: Record<MentionTagType, MentionTargetType> = {
  project: "PROJECT",
  folder: "SECTION",
  file: "FILE",
};

/**
 * Story 4.2 — isi pesan dengan tag mentah `@[folder:id:id:Nama]` dirender
 * sebagai teks biasa + `mention-chip`. Memakai `parseMentionTags`
 * (`src/lib/mentions.ts`); potongan teks dirender sebagai TEKS React, jadi
 * nama berisi `<` atau `&` tidak pernah menjadi markup.
 */
export function MentionText({ message }: { message: string }) {
  const parts = parseMentionTags(message);
  return (
    <>
      {parts.map((part, i) =>
        part.kind === "text" ? (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        ) : (
          <MentionChip key={i} name={part.name} type={TAG_TO_CHIP[part.type]} />
        ),
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* attachment-chip                                                     */
/* ------------------------------------------------------------------ */

const CLIP_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
  </svg>
);

export type AttachmentChipProps = {
  name: string;
  /** Tanpa `onRemove` chip hanya menampilkan lampiran (kartu pesan). */
  onRemove?: () => void;
  className?: string;
};

/** Pill with an accent paperclip icon, read as "Lampiran: {nama}". */
export function AttachmentChip({ name, onRemove, className }: AttachmentChipProps) {
  return (
    <span
      className={`${styles.attChip} ${onRemove ? styles.attChipRemovable : ""} ${className ?? ""}`}
    >
      {CLIP_ICON}
      <span className={styles.attName}>Lampiran: {name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Hapus lampiran ${name}`}
          className={`spine-focus-ring spine-hit-area ${styles.attRemove}`}
          onClick={onRemove}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* role-chip                                                           */
/* ------------------------------------------------------------------ */

export type RoleChipProps = {
  role: string;
  className?: string;
};

/**
 * Label role UTUH KAPITAL (SUPER ADMIN, ADMIN, FIELD CREW, EDITOR,
 * VIEWER). Admin is tinted accent, other roles are neutral.
 *
 * Kata rolenya berasal dari `src/lib/permissions.ts` — satu sumber
 * kebenaran yang sama dengan `avatar-pill`, bukan peta baru di sini.
 */
export function RoleChip({ role, className }: RoleChipProps) {
  const admin = role === "SUPER_ADMIN" || role === "ADMIN";
  return (
    <span
      className={`spine-label ${styles.roleChip} ${admin ? styles.roleChipAdmin : ""} ${className ?? ""}`}
    >
      {roleChipLabel(role)}
    </span>
  );
}
