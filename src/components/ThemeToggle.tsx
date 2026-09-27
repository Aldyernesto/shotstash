'use client';

import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.css';

// Story 1.12: theme-toggle kapsul — dua item ikon (matahari = terang,
// bulan = gelap) dalam kapsul surface + border line, radius penuh.
// Item aktif kuning dengan ikon ink (di tema terang ditambah garis tepi
// ink 1,5px supaya tidak menyatu dengan latar putih); item diam muted.
// Setiap item: role="switch" + aria-checked + label tetap
// "Aktifkan mode terang/gelap" (label tidak berubah saat aktif).
// Menyimpan ke localStorage 'shotstash_theme' (try/catch — tanpa localStorage
// tetap berfungsi untuk sesi ini). spine-hit-area + spine-focus-ring
// dari Story 1.7. API tanpa props — kelima titik pemasangan tidak berubah.
function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const cur = (document.documentElement.getAttribute('data-theme') as 'light' | 'dark') || 'dark';
    setTheme(cur);
  }, []);

  const set = (next: 'light' | 'dark') => {
    if (next === theme) return;
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('shotstash_theme', next); } catch {}
  };

  // Pra-hidrasi kedua item dianggap diam (tidak ada kilat status aktif salah).
  const active = (t: 'light' | 'dark') => mounted && theme === t;

  return (
    <div className={styles.capsule} role="group" aria-label="Mode tema">
      <button
        type="button"
        role="switch"
        aria-checked={active('light')}
        aria-label="Aktifkan mode terang"
        title="Mode terang"
        onClick={() => set('light')}
        data-active={active('light')}
        className={`spine-hit-area spine-focus-ring ${styles.item}`}
      >
        <SunIcon />
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={active('dark')}
        aria-label="Aktifkan mode gelap"
        title="Mode gelap"
        onClick={() => set('dark')}
        data-active={active('dark')}
        className={`spine-hit-area spine-focus-ring ${styles.item}`}
      >
        <MoonIcon />
      </button>
    </div>
  );
}
