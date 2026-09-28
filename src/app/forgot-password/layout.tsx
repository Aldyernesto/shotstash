import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import AuthPage from '@/components/auth/AuthPage';
import { brand } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('forgotPassword');
  return { title: t('metaTitle', { productName: brand.productName }) };
}

// Story 1.20: kerangka glow lama (backgroundGlow/accentGlow dari
// page.module.css root) dipensiunkan — shell kini auth-topbar dari
// komponen bersama: desktop logo + theme-toggle melayang di atas,
// kartu mulai 112px dari atas viewport; HP: bar di alur lalu kartu,
// tanpa panggung (AC 1.20).
export default function ForgotPasswordLayout({ children }: { children: ReactNode }) {
  return <AuthPage variant="centered">{children}</AuthPage>;
}
