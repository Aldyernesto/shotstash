// Story 1.9: satu util format angka/tanggal/jam konvensi Indonesia (FR4).
// Aturan sumber: EXPERIENCE.md — ribuan titik ("7.354"), desimal koma
// ("3,8 MB"), satuan kecil ("file"), hitungan "48 kali", tanggal
// "16 Jun 2026", waktu relatif "baru saja / 5 mnt / 2 jam / 16 Sep 2026",
// jam selalu bersufiks WIB. Semua jam memakai zona EKSPLISIT Asia/Jakarta
// — bukan zona perangkat — supaya angkanya sama dengan yang dikirim di
// email. Waktu kamera (EXIF) punya jalur terpisah yang TIDAK PERNAH
// dikonversi: ditulis apa adanya + keterangan "(waktu kamera)".
// Bagian jam memakai locale en-GB secara sengaja: CLDR id-ID menulis jam
// dengan titik ("20.15"), sedangkan DESIGN.md menetapkan "20:15 WIB".

const TZ_WIB = "Asia/Jakarta";

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ_WIB,
});

// en-GB = "HH:mm" (jam 24 dengan titik dua), dipakai hanya untuk jam.
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TZ_WIB,
});

const numberFmt = new Intl.NumberFormat("id-ID");

type DateLike = Date | string | number;

/** Angka dengan pemisah ribuan Indonesia: 7354 → "7.354". */
export function formatNumber(n: number): string {
  return numberFmt.format(n);
}

/** Ukuran berkas dengan desimal koma: 3_900_000 → "3,7 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const s = u === 0 ? String(v) : v.toFixed(1).replace(".", ",");
  return `${s} ${units[u]}`;
}

/** Hitungan dengan kata satuan kecil: 48, "kali" → "48 kali". */
export function formatCount(n: number, unit: string): string {
  return `${formatNumber(n)} ${unit}`;
}

/** Tanggal pendek: → "16 Jun 2026". */
export function formatDate(d: DateLike): string {
  return dateFmt.format(new Date(d));
}

/** Jam WIB: → "20:15 WIB". */
export function formatTimeWIB(d: DateLike): string {
  return `${timeFmt.format(new Date(d))} WIB`;
}

/** Tanggal + jam WIB: → "25 Sep 2026 · 20:15 WIB". */
export function formatDateTimeWIB(d: DateLike): string {
  return `${formatDate(d)} · ${formatTimeWIB(d)}`;
}

/** Waktu relatif: "baru saja" / "5 mnt" / "2 jam", lalu mundur ke
    tanggal pendek "16 Sep 2026". */
export function formatRelative(d: DateLike, now: Date = new Date()): string {
  const diff = Math.floor((now.getTime() - new Date(d).getTime()) / 1000);
  if (diff < 60) return "baru saja";
  if (diff < 3600) return `${formatNumber(Math.floor(diff / 60))} mnt`;
  if (diff < 86400) return `${formatNumber(Math.floor(diff / 3600))} jam`;
  return formatDate(d);
}

/** Waktu kamera (EXIF): DITULIS APA ADANYA — string mentah dari metadata,
    tanpa konversi zona apa pun, ditambah keterangan "(waktu kamera)"
    agar pembaca tahu ini bukan WIB. Jangan pernah mengoper Date ke sini:
    Date sudah kehilangan jam-dinding kamera. */
export function formatExifCameraTime(raw: string): string {
  return `${raw} (waktu kamera)`;
}

/** Jam video "MM:SS" untuk chip waktu dan baris Tipe: 138 → "02:18".
    Menit boleh melebihi 59 ("75:00") — sama dengan kontrak scrubber
    Story 3.4 ("00:41 dari 02:18"). */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/* Rasio umum yang di-snap (toleransi 2 %). Selain ini hanya kata
   orientasi yang ditulis — angka rasio ganjil (1440:1081) tidak berguna. */
const COMMON_RATIOS: [number, number][] = [
  [1, 1], [16, 9], [9, 16], [4, 3], [3, 4], [3, 2], [2, 3], [4, 5], [5, 4], [21, 9],
];

export type AspectInfo = {
  orientation: "Potret" | "Lanskap" | "Persegi";
  /** "9:16" bila cocok dengan rasio umum, selain itu null. */
  ratio: string | null;
};

/** Orientasi + rasio umum dari lebar × tinggi SETELAH rotasi. */
export function describeAspect(width: number, height: number): AspectInfo | null {
  if (!(width > 0) || !(height > 0)) return null;
  const r = width / height;
  let ratio: string | null = null;
  let snapped = r;
  for (const [a, b] of COMMON_RATIOS) {
    if (Math.abs(r - a / b) / (a / b) < 0.02) {
      ratio = `${a}:${b}`;
      snapped = a / b;
      break;
    }
  }
  // Orientasi diturunkan dari rasio yang SUDAH di-snap supaya tidak pernah
  // muncul "Potret (1:1)": 1080×1100 → Persegi (1:1).
  const orientation = Math.abs(snapped - 1) < 0.01 ? "Persegi" : snapped < 1 ? "Potret" : "Lanskap";
  return { orientation, ratio };
}

/** Baris "Dimensi" panel info: 2160, 3840 → "2160 × 3840 px · Potret (9:16)".
    Piksel ditulis polos (tanpa titik ribuan) — ini ukuran gambar, bukan
    hitungan. */
export function formatDimensions(width: number, height: number): string {
  const info = describeAspect(width, height);
  const base = `${Math.round(width)} × ${Math.round(height)} px`;
  if (!info) return base;
  return info.ratio ? `${base} · ${info.orientation} (${info.ratio})` : `${base} · ${info.orientation}`;
}
