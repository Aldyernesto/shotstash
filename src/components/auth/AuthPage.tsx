'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import AuthTopbar from './AuthTopbar';
import styles from './auth.module.css';

// Story 1.20: shell halaman auth. Dua varian:
// - 'split'    : topbar di alur + panggung kiri + kartu kanan (halaman /).
// - 'centered' : topbar melayang di atas, kartu mulai 112px dari atas —
//                layar auth tanpa panggung (mis. /forgot-password).
// Latar = token bg; authThemeScope (globals.css) tetap di <main> kedua
// shell sebagai pasangan penemuan lokal tema terang.
// AC 1.20: di HP, tombol utama tetap terlihat saat field difokus —
// guard visualViewport menggulirkan CTA ke bidang terlihat setelah
// keyboard naik (elemen <form> pertama bertipe submit di shell ini).
export default function AuthPage({
  variant = 'centered',
  stage,
  children,
}: {
  variant?: 'split' | 'centered';
  /** Panggung hero — hanya dipakai varian 'split' (hanya halaman /). */
  stage?: ReactNode;
  children: ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;

    const ensureCtaVisible = () => {
      const cta = root.querySelector<HTMLElement>('form button[type="submit"]');
      if (!cta) return;
      const vv = window.visualViewport;
      // Dasar bidang terlihat dalam koordinat layout viewport — saat
      // keyboard naik, visualViewport menyusut dan offsetTop ikut pan.
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const rect = cta.getBoundingClientRect();
      if (rect.bottom > visibleBottom + 1) {
        cta.scrollIntoView({ block: 'nearest' });
      }
    };

    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        // Setelah animasi keyboard OS selesai — posisi CTA baru berubah.
        later(ensureCtaVisible, 350);
      }
    };
    const onViewportResize = () => later(ensureCtaVisible, 100);

    document.addEventListener('focusin', onFocusIn);
    window.visualViewport?.addEventListener('resize', onViewportResize);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      window.visualViewport?.removeEventListener('resize', onViewportResize);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  return (
    <main
      ref={mainRef}
      className={`authThemeScope ${styles.main} ${variant === 'split' ? styles.split : styles.centered}`}
    >
      <AuthTopbar />
      {variant === 'split' ? (
        <div className={styles.splitBody}>
          {stage != null && <div className={styles.stageCol}>{stage}</div>}
          <div className={styles.cardCol}>{children}</div>
        </div>
      ) : (
        <div className={styles.centeredBody}>{children}</div>
      )}
    </main>
  );
}
