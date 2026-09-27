import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  // Next 16 memblokir 127.0.0.1 sebagai host dev lintas-origin: halaman
  // berhenti di "Loading…" tanpa pesan apa pun karena hidrasi tidak pernah
  // selesai. Izinkan keduanya supaya localhost dan 127.0.0.1 sama-sama jalan.
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // Akar proyek ditetapkan eksplisit (dokumen Next: turbopack.md → "Root
  // directory"): bila ada package-lock.json lain di folder induk (mis. di
  // home user), Next 16 menebak akar yang salah dan SEMUA rute — termasuk
  // /api — menjawab 404, baik di dev maupun build. Dijangkarkan ke folder
  // berkas konfigurasi ini, bukan cwd, supaya tidak bergantung dari mana
  // next dijalankan; cwd hanya cadangan bila __dirname tidak ada.
  turbopack: { root: typeof __dirname !== "undefined" ? __dirname : process.cwd() },
};

export default nextConfig;
