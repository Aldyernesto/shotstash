/**
 * Story 4.6: the 404 message of an inactive share link (unknown, revoked,
 * expired, target gone). Shared by `page.tsx` (which answers 404) and
 * `not-found.tsx` (which shows the message).
 */
import type { ShareResolution } from "@/lib/shareTypes";
import type { ShareInvalidKind } from "@/components/share/ShareInvalid";

/** The 404 message for an inactive resolution, or null when the page renders (ok, private). */
export function inactiveKindOf(res: ShareResolution): ShareInvalidKind | null {
  switch (res.state) {
    case "not-found":
      return "not-found";
    case "revoked":
      return "revoked";
    case "expired":
      return "expired";
    case "gone":
      return res.target === "project"
        ? "project-gone"
        : res.target === "file"
          ? "file-gone"
          : res.target === "section"
            ? "section-gone"
            : "gone";
    default:
      return null;
  }
}
