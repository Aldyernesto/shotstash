import type { ReactNode } from "react";
import * as perm from "@/lib/permissions";

// Story 2.2/2.3: satu sumber tujuan navigasi per role — dipakai nav-capsule
// desktop (2.2) dan bottom-bar + more-sheet HP (2.3). Gerbangnya sendiri
// datang dari `src/lib/permissions.ts` sejak Story 2.18. Tujuan yang tidak
// boleh untuk role itu TIDAK PERNAH dirender (tanpa disabled/aria-disabled/
// redup) — AC 2.2.

export type NavDestination = {
  href: string;
  label: string;
  icon: ReactNode;
  /** Cocok persis (default: startsWith). */
  exact?: boolean;
  /** Titik emas 6px, aria-hidden, hanya penanda visual. */
  goldDot?: boolean;
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function navDestinations(user: perm.PermissionSubject): NavDestination[] {
  // Story 2.4: gates from `me.permissions`; the desktop nav-capsule and the
  // phone bottom-bar / more-sheet share this one table.
  const showAdminPanel = perm.canOpenAdminPanel(user);
  const showTrash = perm.canViewTrash(user);

  const list: (NavDestination | null)[] = [
    {
      href: "/dashboard",
      label: "My Media",
      exact: true,
      icon: (
        <Icon>
          <path d="M4 7h6l2 2h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
        </Icon>
      ),
    },
    {
      href: "/dashboard/shared",
      label: "Shared",
      icon: (
        <Icon>
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </Icon>
      ),
    },
    showTrash
      ? {
          href: "/dashboard/trash",
          label: "Trash",
          icon: (
            <Icon>
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </Icon>
          ),
        }
      : null,
    showAdminPanel
      ? {
          href: "/dashboard/admin",
          label: "Admin Panel",
          icon: (
            <Icon>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </Icon>
          ),
        }
      : null,
  ];

  return list.filter((d): d is NavDestination => d !== null);
}

/** Halaman aktif: /dashboard persis; tujuan lain startsWith (perilaku lama). */
export function isActiveDestination(dest: NavDestination, pathname: string): boolean {
  return dest.exact ? pathname === dest.href : pathname.startsWith(dest.href);
}
