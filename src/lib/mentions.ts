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
