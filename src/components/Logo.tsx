// Story 1.10: wordmark logo Shotstash.
// Sumber: public/brand/logo.svg (salinan apa adanya dari aset final,
// termasuk metadata C2PA-nya). Komponen ini MERENDER CROP-nya saja — jendela
// viewBox luar (401 396 1247 361, rasio 3,454) memotong kanvas asli 2048x1170
// tepat pada bagian wordmark, jadi path logo tidak diduplikasi di bundle.
// - Tema gelap: wordmark polos (detail ink hanya ada di dalam glyph
//   kuning, jadi render polos sudah tepat — lihat catatan di module CSS
//   kenapa mix-blend lighten sengaja tidak dipakai).
// - Tema terang: wordmark duduk di dalam logo-pill berlatar ink
//   (padding 8px 16px, radius penuh).
// Tidak bisa diklik (span, bukan link) — dipasang sebagai identitas, bukan navigasi.
import styles from './Logo.module.css';

export default function Logo({ size = 'app' }: { size?: 'app' | 'login' | 'mobile' }) {
  return (
    <span
      className={`${styles.logo} ${size === 'login' ? styles.login : size === 'mobile' ? styles.mobile : styles.app}`}
      role="img"
      aria-label="Shotstash"
    >
      <svg viewBox="401 396 1247 361" aria-hidden="true" focusable="false">
        {/* width/height = ukuran kanvas asli supaya peta viewBox → piksel 1:1
            (root SVG asli memakai preserveAspectRatio="none", jadi viewport
            harus persis 2048x1170 agar crop tidak terdistorsi). */}
        <image href="/brand/logo.svg" width={2048} height={1170} />
      </svg>
    </span>
  );
}
