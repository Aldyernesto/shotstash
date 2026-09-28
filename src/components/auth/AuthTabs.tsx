'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import styles from './AuthTabs.module.css';

// Story 1.21: auth-tabs — kapsul dua tab yang mengisi slot-tabs kartu auth.
// Kontrak aksesibilitas: role="tablist" + aria-selected pada tab aktif,
// panah kiri/kanan memindahkan tab (roving tabindex — hanya tab aktif yang
// bisa difokus). The active tab is not marked by color only: a filled accent
// pill plus weight 800 in both themes (see the css module).
export default function AuthTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  const t = useTranslations('authTabs');
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.key === value),
  );

  // Panah bergerak melingkar di dalam tablist lalu memindahkan fokus —
  // pola tabs ARIA (fokus dan aktivasi mengikuti satu tombol panah).
  const move = (dir: 1 | -1) => {
    const next = (activeIndex + dir + tabs.length) % tabs.length;
    onChange(tabs[next].key);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={t('label')} className={styles.tabs} data-tab={value}>
      {tabs.map((tab, i) => (
        <button
          key={tab.key}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          data-active={tab.key === value}
          aria-selected={tab.key === value}
          tabIndex={i === activeIndex ? 0 : -1}
          className={`spine-focus-ring spine-nav ${styles.tab} ${tab.key === value ? styles.tabActive : ''}`}
          onClick={() => onChange(tab.key)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              move(1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
