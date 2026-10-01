/**
 * Story 4.2 — util bersama tag mention percakapan.
 *
 * SATU sumber untuk BENTUK tag yang disimpan di `ProjectChat.message` —
 * persis yang ditulis `selectMention` Chat Monitor sejak sebelum redesign:
 *
 *     @[{type}:{id}:{parentId}:{Nama}]   type = project | folder | file
 *
 * `parseMentionTags` memecah isi pesan menjadi potongan teks biasa dan
 * potongan mention supaya UI (Chat Monitor Story 4.2, panel Diskusi
 * project Story 4.3) merender `mention-chip` "@{Nama}" alih-alih tag
 * mentah. Aturan keras:
 *   - yang tidak cocok pola — "@" biasa, kurung siku tanpa pola lengkap,
 *     tipe yang tidak dikenal — dikembalikan APA ADANYA sebagai teks,
 *     tidak pernah dimakan parser;
 *   - `{Nama}` dikembalikan sebagai STRING; pemanggil merendernya sebagai
 *     teks React (bukan HTML), jadi nama berisi `<` atau `&` tidak bisa
 *     menyuntikkan markup;
 *   - berkas ini bebas React/DOM supaya bisa dipakai di mana saja.
 */

export type MentionTagType = "project" | "folder" | "file";

export type MentionPart =
  | { kind: "text"; text: string }
  | {
      kind: "mention";
      type: MentionTagType;
      id: string;
      parentId: string;
      name: string;
      /** Tag mentah persis seperti di pesan — untuk pengganti/hapus. */
      raw: string;
    };

/* Nama boleh memuat spasi, titik, dan hampir apa pun KECUALI kurung siku
   (penutup tag). Id dan parentId tidak boleh memuat ":" atau kurung siku. */
const TAG_RE = /@\[(project|folder|file):([^:\[\]]+):([^:\[\]]+):([^\[\]]*)\]/g;

/** Memecah pesan menjadi potongan teks & mention, urut sesuai posisinya. */
export function parseMentionTags(message: string): MentionPart[] {
  const parts: MentionPart[] = [];
  if (!message) return parts;
  let last = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(message)) !== null) {
    if (m.index > last) parts.push({ kind: "text", text: message.slice(last, m.index) });
    parts.push({
      kind: "mention",
      type: m[1] as MentionTagType,
      id: m[2],
      parentId: m[3],
      name: m[4],
      raw: m[0],
    });
    last = m.index + m[0].length;
  }
  if (last < message.length) parts.push({ kind: "text", text: message.slice(last) });
  return parts;
}

/** Merakit tag dengan bentuk yang SAMA dengan yang dibaca `parseMentionTags`. */
export function encodeMentionTag(type: MentionTagType, id: string, parentId: string, name: string): string {
  return `@[${type}:${id}:${parentId}:${name}]`;
}

/** Kata tipe untuk nama aksesibel chip — `folder` dibaca Section. */
export const MENTION_TYPE_WORD: Record<MentionTagType, "Project" | "Section" | "File"> = {
  project: "Project",
  folder: "Section",
  file: "File",
};

/* ------------------------------------------------------------------ */
/* Story 2.5: people mentions for chat notifications                   */
/* ------------------------------------------------------------------ */

/* "@Name" in plain text (not an entity tag "@[...]"): letters, digits,
   dot, underscore and hyphen. Must start the message or follow a
   non-word character, so "a@b.c" email addresses are not mentions. */
const HANDLE_RE = /(^|[^\w@])@([\p{L}\p{N}][\p{L}\p{N}._-]{0,63})/gu;

/** Lowercased "@handle" words of a message, entity tags excluded. */
export function mentionHandles(message: string): string[] {
  const out = new Set<string>();
  if (!message) return [];
  const text = message.replace(TAG_RE, " ");
  HANDLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HANDLE_RE.exec(text)) !== null) out.add(m[2].replace(/[._-]+$/, "").toLowerCase());
  return [...out].filter(Boolean);
}

/**
 * Whether a handle names this user: the display name with spaces removed
 * ("@FieldCrew", "@viewer") or the local part of the email.
 */
export function handleMatchesUser(handle: string, user: { name: string; email: string }): boolean {
  const h = handle.toLowerCase();
  const name = user.name.replace(/\s+/g, "").toLowerCase();
  const local = user.email.split("@")[0]?.toLowerCase() ?? "";
  return h === name || h === local;
}

/* "@handle" a person can be mentioned with: the display name without spaces
   when it is a valid handle, else the local part of the email when that is
   one; null when neither is (the person is not offered). Both are what
   `handleMatchesUser` accepts. */
const PERSON_HANDLE_RE = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;

function validHandle(value: string): boolean {
  return PERSON_HANDLE_RE.test(value) && !/[._-]$/.test(value);
}

function emailLocal(user: { email: string }): string {
  return user.email.split("@")[0] ?? "";
}

export function mentionHandleFor(user: { name: string; email: string }): string | null {
  const compact = user.name.replace(/\s+/g, "");
  if (validHandle(compact)) return compact;
  const local = emailLocal(user);
  return validHandle(local) ? local : null;
}

/**
 * Story 5.5: one handle per person, never shared. A person whose name handle
 * collides with someone else's falls back to the email local part; a handle
 * that still collides (or none is valid) is dropped, so one pick or one
 * typed "@handle" names exactly one account. Answers id to handle.
 */
export function assignMentionHandles<T extends { id: string; name: string; email: string }>(people: readonly T[]): Map<string, string> {
  const taken = (pairs: [string, string][]) => {
    const count = new Map<string, number>();
    for (const [, h] of pairs) count.set(h.toLowerCase(), (count.get(h.toLowerCase()) ?? 0) + 1);
    return count;
  };
  // Every key a typed handle can match (name and email local part) of everyone.
  const claims = taken(
    people.flatMap((p) => {
      const out: [string, string][] = [];
      const compact = p.name.replace(/\s+/g, "");
      if (compact) out.push([p.id, compact]);
      const local = emailLocal(p);
      if (local && local.toLowerCase() !== compact.toLowerCase()) out.push([p.id, local]);
      return out;
    }),
  );
  const result = new Map<string, string>();
  for (const p of people) {
    const compact = p.name.replace(/\s+/g, "");
    const local = emailLocal(p);
    for (const candidate of [compact, local]) {
      if (candidate && validHandle(candidate) && claims.get(candidate.toLowerCase()) === 1) {
        result.set(p.id, candidate);
        break;
      }
    }
  }
  return result;
}

/**
 * The one account a typed handle names among `people`: the person whose
 * assigned handle it is, else the only person `handleMatchesUser` accepts;
 * null when none or several (an ambiguous handle notifies nobody).
 */
export function resolveMentionHandle<T extends { id: string; name: string; email: string }>(
  handle: string,
  people: readonly T[],
  assigned: ReadonlyMap<string, string>,
): T | null {
  const h = handle.toLowerCase();
  const exact = people.filter((p) => assigned.get(p.id)?.toLowerCase() === h);
  if (exact.length === 1) return exact[0];
  const loose = people.filter((p) => handleMatchesUser(h, p));
  return loose.length === 1 ? loose[0] : null;
}
