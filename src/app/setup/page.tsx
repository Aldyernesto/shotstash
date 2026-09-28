/**
 * First-run setup (Story 2.6). Shown only while no super admin exists: the
 * custom server sends every page here until then, and this page sends the
 * visitor to `/` once setup is complete. The storage probe runs on every
 * render so the owner sees whether the media folder is writable before
 * submitting.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import AuthPage from '@/components/auth/AuthPage';
import { brand } from '@/lib/brand';
import { isSetupComplete, probeStorage, setupTokenRequired } from '@/modules/setup';
import SetupForm from './SetupForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Set up | ${brand.productName}`,
};

export default async function SetupPage() {
  if (await isSetupComplete()) redirect('/');
  const probe = await probeStorage();
  return (
    <AuthPage variant="centered">
      <SetupForm
        productName={brand.productName}
        storage={probe.ok ? { ok: true } : { ok: false, reason: probe.reason }}
        tokenRequired={setupTokenRequired()}
      />
    </AuthPage>
  );
}
