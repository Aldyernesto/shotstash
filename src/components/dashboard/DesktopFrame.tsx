"use client";

// Story 2.2: app-bar desktop (≥900px) — logo 40px → /dashboard, nav-capsule
// berisi tujuan per role (navDestinations), kanan: ThemeToggle, notifikasi,
// avatar-pill dua baris + dropdown akun. Sesi belum termuat → placeholder
// netral berukuran tetap, aria-hidden, tanpa tujuan (AC 2.2). Sembunyikan
// <900 lewat CSS — pasangan MobileFrame (Story 2.3).
//
// Story 3.34 — "Lainnya" desktop: tujuan ekor yang tidak muat di kapsul
// dipindah ke SATU pemicu di ujung kapsul yang membuka `ActionMenu`
// (menu-popover). Lebar tiap item diukur dari rel pengukur tersembunyi
// (semua item + pemicu selalu ada di sana), jadi keputusannya tidak
// bergantung pada item yang sedang tampil. Item aktif tidak pernah
// dipindah selama masih ada ruang: yang dipindah lebih dulu adalah item
// ekor yang TIDAK aktif. Frame HP punya "Lainnya"-nya sendiri (more-sheet).

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import NotificationBell from "@/components/NotificationBell";
import AccountMenu from "./AccountMenu";
import ActionMenu, { type ActionMenuEntry } from "./ActionMenu";
import { navDestinations, isActiveDestination, type NavDestination } from "./navDestinations";
import Logo from "@/components/Logo";
import styles from "./dashboard-frame.module.css";
import { roleInitials, roleLabel } from "@/lib/permissions";

/* Ikon "Lainnya" = tiga titik — sama dengan slot "Lainnya" bottom-bar HP. */
const MORE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </svg>
);

const MORE_LABEL = "Lainnya";

/**
 * Menghitung href tujuan yang harus pindah ke "Lainnya".
 * `available` = lebar bersih yang boleh dipakai isi kapsul; `widths` lebar
 * tiap item (urutan = urutan tujuan); `moreWidth` lebar pemicu; `gap` jarak
 * antar item. Item aktif dipertahankan selama masih ada ruang.
 */
export function computeOverflow(
  destinations: readonly { href: string }[],
  widths: readonly number[],
  moreWidth: number,
  gap: number,
  available: number,
  activeHref: string | null,
): string[] {
  const n = destinations.length;
  const sum = (idx: number[]) => idx.reduce((acc, i) => acc + widths[i], 0);
  const all = destinations.map((_, i) => i);
  // Semua muat tanpa pemicu → tidak ada yang dipindah.
  if (sum(all) + gap * Math.max(0, n - 1) <= available + 0.5) return [];

  const visible = [...all];
  const fits = () => sum(visible) + moreWidth + gap * visible.length <= available + 0.5;
  while (visible.length && !fits()) {
    // Buang item EKOR yang tidak aktif lebih dulu; item aktif baru dibuang
    // bila tinggal dia sendiri dan tetap tidak muat.
    let drop = -1;
    for (let k = visible.length - 1; k >= 0; k--) {
      if (destinations[visible[k]].href !== activeHref) {
        drop = k;
        break;
      }
    }
    if (drop < 0) drop = visible.length - 1;
    visible.splice(drop, 1);
  }
  const keep = new Set(visible);
  return all.filter((i) => !keep.has(i)).map((i) => destinations[i].href);
}

