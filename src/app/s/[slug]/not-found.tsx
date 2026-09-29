/**
 * Story 4.5 / 4.6: `not-found.tsx` of the public route `/s/[slug]`.
 *
 * Every inactive link answers HTTP 404 through `notFound()` (unknown,
 * revoked, expired, target gone). Next gives this file no params, so the
 * slug comes from the request path the custom server records
 * (`x-shotstash-path`) and the link's state is resolved again here to show
 * the matching message. Nothing about the content leaks: no names,
 * thumbnails, counts or types, and no per-link metadata (`og:image` stays
 * the one generic template, Epic 1, FR37).
 */

import { headers } from "next/headers";
import ShareInvalid from "@/components/share/ShareInvalid";
import { resolveShare } from "@/lib/shareLink";
import { inactiveKindOf } from "./inactive";

async function inactiveKind() {
  const path = (await headers()).get("x-shotstash-path") ?? "";
  const m = /^\/s\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path);
  if (!m) return "not-found" as const;
  const res = await resolveShare(m[1], { limit: 0 }).catch(() => null);
  return (res && inactiveKindOf(res)) || ("not-found" as const);
}

export default async function ShareNotFound() {
  return <ShareInvalid kind={await inactiveKind()} />;
}
