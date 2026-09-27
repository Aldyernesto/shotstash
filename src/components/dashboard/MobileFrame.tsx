"use client";

// Story 2.3: kerangka HP (<900px) — app-header-mobile 48px, bottom-bar
// menempel penuh di bawah (64px + safe-area) dengan slot per role, dan
// more-sheet "Lainnya". Slot Upload membuka pemilih Section tujuan yang
// ada (projectRootPickerFiles via event 'mam:open-upload'); di luar
// Project, lewat daftar Project di sheet. Slot Cari (EDITOR) membuka
// /dashboard + memfokuskan search-pill ('mam:focus-search'). Sesi belum
// termuat → 4 slot kosong aria-hidden (AC 2.3). Sembunyikan ≥900 lewat CSS.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { gql, useQuery } from "@apollo/client";
import ThemeToggle from "@/components/ThemeToggle";
import NotificationBell from "@/components/NotificationBell";
import AccountMenu from "./AccountMenu";
import { navDestinations, isActiveDestination, type NavDestination } from "./navDestinations";
import Logo from "@/components/Logo";
import styles from "./dashboard-frame.module.css";
import * as perm from "@/lib/permissions";

const PROJECTS_MINI = gql`
  query ProjectsMiniForUploadSheet {
    projects { id title }
  }
`;

const FLAG_UPLOAD_AFTER_NAV = "shotstash_upload_after_nav";

type SheetMode = "nav" | "upload" | null;

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M12 16V4m0 0l-4 4m4-4l4 4" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