function useCapsuleOverflow(
  wrapRef: RefObject<HTMLElement | null>,
  railRef: RefObject<HTMLUListElement | null>,
  destinations: NavDestination[],
  activeHref: string | null,
  onChange: () => void,
) {
  const [hidden, setHidden] = useState<string[]>([]);
  const hiddenKey = useRef("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const destKey = destinations.map((d) => d.href).join("|");

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const rail = railRef.current;
    if (!wrap || !rail) return;
    const items = Array.from(rail.children) as HTMLElement[];
    if (items.length < 2) return;
    const more = items[items.length - 1];
    const widths = items.slice(0, -1).map((li) => li.getBoundingClientRect().width);
    const moreWidth = more.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    // Bingkai kapsul (padding + border) = lebar rel − isi rel; jadi tidak ada
    // angka ajaib yang harus ikut berubah bila CSS kapsulnya diubah.
    const railWidth = rail.getBoundingClientRect().width;
    const railContent = widths.reduce((a, b) => a + b, 0) + moreWidth + gap * widths.length;
    const chrome = Math.max(0, railWidth - railContent);
    const available = wrap.clientWidth - chrome;
    const next = computeOverflow(destinations, widths, moreWidth, gap, available, activeHref);
    const key = next.join("|");
    if (key !== hiddenKey.current) {
      hiddenKey.current = key;
      setHidden(next);
      onChangeRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destKey, activeHref]);

  // Sebelum cat pertama supaya kapsul tidak pernah terlihat terpotong.
  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const rail = railRef.current;
    if (!wrap || !rail || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap); // lebar yang tersedia (jendela, teks avatar-pill hilang <1440)
    ro.observe(rail); // lebar item (font termuat, item aktif berganti berat)
    return () => ro.disconnect();
  }, [measure, wrapRef, railRef]);

  return hidden;
}

