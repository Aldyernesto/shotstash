/**
 * MIME sniffing and the one extension table (AD-3).
 *
 * The stored extension comes from the sniffed MIME type through `MIME_EXT`,
 * never from the name the client sent. The client's extension is used only
 * as a tie-breaker where the bytes allow several types (a TIFF-based camera
 * RAW, an ISO media file that is a .mov, an Office document inside a ZIP)
 * and to accept an alias of the sniffed type (.jpeg for image/jpeg).
 *
 * A small fixed signature table rather than a dependency: the set of types
 * a media library stores is short and stable. Pure and alias-free.
 */

/** How many leading bytes `sniffMime` looks at. */
export const SNIFF_BYTES = 4100;

/** MIME type -> allowed extensions, the first one is the default. */
export const MIME_EXT: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/bmp': ['bmp'],
  'image/tiff': ['tif', 'tiff'],
  'image/heic': ['heic'],
  'image/heif': ['heif', 'heic'],
  'image/avif': ['avif'],
  'image/x-adobe-dng': ['dng'],
  'image/x-canon-cr2': ['cr2'],
  'image/x-canon-cr3': ['cr3'],
  'image/x-nikon-nef': ['nef'],
  'image/x-sony-arw': ['arw'],
  'image/x-olympus-orf': ['orf'],
  'image/x-panasonic-rw2': ['rw2'],
  'image/vnd.adobe.photoshop': ['psd'],
  'video/mp4': ['mp4', 'm4v'],
  'video/quicktime': ['mov'],
  'video/x-m4v': ['m4v'],
  'video/x-matroska': ['mkv'],
  'video/webm': ['webm'],
  'video/x-msvideo': ['avi'],
  'video/mp2t': ['ts', 'mts', 'm2ts'],
  'video/x-flv': ['flv'],
  'video/3gpp': ['3gp'],
  'video/x-ms-wmv': ['wmv', 'asf'],
  'audio/mpeg': ['mp3'],
  'audio/mp4': ['m4a'],
  'audio/wav': ['wav'],
  'audio/flac': ['flac'],
  'audio/ogg': ['ogg', 'oga'],
  'application/pdf': ['pdf'],
  'application/zip': ['zip'],
  'application/vnd.rar': ['rar'],
  'application/x-7z-compressed': ['7z'],
  'application/msword': ['doc'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'text/plain': ['txt', 'md', 'log'],
  'text/csv': ['csv'],
  'application/json': ['json'],
  'application/xml': ['xml'],
  'text/vtt': ['vtt'],
  'application/x-subrip': ['srt'],
  'application/octet-stream': ['bin'],
};

/** Extension of a client file name, lowercased, without the dot ('' when none). */
export function nameExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/** The stored extension for `mime`: the client's one when it is an alias, else the default. */
export function extensionFor(mime: string, clientName = ''): string {
  const exts = MIME_EXT[mime] ?? MIME_EXT['application/octet-stream'];
  const wanted = nameExtension(clientName);
  return exts.includes(wanted) ? wanted : exts[0];
}

/** MIME type a client name suggests (used only before the bytes arrive). */
export function mimeFromName(name: string): string {
  const e = nameExtension(name);
  if (!e) return 'application/octet-stream';
  for (const [mime, exts] of Object.entries(MIME_EXT)) if (exts[0] === e) return mime;
  for (const [mime, exts] of Object.entries(MIME_EXT)) if (exts.includes(e)) return mime;
  return 'application/octet-stream';
}

function startsWith(b: Uint8Array, sig: number[], offset = 0): boolean {
  if (b.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(b: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < Math.min(end, b.length); i++) s += String.fromCharCode(b[i]);
  return s;
}

const RAW_TIFF: Record<string, string> = {
  dng: 'image/x-adobe-dng',
  cr2: 'image/x-canon-cr2',
  nef: 'image/x-nikon-nef',
  arw: 'image/x-sony-arw',
};

const OLE_BY_EXT: Record<string, string> = {
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
};

const OOXML_BY_EXT: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const TEXT_BY_EXT: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  vtt: 'text/vtt',
  srt: 'application/x-subrip',
};

const HEIC_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'];

