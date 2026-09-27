import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { brand } from "@/lib/brand";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Story 1.3: Poppins Black di-host sendiri (keputusan OQ-D12) — hanya dua
// berkas (900 normal + 900 italic, subset Latin), font-display: swap,
// tanpa permintaan font pihak ketiga. adjustFontFallback: 'Arial'
// menghasilkan @font-face cadangan ber-metrik (size-adjust, ascent-override,
// descent-override) sehingga pergantian fallback ke Poppins tidak
// menggeser layout (CLS).
const poppins = localFont({
  src: [
    { path: "../../public/fonts/poppins-black-900.woff2", weight: "900", style: "normal" },
    { path: "../../public/fonts/poppins-black-900-italic.woff2", weight: "900", style: "italic" },
  ],
  display: "swap",
  variable: "--font-poppins",
  adjustFontFallback: "Arial",
  fallback: ["Arial Black", "Segoe UI Black", "Helvetica Neue", "Arial", "sans-serif"],
});

import { ApolloWrapper } from "@/components/ApolloWrapper";
import { AuthProvider } from "@/components/AuthContext";

export const metadata: Metadata = {
  title: brand.productName,
  description: brand.tagline,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: brand.themeColor,
};

// Anti-FOUC: set data-theme SEBELUM paint pertama supaya tidak berkedip.
// Default 'dark' kalau belum ada preferensi tersimpan.
// Story 1.8: skrip yang sama juga menyetel data-motion SEBELUM paint
// pertama — 'calm' bila prefers-reduced-motion ATAU Save-Data ATAU
// navigator.deviceMemory ≤ 2, selain itu 'full'. Gerak tidak pernah
// sempat berjalan satu frame pun. Perubahan prefers-reduced-motion
// saat halaman terbuka langsung mengubah atribut (tanpa muat ulang);
// Save-Data/deviceMemory dievaluasi saat muat (tidak punya event andal).
const themeInit = `(function(){try{var t=localStorage.getItem('shotstash_theme');if(t!=='light'&&t!=='dark'){t='dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}try{var h=document.documentElement,m=window.matchMedia('(prefers-reduced-motion: reduce)'),s=false,d=false;try{s=!!(navigator.connection&&navigator.connection.saveData);}catch(e){}try{d=(navigator.deviceMemory||8)<=2;}catch(e){}var f=function(){h.setAttribute('data-motion',(m.matches||s||d)?'calm':'full');};f();if(m.addEventListener){m.addEventListener('change',f);}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      // data-theme & data-motion diubah skrip anti-FOUC pra-hidrasi —
      // tanpa ini React memberi warning mismatch atribut di dev.
      suppressHydrationWarning
      // Story 1.9: halaman berbahasa Indonesia (FR4) — bukan "en" lagi.
      lang="id"
      className={`${inter.variable} ${poppins.variable}`}
      data-theme="dark"
      data-motion="full"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <ApolloWrapper>
          <AuthProvider>{children}</AuthProvider>
        </ApolloWrapper>
      </body>
    </html>
  );
}
