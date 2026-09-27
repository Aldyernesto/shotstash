// Story 1.11: manifest PWA — ikon 192/512 (Opsi C) + 512 maskable
// (glyph 60% untuk safe zone Android), tema ink. Berkas ikon statis
// di-commit (lihat scripts/generate-brand-assets.mjs).
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shotstash",
    short_name: "Shotstash",
    description: "Self-hosted media cloud for creators.",
    start_url: "/",
    display: "standalone",
    background_color: "#141310",
    theme_color: "#141310",
    icons: [{ src: "/brand/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
