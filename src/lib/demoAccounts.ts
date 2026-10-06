/**
 * Story 8.2: the read-only accounts of a public demo instance. Shared by the
 * runtime config (sign-in page in demo mode), the demo seed and reset, and
 * the try-it session endpoint. Pure and alias-free.
 */
export const DEMO_ACCOUNTS = [
  { email: 'demo-admin@example.com', name: 'Demo Admin', role: 'ADMIN' },
  { email: 'demo-editor@example.com', name: 'Demo Editor', role: 'EDITOR' },
  { email: 'demo-viewer@example.com', name: 'Demo Viewer', role: 'VIEWER' },
] as const;

export type DemoAccount = (typeof DEMO_ACCOUNTS)[number];

export const DEMO_EMAILS: readonly string[] = DEMO_ACCOUNTS.map((a) => a.email);

/** The account behind the docs try-it console. */
export const DEMO_VIEWER_EMAIL = 'demo-viewer@example.com';

/** Fixed id of the demo Project, so seed and reset replace exactly what they made. */
export const DEMO_PROJECT_ID = 'd0000000-0000-4000-8000-000000000001';

/** Lifetime of a try-it session (minutes); it never slides. */
export const DEMO_SESSION_MINUTES = 60;

/** What a read-only demo visitor sees instead of an account that is not a demo account. */
export const HIDDEN_ACCOUNT = { name: 'Instance owner', email: 'hidden@demo.invalid' } as const;

/**
 * True when `user` must be hidden from `viewer`: in demo mode, a read-only
 * viewer sees itself and the demo accounts only (never the owner's name or
 * email, or any other real account).
 */
export function hiddenFromDemoViewer(
  demoOn: boolean,
  viewer: { id: string; readOnly?: boolean | null } | null | undefined,
  user: { id?: string | null; email?: string | null },
): boolean {
  if (!demoOn || !viewer?.readOnly) return false;
  if (user.id && user.id === viewer.id) return false;
  return !(user.email && DEMO_EMAILS.includes(user.email));
}
