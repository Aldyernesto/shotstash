// Template email reset password (React Email). Dirender di server → HTML + plain text.
// Semua teks Bahasa Indonesia. Subject sengaja polos (tanpa kata pemicu spam / tanda seru / huruf kapital semua).

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
  render,
} from '@react-email/components';
import { brand } from '@/lib/brand';

export type PasswordResetEmailProps = {
  name: string;
  email: string;
  code: string;
  expiresAt: Date;
  /** URL dasar aplikasi, mis. http://localhost:3005 (tanpa garis miring di akhir). */
  appUrl: string;
  /** Akun belum punya password (daftar via Google). */
  googleOnly?: boolean;
};

export const PASSWORD_RESET_EMAIL_SUBJECT = `Kode reset password ${brand.productName}`;

/** Jam kedaluwarsa dalam WIB, format HH:MM (24 jam). */
export function formatWibTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  }).format(date);
}

export function passwordResetVerifyUrl(appUrl: string, email: string): string {
  return `${appUrl}/forgot-password/verify?email=${encodeURIComponent(email)}`;
}

const colors = {
  page: '#f4f1ea',
  card: '#ffffff',
  border: '#e3ddd0',
  text: '#1f1c16',
  dim: '#4a4438',
  muted: '#7a7161',
  accent: '#d4a83c',
  accentOn: '#14120d',
  codeBg: '#f7f4ed',
};

const fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export default function PasswordResetEmail({ name, email, code, expiresAt, appUrl, googleOnly = false }: PasswordResetEmailProps) {
  const verifyUrl = passwordResetVerifyUrl(appUrl, email);
  const until = formatWibTime(expiresAt);
  const greetingName = name?.trim() || `Sahabat ${brand.productName}`;

  return (
    <Html lang="id" dir="ltr">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>Gunakan kode ini untuk membuat password baru. Berlaku 15 menit.</Preview>
      <Body style={{ margin: 0, padding: '24px 12px', backgroundColor: colors.page, fontFamily }}>
        <Container
          style={{
            maxWidth: '480px',
            margin: '0 auto',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: '32px 28px',
          }}
        >
          <Section style={{ textAlign: 'center' }}>
            <Img
              src={`${appUrl}${brand.emailLogo}`}
              width="64"
              height="64"
              alt={brand.productName}
              style={{ display: 'block', margin: '0 auto', borderRadius: '12px', border: 0 }}
            />
            <Text data-skip-in-text="true" style={{ margin: '10px 0 0', fontSize: '13px', fontWeight: 700, color: colors.muted, letterSpacing: '0.04em' }}>
              {brand.productName}
            </Text>
          </Section>

          <Heading as="h1" style={{ margin: '24px 0 12px', fontSize: '22px', lineHeight: '30px', fontWeight: 800, color: colors.text, textAlign: 'center' }}>
            Kode reset password
          </Heading>

          <Text style={{ margin: '0 0 12px', fontSize: '15px', lineHeight: '24px', color: colors.dim }}>
            Halo {greetingName},
          </Text>
          <Text style={{ margin: '0 0 16px', fontSize: '15px', lineHeight: '24px', color: colors.dim }}>
            Kami menerima permintaan untuk membuat password baru akun Shotstash dengan email {email}.
            Masukkan kode berikut di halaman reset password:
          </Text>

          <Section
            style={{
              margin: '0 0 12px',
              padding: '16px 8px',
              backgroundColor: colors.codeBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '10px',
              textAlign: 'center',
            }}
          >
            <Text
              style={{
                margin: 0,
                fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, 'Courier New', monospace",
                fontSize: '34px',
                lineHeight: '42px',
                fontWeight: 700,
                letterSpacing: '8px',
                color: colors.text,
              }}
            >
              {code}
            </Text>
          </Section>

          <Text style={{ margin: '0 0 24px', fontSize: '14px', lineHeight: '22px', color: colors.muted, textAlign: 'center' }}>
            Kode berlaku 15 menit (sampai {until} WIB).
          </Text>

          <Section style={{ textAlign: 'center', margin: '0 0 24px' }}>
            <Button
              href={verifyUrl}
              style={{
                backgroundColor: colors.accent,
                color: colors.accentOn,
                fontSize: '15px',
                fontWeight: 700,
                textDecoration: 'none',
                borderRadius: '999px',
                padding: '12px 28px',
                display: 'inline-block',
              }}
            >
              Masukkan Kode
            </Button>
          </Section>

          {googleOnly && (
            <Text style={{ margin: '0 0 16px', fontSize: '14px', lineHeight: '22px', color: colors.dim }}>
              Akun kamu terdaftar via Google. Setelah membuat password, kamu tetap bisa masuk dengan tombol
              &quot;Login dengan Google&quot;.
            </Text>
          )}

          <Hr style={{ borderColor: colors.border, margin: '8px 0 16px' }} />

          <Text style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: '20px', color: colors.muted }}>
            Kalau kamu tidak meminta reset, abaikan email ini; password tidak berubah. Jangan bagikan kode ke siapa pun.
          </Text>
          <Text style={{ margin: 0, fontSize: '12px', lineHeight: '18px', color: colors.muted }}>
            Email otomatis dari Shotstash. Mohon tidak membalas email ini.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Render subject + HTML + plain text untuk dikirim lewat email.service. */
export async function renderPasswordResetEmail(props: PasswordResetEmailProps) {
  const element = <PasswordResetEmail {...props} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, {
      plainText: true,
      // Judul tidak perlu HURUF BESAR semua di versi plain text.
      htmlToTextOptions: { selectors: [{ selector: 'h1', options: { uppercase: false } }] },
    }),
  ]);
  return { subject: PASSWORD_RESET_EMAIL_SUBJECT, html, text };
}
