/**
 * Session store (Stories 2.1 / 2.2): one `Session` table, two carriers.
 *
 *   - Bearer token in `Authorization` for `/api/graphql` and `/api/v1/*`;
 *   - the `shotstash_session` cookie (HttpOnly, SameSite=Lax, Path=/media)
 *     for media bytes only, because `<img>` and `<video>` cannot send headers.
 *
 * Sessions slide: a validated session with less than half of its lifetime
 * left is extended to now + 7 days.
 */

import { randomBytes } from 'crypto';
import prisma from '@/lib/prisma';
import { requestScheme } from '@/lib/request';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'shotstash_session';
export const SESSION_COOKIE_PATH = '/media';

export type SessionActor = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  accountStatus: string;
  readOnly: boolean;
};

export type ValidSession = {
  id: string;
  token: string;
  expiresAt: Date;
  /** True when this validation slid the expiry (the cookie should be refreshed). */
  renewed: boolean;
  actor: SessionActor;
};

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * A new session row. With `fixed` (the demo try-it sessions only) it lasts
 * exactly `fixed.ttlMs` and never slides.
 */
export async function createSessionRow(userId: string, meta?: { ip?: string; userAgent?: string }, fixed?: { ttlMs: number }) {
  return prisma.session.create({
    data: {
      token: newSessionToken(),
      userId,
      expiresAt: new Date(Date.now() + (fixed?.ttlMs ?? SESSION_TTL_MS)),
      fixedExpiry: Boolean(fixed),
      ipAddress: meta?.ip,
      userAgent: meta?.userAgent,
    },
  });
}

/** Resolves a token to a live session. Expired rows are deleted; the expiry slides. */
export async function validateSessionToken(token: string | null | undefined): Promise<ValidSession | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  let expiresAt = session.expiresAt;
  let renewed = false;
  if (!session.fixedExpiry && expiresAt.getTime() - now < SESSION_TTL_MS / 2) {
    expiresAt = new Date(now + SESSION_TTL_MS);
    renewed = true;
    await prisma.session
      .update({ where: { id: session.id }, data: { expiresAt } })
      .catch(() => {});
  }

  const u = session.user;
  return {
    id: session.id,
    token: session.token,
    expiresAt,
    renewed,
    actor: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      active: u.active,
      accountStatus: u.accountStatus,
      readOnly: u.readOnly,
    },
  };
}

export async function destroySessionToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const res = await prisma.session.deleteMany({ where: { token } });
  return res.count > 0;
}

export function bearerToken(headers: { get(name: string): string | null }): string | null {
  const h = headers.get('authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t || null;
}

/** `Secure` only when the request is HTTPS (see `requestScheme()`). */
export function isHttpsRequest(req: Request): boolean {
  return requestScheme(req) === 'https';
}

export type CookieOptions = {
  httpOnly: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  secure: boolean;
  expires?: Date;
  maxAge?: number;
};

export function sessionCookieOptions(req: Request, expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: SESSION_COOKIE_PATH,
    secure: isHttpsRequest(req),
    expires: expiresAt,
  };
}

export function clearedCookieOptions(req: Request, path: string): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', path, secure: isHttpsRequest(req), maxAge: 0 };
}