export default function MobileFrame({
  user,
  pathname,
  onOpenProfile,
  onOpenLogout,
}: {
  user: { name?: string | null; email?: string | null; avatarUrl?: string | null; role?: string | null } | null;
  pathname: string;
  onOpenProfile: () => void;
  onOpenLogout: () => void;
}) {
  const router = useRouter();
  const role = user?.role ?? null;
  // Story 2.18: gerbang role dari modul bersama — slot bottom-bar memakai
  // tabel yang SAMA dengan nav-capsule dan ruang kerja berkas.
  const isEditor = perm.isEditor(role);
  const canUpload = perm.canUpload(role);

  // Sheet "Lainnya" hanya dirender bila isinya ≥ 1 tujuan (AC 2.3):
  // tujuan yang sudah jadi slot tidak diulang di dalam sheet.
  const slotHrefs = new Set<string>(["/dashboard", "/dashboard/shared"]);
  const all = user ? navDestinations(role) : [];
  const sheetItems = all.filter((d) => !slotHrefs.has(d.href));

  const [sheet, setSheet] = useState<SheetMode>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const { data: projectsMini } = useQuery(PROJECTS_MINI, {
    skip: sheet !== "upload",
    fetchPolicy: "cache-and-network",
  });

  useEffect(() => {
    setSheet(null);
    setAccountOpen(false);
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

  // Focus trap sheet: buka → fokus ke tombol tutup; Tab berputar di dalam;
  // Esc menutup; fokus kembali ke slot pembuka (AC 2.3). Pemulih fokus =
  // document.activeElement saat dibuka (slot itu sendiri).
  useEffect(() => {
    if (sheet === null) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = sheetRef.current;
    node?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSheet(null); return; }
      if (e.key !== "Tab" || !node) return;
      const focusables = node.querySelectorAll<HTMLElement>(
        'button, a[href], input, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [sheet]);

  const handleUploadSlot = (e: React.MouseEvent<HTMLElement>) => {
    // Di dalam Project → pemilih Section tujuan yang ada (apa adanya).
    // Di /dashboard → sheet daftar Project dulu (AC 2.3, [ASSUMPTION] spine).
    const params = new URLSearchParams(window.location.search);
    if (params.get("p")) {
      window.dispatchEvent(new CustomEvent("mam:open-upload"));
    } else {
      setSheet("upload");
      void e;
    }
  };

  const pickProjectForUpload = (projectId: string) => {
    try { sessionStorage.setItem(FLAG_UPLOAD_AFTER_NAV, "1"); } catch {}
    setSheet(null);
    router.push(`/dashboard?p=${encodeURIComponent(projectId)}`);
  };

  const handleCariSlot = () => {
    if (pathname !== "/dashboard") router.push("/dashboard");
    window.dispatchEvent(new CustomEvent("mam:focus-search"));
  };

  const name = user?.name || user?.email?.split("@")[0] || "User";

  const pageSlot = (d: NavDestination) => {
    const active = isActiveDestination(d, pathname);
    return (
      <Link
        key={d.href}
        href={d.href}
        aria-current={active ? "page" : undefined}
        className={`spine-hit-area spine-focus-ring ${styles.slot} ${active ? styles.slotActive : ""}`}
      >
        <span className={styles.slotPill}>{d.icon}</span>
        <span className={`spine-chip ${styles.slotLabel}`}>{d.label}</span>
      </Link>
    );
  };

  const slots: React.ReactNode[] = [];
  // Urutan slot per AC 2.3: My Media · Shared · (Upload | Cari | Processing) · Profil · (Lainnya)
  if (user === null) {
    // Sesi belum termuat: kerangka slot netral berukuran tetap — bukan tebakan slot role.
    for (let i = 0; i < 4; i++) {
      slots.push(<div key={`ph${i}`} className={styles.slotPlaceholder} aria-hidden="true" />);
    }
  } else {
    const myMedia = all.find((d) => d.href === "/dashboard");
    const shared = all.find((d) => d.href === "/dashboard/shared");
    if (myMedia) slots.push(pageSlot(myMedia));
    if (shared) slots.push(pageSlot(shared));
    if (canUpload) {
      slots.push(
        <button
          type="button"
          key="upload"
          data-slot="upload"
          onClick={handleUploadSlot}
          className={`spine-hit-area spine-focus-ring ${styles.slot}`}
        >
          <span className={styles.slotPill}><UploadIcon /></span>
          <span className={`spine-chip ${styles.slotLabel}`}>Upload</span>
        </button>,
      );
    } else if (isEditor) {
      slots.push(
        <button
          type="button"
          key="cari"
          onClick={handleCariSlot}
          className={`spine-hit-area spine-focus-ring ${styles.slot}`}
        >
          <span className={styles.slotPill}><SearchIcon /></span>
          <span className={`spine-chip ${styles.slotLabel}`}>Cari</span>
        </button>,
      );
    }
    slots.push(
      <button
        type="button"
        key="profil"
        aria-haspopup="menu"
        aria-expanded={accountOpen}
        onClick={() => setAccountOpen((v) => !v)}
        className={`spine-hit-area spine-focus-ring ${styles.slot}`}
      >
        <span className={styles.slotPill}><ProfileIcon /></span>
        <span className={`spine-chip ${styles.slotLabel}`}>Profil</span>
      </button>,
    );
    if (sheetItems.length > 0) {
      slots.push(
        <button
          type="button"
          key="lainnya"
          onClick={() => setSheet("nav")}
          className={`spine-hit-area spine-focus-ring ${styles.slot}`}
        >
          <span className={styles.slotPill}><MoreIcon /></span>
          <span className={`spine-chip ${styles.slotLabel}`}>Lainnya</span>
        </button>,
      );
    }
  }

  return (
    <>
      <header className={styles.headerMobile}>
        <Link href="/dashboard" className={`spine-focus-ring ${styles.logoLink}`}>
            <Logo size="mobile" />
        </Link>
        <div className={styles.headerMobileRight}>
          <ThemeToggle />
          <NotificationBell large />
        </div>
      </header>

      <nav aria-label="Utama" className={styles.bottomBar}>
        {slots}
      </nav>

      {/* Menu akun dari slot Profil — kartu membuka ke atas. */}
      {accountOpen && user !== null && (
        <div className={styles.sheetAccountAnchor} ref={accountRef}>
          <AccountMenu
            name={name}
            email={user.email || ""}
            placement="top"
            onProfile={() => { setAccountOpen(false); onOpenProfile(); }}
            onLogout={() => { setAccountOpen(false); onOpenLogout(); }}
          />
        </div>
      )}

      {sheet !== null && (
        <div className={styles.sheetRoot}>
          <div className={styles.sheetBackdrop} onClick={() => setSheet(null)} aria-hidden="true" />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={sheet === "nav" ? "Lainnya" : "Pilih Project"}
            className={styles.sheet}
          >
            <div className={styles.sheetHandle} aria-hidden="true" />
            <div className={styles.sheetHead}>
              <h2 className={styles.sheetTitle}>{sheet === "nav" ? "Lainnya" : "Pilih Project"}</h2>
              <button
                type="button"
                data-sheet-close
                aria-label="Tutup"
                className={`spine-hit-area spine-focus-ring ${styles.sheetClose}`}
                onClick={() => setSheet(null)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            {sheet === "nav" ? (
              <div className={styles.sheetBody} role="menu">
                {sheetItems.map((d) => {
                  const active = isActiveDestination(d, pathname);
                  return (
                    <Link
                      key={d.href}
                      href={d.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setSheet(null)}
                      className={`spine-hit-area spine-focus-ring ${styles.sheetRow} ${active ? styles.sheetRowActive : ""}`}
                    >
                      {d.icon}
                      <span>{d.label}</span>
                      {d.goldDot && <span className={styles.goldDot} aria-hidden="true" />}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className={styles.sheetBody}>
                {(projectsMini?.projects as { id: string; title: string }[] | undefined)?.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickProjectForUpload(p.id)}
                    className={`spine-hit-area spine-focus-ring ${styles.sheetRow}`}
                  >
                    <UploadIcon />
                    <span>{p.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
