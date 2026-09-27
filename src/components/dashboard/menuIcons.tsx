"use client";

/**
 * Story 3.3 — ikon GARIS 18 px (22 px di sheet HP) untuk `context-menu`,
 * menggantikan ikon emoji 👁 ⚡ ⬇ 🔗 📦 📋 🗑 di `ContextMenu.tsx` lama.
 * Semua memakai `stroke="currentColor"` supaya varian merusak (danger)
 * dan varian aman (perisai emas) cukup mengganti `color`.
 */

import React from "react";

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const MenuIcon = {
  open: (
    <svg {...base}>
      <path d="M3 8.5V6a1.5 1.5 0 0 1 1.5-1.5h4L11 7h8A1.5 1.5 0 0 1 20.5 8.5v1" />
      <path d="M3 8.5h18.2L19 19.5H4.4L3 8.5z" />
    </svg>
  ),
  preview: (
    <svg {...base}>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3.1" />
    </svg>
  ),
  share: (
    <svg {...base}>
      <circle cx="18" cy="5.5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="18.5" r="2.6" />
      <path d="M8.4 13.3l7.2 4.2M15.6 6.8L8.4 10.9" />
    </svg>
  ),
  rename: (
    <svg {...base}>
      <path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0-3-3L5.2 17 4 20z" />
      <path d="M14.5 7.7l2.8 2.8" />
    </svg>
  ),
  download: (
    <svg {...base}>
      <path d="M12 4v11M7.2 10.4L12 15.2l4.8-4.8M4.5 20h15" />
    </svg>
  ),
  fast: (
    <svg {...base}>
      <path d="M13.2 3L5.5 13.4h5L10.8 21l7.7-10.4h-5L13.2 3z" />
    </svg>
  ),
  move: (
    <svg {...base}>
      <path d="M3.5 7.6L12 4l8.5 3.6v8.8L12 20l-8.5-3.6V7.6z" />
      <path d="M3.5 7.6L12 11.2l8.5-3.6M12 11.2V20" />
    </svg>
  ),
  copy: (
    <svg {...base}>
      <rect x="9" y="9" width="11.2" height="11.2" rx="2.4" />
      <path d="M6 15h-.6A1.6 1.6 0 0 1 3.8 13.4V5.4A1.6 1.6 0 0 1 5.4 3.8h8A1.6 1.6 0 0 1 15 5.4V6" />
    </svg>
  ),
  trash: (
    <svg {...base}>
      <path d="M4.5 6.6h15M9.4 6.6V4.8A1.3 1.3 0 0 1 10.7 3.5h2.6a1.3 1.3 0 0 1 1.3 1.3v1.8" />
      <path d="M6.4 6.6L7.3 20a1 1 0 0 0 1 .9h7.4a1 1 0 0 0 1-.9l.9-13.4" />
      <path d="M10.4 10.3v6.8M13.6 10.3v6.8" />
    </svg>
  ),
  /** Perisai "Versi aman (blur)" — emas di tema gelap, emas gelap di terang. */
  shield: (
    <svg {...base}>
      <path d="M12 3.2l7 2.6v5.4c0 4.3-2.9 8.1-7 9.6-4.1-1.5-7-5.3-7-9.6V5.8l7-2.6z" />
      <path d="M9 12.1l2.2 2.2 4-4.3" />
    </svg>
  ),
} as const;

export type MenuIconName = keyof typeof MenuIcon;
