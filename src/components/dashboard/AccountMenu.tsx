"use client";

// Kartu dropdown akun — dipakai avatar-pill desktop (Story 2.2) dan slot
// "Profil" bottom-bar HP (Story 2.3). Pemicu (trigger) milik frame; kartu
// ini hanya isi menu (paritas dengan dropdown lama layout.tsx).

import styles from "./AccountMenu.module.css";

export default function AccountMenu({
  name,
  email,
  onProfile,
  onLogout,
  placement = "bottom",
}: {
  name: string;
  email: string;
  onProfile: () => void;
  onLogout: () => void;
  /** 'top' = kartu membuka KE ATAS (slot Profil bottom-bar, Story 2.3). */
  placement?: "bottom" | "top";
}) {
  return (
    <div className={`${styles.card} ${placement === "top" ? styles.cardTop : ""}`} role="menu">
      <div className={styles.header}>
        <div className={styles.name}>{name || "User"}</div>
        <div className={styles.email}>{email}</div>
      </div>
      <button type="button" className={styles.item} role="menuitem" onClick={onProfile}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Profile Settings
      </button>
      <div className={styles.divider} />
      <button type="button" className={`${styles.item} ${styles.danger}`} role="menuitem" onClick={onLogout}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        Logout
      </button>
    </div>
  );
}
