/**
 * Story 4.5 — `not-found.tsx` rute publik `/s/[slug]`.
 *
 * Dirender saat `page.tsx` memanggil `notFound()` untuk slug yang tidak
 * ada — termasuk link yang baru dicabut, karena "Cabut Akses" MENGHAPUS
 * baris `shareLink` sehingga server memang tidak bisa membedakan keduanya.
 * Responsnya HTTP 404 (bukan 200 seperti Story 3.11), jadi pemeriksa
 * link, crawler, dan pemantauan tidak lagi menganggap link mati itu hidup.
 *
 * Tampilannya dipakai ULANG apa adanya dari Story 3.11 (`ShareInvalid`
 * kind "not-found": objek `project-empty` tanpa label, judul
 * `display-panel-mobile`, satu kalimat `muted`, tag diredupkan, topbar
 * logo 50 px + `theme-toggle`). Tidak ada query database, tidak ada nama
 * file/Section/Project, thumbnail, jumlah, atau mime yang bisa bocor, dan
 * TIDAK ada metadata per-link: `og:image` tetap satu template generik
 * dari `page.tsx` / layout (Epic 1, FR37).
 */

import ShareInvalid from "@/components/share/ShareInvalid";

export default function ShareNotFound() {
  return <ShareInvalid kind="not-found" />;
}
