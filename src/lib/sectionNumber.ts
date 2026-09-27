// Story 2.10 — nomor Section diambil dari awalan nama, lalu awalan itu
// dibuang dari judul yang ditampilkan.
//
// Spine (EXPERIENCE.md, ditandai [ASSUMPTION]) menulis awalannya sebagai
// "N. ". Data produksi memakai DUA bentuk: "11. Musium Khairul Kholq"
// (nomor utama, titik lalu spasi) DAN "11.2 Diorama Sejarah Madinah"
// (sub-Section bernomor bertitik, TANPA titik penutup). Parser di bawah
// menerima keduanya — `N`, `N.`, `N.M`, `N.M.` — lalu satu spasi.
// Nama tanpa awalan angka tidak mendapat stiker nomor sama sekali.

export type SectionName = {
  /** "11" / "11.2", atau null bila nama tidak berawalan nomor. */
  number: string | null;
  /** Judul tanpa awalan nomor; sama dengan nama asli bila tidak ada nomor. */
  title: string;
};

const PREFIX = /^(\d+(?:\.\d+)*)\.?[\s ]+(\S.*)$/;

export function parseSectionName(name: string): SectionName {
  const raw = (name ?? "").trim();
  const m = PREFIX.exec(raw);
  if (!m) return { number: null, title: raw };
  return { number: m[1], title: m[2].trim() };
}
