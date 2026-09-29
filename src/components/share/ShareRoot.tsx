"use client";

/**
 * Stories 3.9 / 3.11 — akar klien halaman `/s/[slug]`.
 *
 * Server sudah memutuskan keadaannya (lihat `src/lib/shareLink.ts`).
 * Komponen ini hanya memilih wujudnya dan, khusus link PRIVATE, menerima
 * payload setelah kode akses terbukti benar (Story 2.3).
 */

import React, { useCallback, useState } from "react";
import type { ShareResolution, SharePayload } from "@/lib/shareTypes";
import SharePage from "./SharePage";
import ShareInvalid, { type ShareInvalidKind } from "./ShareInvalid";

function kindOf(res: Exclude<ShareResolution, { state: "ok" }>): ShareInvalidKind {
  if (res.state === "expired") return "expired";
  if (res.state === "revoked") return "revoked";
  if (res.state === "private") return "private";
  if (res.state === "not-found") return "not-found";
  return res.target === "project"
    ? "project-gone"
    : res.target === "file"
      ? "file-gone"
      : "section-gone";
}

export default function ShareRoot({
  resolution,
  slug,
  sectionId,
}: {
  resolution: ShareResolution;
  slug: string;
  sectionId: string | null;
}) {
  const [unlocked, setUnlocked] = useState<SharePayload | null>(
    resolution.state === "ok" ? resolution.payload : null,
  );
  const onUnlocked = useCallback((p: SharePayload) => setUnlocked(p), []);

  if (unlocked) return <SharePage payload={unlocked} />;

  return (
    <ShareInvalid
      kind={kindOf(resolution as Exclude<ShareResolution, { state: "ok" }>)}
      slug={slug}
      sectionId={sectionId}
      onUnlocked={onUnlocked}
    />
  );
}
