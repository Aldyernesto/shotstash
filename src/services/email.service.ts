// Shotstash — Email Service (transaksional)
// Provider: Resend via HTTP API (bukan SMTP). Dokumentasi DNS: docs/history/email-dns-setup.md
//
// Env:
//   RESEND_API_KEY   — API key Resend. Tanpa ini (dan tanpa EMAIL_TRANSPORT=log) fitur email dianggap belum aktif.
//   EMAIL_FROM       — opsional, default DEFAULT_EMAIL_FROM.
//   EMAIL_TRANSPORT  — "log" untuk dev/test: tidak mengirim apa pun, pesan terakhir disimpan di memori.
//
// JANGAN pernah me-log isi pesan (subject/html/text bisa berisi kode reset).

export const DEFAULT_EMAIL_FROM = 'Shotstash <no-reply@example.com>';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult = { ok: true; id?: string } | { ok: false; error: string };

function isLogTransport() {
  return process.env.EMAIL_TRANSPORT === 'log';
}

/** true kalau email bisa dikirim (API key Resend ada) atau transport log aktif (dev/test). */
export function isEmailConfigured(): boolean {
  return isLogTransport() || !!process.env.RESEND_API_KEY?.trim();
}

// Transport log: hanya pesan terakhir yang disimpan (untuk test E2E).
let lastLoggedEmail: (EmailMessage & { from: string; at: Date }) | null = null;

/** Pesan terakhir yang "dikirim" lewat EMAIL_TRANSPORT=log. Hanya untuk test. */
export function getLastLoggedEmail() {
  return lastLoggedEmail;
}

/** Hapus pesan tersimpan transport log. Hanya untuk test. */
export function clearLastLoggedEmail() {
  lastLoggedEmail = null;
}

/** "budi@example.com" → "b***@example.com" — untuk log tanpa membocorkan alamat lengkap. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;

  if (isLogTransport()) {
    lastLoggedEmail = { ...message, from, at: new Date() };
    console.info(`[email] transport=log: pesan disimpan, tidak dikirim (to=${maskEmail(message.to)})`);
    return { ok: true };
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error('[email] gagal: RESEND_API_KEY belum di-set');
    return { ok: false, error: 'not_configured' };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Hanya status + nama error dari Resend — tanpa isi pesan.
      let errorName = '';
      try {
        const body = (await res.json()) as { name?: unknown };
        if (typeof body?.name === 'string') errorName = body.name;
      } catch {
        // body bukan JSON
      }
      console.error(`[email] gagal kirim via Resend: status=${res.status}${errorName ? ` error=${errorName}` : ''} to=${maskEmail(message.to)}`);
      return { ok: false, error: errorName || `http_${res.status}` };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: unknown };
    return { ok: true, id: typeof data.id === 'string' ? data.id : undefined };
  } catch (error) {
    const name = (error as Error)?.name || 'Error';
    console.error(`[email] gagal kirim via Resend: ${name} to=${maskEmail(message.to)}`);
    return { ok: false, error: name };
  }
}
