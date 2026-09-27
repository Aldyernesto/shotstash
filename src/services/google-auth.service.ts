// Google Sign-In Service
import { OAuth2Client } from 'google-auth-library';
import prisma from '@/lib/prisma';
import { createSession } from './auth.service';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const ALLOWED_AUDIENCES = [GOOGLE_CLIENT_ID].filter(Boolean);

export async function googleAuth(idToken: string) {
  if (!googleClient) throw new Error('Google Sign-In not configured');

  const ticket = await googleClient.verifyIdToken({ idToken, audience: ALLOWED_AUDIENCES });
  const payload = ticket.getPayload();
  if (!payload?.email) throw new Error('Invalid Google token');

  let user = await prisma.user.findUnique({ where: { email: payload.email } });

  if (!user) {
    // Auto-register: Google user = CREW by default
    user = await prisma.user.create({
      data: {
        email: payload.email,
        name: payload.name || payload.email.split('@')[0],
        passwordHash: null,
        googleId: payload.sub,
        role: 'EDITOR',            // placeholder; role asli diberi admin saat approve
        accountStatus: 'PENDING',  // WAJIB approval; tidak langsung aktif
        avatarUrl: payload.picture,
      },
    });
  } else {
    // Akun yang dinonaktifkan admin tidak boleh dapat sesi. REJECTED (juga active=false)
    // tetap lolos supaya diarahkan ke /pending seperti sebelumnya.
    if (!user.active && user.accountStatus !== 'REJECTED') {
      throw new Error('Akun telah dinonaktifkan. Hubungi admin.');
    }
    // Existing user — link/refresh googleId + always refresh avatarUrl from Google
    const updates: any = {};
    if (!user.googleId) updates.googleId = payload.sub;
    if (payload.picture && payload.picture !== user.avatarUrl) updates.avatarUrl = payload.picture;
    if (Object.keys(updates).length > 0) {
      user = await prisma.user.update({ where: { id: user.id }, data: updates });
    }
  }

  // Same session store and lifetime as password login.
  const session = await createSession(user.id);
  return { token: session.token, user };
}