function isoMedia(b: Uint8Array, ext: string): string | null {
  if (ascii(b, 4, 8) !== 'ftyp') return null;
  const major = ascii(b, 8, 12);
  const boxSize = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  const brands = [major];
  for (let o = 16; o + 4 <= Math.min(boxSize, 64, b.length); o += 4) brands.push(ascii(b, o, o + 4));
  if (HEIC_BRANDS.includes(major)) return 'image/heic';
  if (major === 'mif1' || major === 'msf1') {
    if (brands.some((x) => HEIC_BRANDS.includes(x))) return 'image/heic';
    if (brands.includes('avif')) return 'image/avif';
    return 'image/heif';
  }
  if (major === 'avif' || major === 'avis') return 'image/avif';
  if (major === 'crx ') return 'image/x-canon-cr3';
  if (major === 'qt  ') return 'video/quicktime';
  if (major === 'M4A ' || major === 'M4B ') return 'audio/mp4';
  if (major === 'M4V ' || major === 'M4VH' || major === 'M4VP') return 'video/x-m4v';
  if (major.startsWith('3g')) return 'video/3gpp';
  // Generic ISO brands (isom, mp41, mp42, iso2, avc1, dash): a camera .mov
  // can carry one of these, so the client's extension breaks the tie.
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'm4a') return 'audio/mp4';
  return 'video/mp4';
}

function looksLikeText(b: Uint8Array): boolean {
  const n = Math.min(b.length, 1024);
  for (let i = 0; i < n; i++) {
    const c = b[i];
    if (c === 0) return false;
    if (c < 9 || (c > 13 && c < 32 && c !== 27)) return false;
  }
  return true;
}

/**
 * MIME type of a file from its first bytes (`SNIFF_BYTES` are enough).
 * `clientName` only breaks ties; unknown bytes answer
 * `application/octet-stream`.
 */
export function sniffMime(head: Uint8Array, clientName = ''): string {
  const b = head;
  const e = nameExtension(clientName);
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(b, 0, 4) === 'RIFF') {
    const kind = ascii(b, 8, 12);
    if (kind === 'WEBP') return 'image/webp';
    if (kind === 'AVI ') return 'video/x-msvideo';
    if (kind === 'WAVE') return 'audio/wav';
  }
  if (startsWith(b, [0x49, 0x49, 0x52, 0x4f])) return 'image/x-olympus-orf';
  if (startsWith(b, [0x49, 0x49, 0x55, 0x00])) return 'image/x-panasonic-rw2';
  if (startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) {
    if (startsWith(b, [0x43, 0x52], 8)) return 'image/x-canon-cr2';
    return RAW_TIFF[e] ?? 'image/tiff';
  }
  if (ascii(b, 0, 2) === 'BM' && b.length > 14) return 'image/bmp';
  if (ascii(b, 0, 4) === '8BPS') return 'image/vnd.adobe.photoshop';
  const iso = isoMedia(b, e);
  if (iso) return iso;
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) return ascii(b, 0, 64).includes('webm') ? 'video/webm' : 'video/x-matroska';
  if (b[0] === 0x47 && b.length > 188 && b[188] === 0x47) return 'video/mp2t';
  if (ascii(b, 0, 3) === 'FLV') return 'video/x-flv';
  // ASF container (WMV): header object GUID 75B22630-668E-11CF-A6D9-00AA0062CE6C.
  if (startsWith(b, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) return 'video/x-ms-wmv';
  if (ascii(b, 0, 3) === 'ID3') return 'audio/mpeg';
  if (b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return 'audio/mpeg';
  if (ascii(b, 0, 4) === 'fLaC') return 'audio/flac';
  if (ascii(b, 0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) {
    return OOXML_BY_EXT[e] ?? 'application/zip';
  }
  if (ascii(b, 0, 4) === 'Rar!') return 'application/vnd.rar';
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return 'application/x-7z-compressed';
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return OLE_BY_EXT[e] ?? 'application/octet-stream';
  if (b.length && looksLikeText(b)) {
    if (TEXT_BY_EXT[e]) return TEXT_BY_EXT[e];
    if (ascii(b, 0, 6) === 'WEBVTT') return 'text/vtt';
  }
  return 'application/octet-stream';
}

/** Sniffed MIME type plus the extension stored in the key. */
export function sniffType(head: Uint8Array, clientName = ''): { mime: string; ext: string } {
  const mime = sniffMime(head, clientName);
  return { mime, ext: extensionFor(mime, clientName) };
}