export default function DesktopFrame({
  user,
  pathname,
  onOpenProfile,
  onOpenLogout,
}: {
  user: { name?: string | null; email?: string | null; avatarUrl?: string | null; role?: string | null; permissions?: readonly string[] | null } | null;
  pathname: string;
  onOpenProfile: () => void;
  onOpenLogout: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const destinations = navDestinations(user);
  const activeHref = destinations.find((d) => isActiveDestination(d, pathname))?.href ?? null;

  const wrapRef = useRef<HTMLElement>(null);
  const railRef = useRef<HTMLUListElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState({ x: 0, y: 0 });
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const hiddenHrefs = useCapsuleOverflow(wrapRef, railRef, destinations, activeHref, closeMore);
  const hiddenSet = new Set(hiddenHrefs);
  const visible = destinations.filter((d) => !hiddenSet.has(d.href));
  const overflow = destinations.filter((d) => hiddenSet.has(d.href));
  const overflowActive = overflow.some((d) => isActiveDestination(d, pathname));

  useEffect(() => {
    setAccountOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [accountOpen]);

  // Popover diposisikan sekali saat dibuka; jendela berubah → tutup saja
  // (termasuk turun <900px, supaya ActionMenu tidak berubah jadi sheet HP).
  useEffect(() => {
    if (!moreOpen) return;
    const onResize = () => setMoreOpen(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [moreOpen]);

  /* ActionMenu menutup diri pada mousedown DI LUAR dirinya — termasuk
     mousedown di pemicu ini. Tanpa penjaga, klik pemicu saat menu terbuka
     akan menutup (mousedown) lalu membuka lagi (click). */
  const suppressClickRef = useRef(false);
  const onMoreMouseDown = () => {
    if (moreOpen) suppressClickRef.current = true;
  };
  const onMoreClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (moreOpen) {
      setMoreOpen(false);
      return;
    }
    const rect = moreBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMoreAnchor({ x: rect.left, y: rect.bottom + 12 });
    setMoreOpen(true);
  };

  const moreEntries: ActionMenuEntry[] = overflow.map((d) => ({
    kind: "item",
    id: d.href,
    label: d.label,
    icon: d.icon,
    href: d.href,
    current: isActiveDestination(d, pathname),
    trailing: d.goldDot ? <span className={styles.goldDot} aria-hidden="true" /> : undefined,
  }));

  const name = user?.name || user?.email?.split("@")[0] || "User";

  const itemClass = (active: boolean) =>
    `spine-nav spine-focus-ring ${active ? `spine-nav-active ${styles.capsuleOn}` : styles.capsuleLink}`;

  return (
    <header className={styles.appbar}>
      {/* Logo 40px — role="img" + aria-label sesuai AC 2.2; menggantikan teks shotstash. */}
      <Link href="/dashboard" className={`spine-focus-ring ${styles.logoLink}`}>
        <Logo size="app" />
      </Link>

      {user === null ? (
        // Sesi belum termuat: placeholder netral berukuran tetap — bukan daftar
        // tujuan role mana pun (AC 2.2); tidak fokusabel, tak bergeser saat diganti.
        <div className={styles.capsulePlaceholder} aria-hidden="true" />
      ) : (
        <nav aria-label="Utama" className={styles.capsuleWrap} ref={wrapRef}>
          <ul className={styles.capsule}>
            {visible.map((d) => {
              const active = isActiveDestination(d, pathname);
              return (
                <li key={d.href}>
                  <Link
                    href={d.href}
                    aria-current={active ? "page" : undefined}
                    data-active={active}
                    className={itemClass(active)}
                  >
                    {d.icon}
                    <span>{d.label}</span>
                    {d.goldDot && <span className={styles.goldDot} aria-hidden="true" />}
                  </Link>
                </li>
              );
            })}
            {overflow.length > 0 && (
              <li>
                {/* Pemicu "Lainnya": rupa item kapsul + ikon tiga titik slot HP.
                    Aktif (kuning/ink) bila halaman sekarang ada di dalamnya. */}
                <button
                  type="button"
                  ref={moreBtnRef}
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  data-active={overflowActive}
                  className={`${itemClass(overflowActive)} ${styles.capsuleMore}`}
                  onMouseDown={onMoreMouseDown}
                  onClick={onMoreClick}
                >
                  {MORE_ICON}
                  <span>{MORE_LABEL}</span>
                </button>
              </li>
            )}
          </ul>

          {/* Rel pengukur: semua tujuan + pemicu, visibility:hidden (tidak
              dicat, tidak fokusabel, di luar pohon aksesibilitas). Pemicu
              diukur dalam berat aktif (lebih lebar) supaya taksirannya aman. */}
          <ul className={`${styles.capsule} ${styles.capsuleMeasure}`} aria-hidden="true" ref={railRef}>
            {destinations.map((d) => {
              const active = isActiveDestination(d, pathname);
              return (
                <li key={d.href}>
                  <span className={itemClass(active)}>
                    {d.icon}
                    <span>{d.label}</span>
                    {d.goldDot && <span className={styles.goldDot} />}
                  </span>
                </li>
              );
            })}
            <li>
              <span className={`${itemClass(true)} ${styles.capsuleMore}`}>
                {MORE_ICON}
                <span>{MORE_LABEL}</span>
              </span>
            </li>
          </ul>

          {moreOpen && overflow.length > 0 && (
            <ActionMenu
              anchor={moreAnchor}
              target={{ kindLabel: "Navigasi", name: MORE_LABEL }}
              entries={moreEntries}
              onClose={closeMore}
            />
          )}
        </nav>
      )}

      <div className={styles.right}>
        <ThemeToggle />
        <NotificationBell />
        {user !== null && (
          <div className={styles.accountWrap} ref={accountRef}>
            <button
              type="button"
              className={`spine-focus-ring ${styles.avp}`}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((v) => !v)}
            >
              <span className={styles.avpAvatar}>
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatarUrl} alt="" />
                ) : (
                  /* Story 2.18: kata & inisial role juga datang dari modul
                     bersama, jadi berkas layar tidak lagi membandingkan role. */
                  roleInitials(user)
                )}
              </span>
              <span className={styles.avpText}>
                {name}
                <small>{roleLabel(user)}</small>
              </span>
            </button>
            {accountOpen && (
              <AccountMenu
                name={name}
                email={user.email || ""}
                onProfile={() => { setAccountOpen(false); onOpenProfile(); }}
                onLogout={() => { setAccountOpen(false); onOpenLogout(); }}
              />
            )}
          </div>
        )}
      </div>
    </header>
  );
}
