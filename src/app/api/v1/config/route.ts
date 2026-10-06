/**
 * Public runtime settings for the browser (Story 6.3). Replaces every
 * build-time public variable, so an operator changes them with a
 * restart, never a rebuild. Public and served before setup; never carries a
 * secret.
 *
 *   200 { appUrl, googleClientId, features, version, defaultLocale }
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { publicConfig } from '@/lib/config';
import { publishedDemoAccounts } from '@/modules/demo';

export const dynamic = 'force-dynamic';

/**
 * Runtime config
 * @description Public settings the browser needs (app URL and Google client id and feature switches and version and default locale). Public and served before setup; never carries a secret.
 * @tag System
 * @auth public
 * @response 200:PublicConfigResponse:Public settings
 * @openapi
 */
export const GET = defineRoute({
  auth: 'public',
  allowBeforeSetup: true,
  handler: async () => {
    const body = publicConfig();
    // Story 8.2: publish only demo accounts that exist as read-only accounts
    // (before setup or the seed there are none, and nothing is published).
    if (body.demo) {
      const accounts = await publishedDemoAccounts().catch(() => []);
      body.demo = accounts.length ? { ...body.demo, accounts } : null;
    }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  },
});
