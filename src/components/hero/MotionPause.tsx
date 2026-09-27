'use client';

// Story 1.19: motion-pause — tombol bulat untuk menjeda gerak ambien
// panggung (tile/pita/tumpukan) DI TEMPAT. Label TETAP "Jeda animasi";
// status lewat aria-pressed + ikon yang berganti (pause/play). Pilihan
// tersimpan di localStorage kunci 'shotstash_motion_paused' ("1"/"0" — nama
// kunci tidak pernah ditetapkan DESIGN.md; keputusan story ini) dan
// dikelola HeroStage; komponen ini hanya menampilkan tombolnya.
// Mode kalem (data-motion="calm", termasuk perubahan prefers-reduced-
// motion saat halaman terbuka) = tombol tidak dirender.
import { useEffect, useState } from 'react';
import styles from './hero.module.css';

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <rect x="6" y="4" width="4.5" height="16" rx="1.5" />
      <rect x="13.5" y="4" width="4.5" height="16" rx="1.5" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10.03-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6z" />
    </svg>
  );
}

export default function MotionPause({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  // Pra-hidrasi & SSR: dianggap kalem → tidak dirender (jujur daripada
  // muncul-hilang; konsisten dengan pola ThemeToggle Story 1.12).
  const [calm, setCalm] = useState(true);

  useEffect(() => {
    const html = document.documentElement;
    const read = () => setCalm(html.getAttribute('data-motion') === 'calm');
    read();
    const obs = new MutationObserver(read);
    obs.observe(html, { attributes: true, attributeFilter: ['data-motion'] });
    return () => obs.disconnect();
  }, []);

  if (calm) return null;

  return (
    <button
      type="button"
      className={`spine-hit-area spine-focus-ring ${styles.pauseBtn}`}
      aria-pressed={paused}
      aria-label="Jeda animasi"
      title="Jeda animasi"
      onClick={onToggle}
    >
      {paused ? <PlayIcon /> : <PauseIcon />}
    </button>
  );
}
