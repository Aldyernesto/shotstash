'use client';

// Stories 1.16-1.19: panggung hero kolase di kolom kiri login (/)
// accent glow, hero-copy (h1 tunggal + stiker + tag-pill), hero-tile
// desktop, photo-band (drift 1 putaran lalu berhenti), hero-stack-mobile,
// fade tepi, dan tombol motion-pause.
//
// GERBANG FOTO: yang dirender HANYA foto lolos dari src/lib/hero-photos.ts
// (putusan di public/hero/REVIEW.md). Daftar mulai kosong — panggung tetap
// utuh tanpa foto (grup tile/pita/tumpukan absen, bukan kotak kosong).
// Semua grup dekoratif aria-hidden; tidak ada elemen panggung yang bisa
// diklik kecuali tombol jeda.
//
// Gerak berhenti (Story 1.19): pita berhenti sendiri setelah 1 putaran
// (animationend), fokus ke field menghentikan untuk sisa kunjungan, dan
// pilihan jeda pengguna tersimpan di localStorage 'shotstash_motion_paused' —
// auto-stop dan fokus-field TIDAK mengubah pilihan tersimpan.
// Pembekuan memakai animation-play-state PADA BINGKAI SAAT INI (bukan
// mengganti transform) — fokus di tengah drift tidak menyentakkan pita;
// jalur animationend mulus karena token tanpa fill kembali ke 0% yang
// identik dengan -50% (konten diduplikasi).
import { Fragment, useCallback, useEffect, useState, type CSSProperties } from 'react';
import MotionPause from './MotionPause';
import TagPill from '../tag-pill/TagPill'; // Story 1.20: pill diekstrak jadi komponen bersama
import { approvedHeroPhotosForSlot } from '@/lib/hero-photos';
import styles from './hero.module.css';

// Kemiringan/offset kartu pita — urutan persis mock (siklus bila foto < 8).
const BAND_CARD_VARS = [
  { r: '-5deg', y: '6px' },
  { r: '6deg', y: '-10px' },
  { r: '-3deg', y: '12px' },
  { r: '7deg', y: '-4px' },
  { r: '-6deg', y: '8px' },
  { r: '4deg', y: '-12px' },
  { r: '-4deg', y: '4px' },
  { r: '6deg', y: '-8px' },
];

// 3 kartu tumpuk HP: kiri/kanan/tengah (posisi, kemiringan, delay wobble).
const STACK_CARD_VARS = [
  { x: '-70px', r: '-14deg', dl: '0s' },
  { x: '70px', r: '14deg', dl: '-2s' },
  { x: '0px', r: '-2deg', dl: '-4s' },
];

const TILE_SLOT_CLASS = [
  styles.tileNearL,
  styles.tileNearR,
  styles.tileFarL,
  styles.tileFarR,
];

export default function HeroStage() {
  const tiles = approvedHeroPhotosForSlot('tile');
  const band = approvedHeroPhotosForSlot('band');
  const stack = approvedHeroPhotosForSlot('mobile');

  // stopped: auto (1 putaran pita) atau fokus field — sisa kunjungan.
  const [ambient, setAmbient] = useState<'run' | 'stopped'>('run');
  // paused: pilihan pengguna (Story 1.19), tersimpan lintas kunjungan.
  const [paused, setPaused] = useState(false);

  // Baca pilihan tersimpan pasca-hidrasi (SSR: tidak jeda — pola ThemeToggle).
  useEffect(() => {
    try {
      setPaused(localStorage.getItem('shotstash_motion_paused') === '1');
    } catch {}
  }, []);

  const togglePaused = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('shotstash_motion_paused', next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  // Fokus field (di mana pun di halaman) menghentikan gerak ambien untuk
  // sisa kunjungan — input user tidak boleh bersaing dengan gerak latar.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) setAmbient('stopped');
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  // Pita drift 40s linear 1 → animationend = 1 putaran penuh. Token tanpa
  // fill mengembalikan track ke translateX(0) = bingkai awal loop (konten
  // diduplikasi → identik dengan -50%) — lalu CSS membekukan play-state.
  const onTrackAnimationEnd = useCallback(() => setAmbient('stopped'), []);

  return (
    // data-ambient/data-paused di stageWrap: tumpukan HP hidup DI LUAR
    // .stage (menjorok di bawah tepi panggung), jadi selektor beku harus
    // menjangkau dari pembungkus.
    <div className={styles.stageWrap} data-ambient={ambient} data-paused={paused || undefined}>
      <div className={styles.stage}>
        {/* Pertama dalam DOM = fokus pertama di panggung. */}
        <MotionPause paused={paused} onToggle={togglePaused} />

        {tiles.length > 0 && (
          <div className={styles.tiles} aria-hidden="true">
            {tiles.slice(0, 4).map((p, i) => (
              <i
                key={p.file}
                className={`${styles.tile} ${TILE_SLOT_CLASS[i]} ${i >= 2 ? styles.tileFar : ''}`}
                style={{ backgroundImage: `url(${p.file})` }}
              />
            ))}
          </div>
        )}

        <div className={styles.copy}>
          <TagPill>Arsip premium</TagPill>
          <h1 className={`spine-display-hero ${styles.headline}`}>
            Your footage
            <br />
            <span className={styles.sticker}>your hardware</span>
            <br />
            your cloud
          </h1>
          <p className={`spine-body-lead ${styles.lead}`}>
            Semua klip dan foto proyekmu di perangkat sendiri: rapi, cepat dicari,
            siap dibagikan ke tim dan klien.
          </p>
        </div>

        {band.length > 0 && (
          <div className={styles.band} aria-hidden="true">
            <div className={styles.track} onAnimationEnd={onTrackAnimationEnd}>
              {/* Empat salinan: loop tetap di -50% (= dua salinan), tetapi satu
                  paruh kini selalu lebih lebar dari panggung terlebar, sehingga
                  ujung pita tidak pernah terlihat. Dua salinan cukup di panggung
                  820px versi mock, tidak cukup setelah panggung mengisi layar. */}
              {[0, 1, 2, 3].map((copy) => (
                <Fragment key={copy}>
                  {band.map((p, i) => {
                    const v = BAND_CARD_VARS[i % BAND_CARD_VARS.length];
                    return (
                      <i
                        key={p.file}
                        className={styles.bandCard}
                        style={{ backgroundImage: `url(${p.file})`, '--r': v.r, '--y': v.y } as CSSProperties}
                      />
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        )}

        <div className={styles.fade} aria-hidden="true" />
      </div>

      {/* Tumpukan HP DI LUAR .stage: mock menjorok 54px di bawah tepi
          panggung — overflow:hidden panggung tidak boleh memotongnya. */}
      {stack.length > 0 && (
        <div className={styles.stack} aria-hidden="true">
          {stack.slice(0, 3).map((p, i) => {
            const v = STACK_CARD_VARS[i];
            return (
              <i
                key={p.file}
                className={styles.stackCard}
                style={{ backgroundImage: `url(${p.file})`, '--x': v.x, '--r': v.r, '--dl': v.dl } as CSSProperties}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
