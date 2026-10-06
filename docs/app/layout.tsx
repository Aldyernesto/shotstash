import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import { Provider } from '@/components/provider';
import { productName, tagline } from '@/lib/site';
import './global.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// Poppins Black, copied from the app's public/fonts by scripts/prepare.mjs.
const display = localFont({
  src: [
    { path: '../assets/fonts/poppins-black-900.woff2', weight: '900', style: 'normal' },
    { path: '../assets/fonts/poppins-black-900-italic.woff2', weight: '900', style: 'italic' },
  ],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: `${productName} docs`, template: `%s | ${productName} docs` },
  description: tagline,
};

export const viewport: Viewport = {
  themeColor: '#141310',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${display.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
