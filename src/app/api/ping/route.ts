import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';

export const GET = defineRoute({
  auth: 'public',
  handler: () => NextResponse.json({ ok: true, time: Date.now() }),
});
