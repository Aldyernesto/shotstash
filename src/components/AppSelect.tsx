'use client';

/**
 * Story 3.32 — `select-field`.
 *
 * Dropdown kustom yang warnanya sepenuhnya dikontrol token tema, jadi
 * TIDAK pernah "teks gelap di atas gelap" seperti `<select>` native.
 *
 * Pola combobox + listbox dipertahankan dan dilengkapi sesuai AC 3.32:
 *   `aria-expanded`, `aria-controls`, `aria-activedescendant`,
 *   panah atas/bawah, Home/End, Enter memilih, Esc menutup, dan klik di
 *   luar menutup. Perilaku lama (klik luar / Escape menutup) tetap.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from './form/SelectField.module.css';

export type Opt = { value: string; label: string };

const CHEVRON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

export default function AppSelect({
  value,
  options,
  placeholder: placeholderProp,
  onChange,
  invalid = false,
  describedBy,
  labelledBy,
  buttonRef,
}: {
  value: string;
  options: Opt[];
  placeholder?: string;
  onChange: (v: string) => void;
  /** Story 3.32: menandai `aria-invalid` + bingkai danger. */
  invalid?: boolean;
  describedBy?: string;
  labelledBy?: string;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations('select');
  const placeholder = placeholderProp ?? t('placeholder');
  const uid = useId();
  const listId = `${uid}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const localBtn = useRef<HTMLButtonElement>(null);
  const btnRef = buttonRef ?? localBtn;

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (i: number) => {
    const opt = options[i];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return (next + options.length) % options.length;
      });
      return;
    }
    if (open && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      setActiveIndex(e.key === 'Home' ? 0 : options.length - 1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) setOpen(true);
      else pick(activeIndex);
    }
  };

  return (
    <div ref={ref} className={styles.wrap}>
      <button
        ref={btnRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${uid}-opt-${activeIndex}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-labelledby={labelledBy}
        className={`spine-focus-ring ${styles.control} ${open ? styles.controlOpen : ''} ${
          invalid ? styles.controlInvalid : ''
        }`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className={`${styles.value} ${selected ? '' : styles.placeholder}`}>
          {selected ? selected.label : placeholder}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          {CHEVRON}
        </span>
      </button>

      {open && (
        <ul className={styles.listbox} role="listbox" id={listId}>
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={isSelected}
                className={`${styles.option} ${isSelected ? styles.optionSelected : ''} ${
                  i === activeIndex ? styles.optionActive : ''
                }`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
              >
                <span>{o.label}</span>
                {isSelected ? (
                  <span className={styles.check} aria-hidden="true">
                    {CHECK}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
