// Password reset email template (React Email), rendered on the server to HTML + plain text.
// Story 3.5: every word comes from `email.passwordReset.*` in the recipient's locale
// (users.locale, then DEFAULT_LOCALE, then English); the expiry time is shown in
// DEFAULT_TIMEZONE with its zone label. The subject stays plain (no spam triggers).

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
import { translatorFor } from '@/modules/i18n';
import { passwordResetCopy, type EmailTranslate, type PasswordResetCopy } from './passwordResetCopy';

export type PasswordResetEmailProps = {
  name: string;
  email: string;
  code: string;
  expiresAt: Date;
  /** URL dasar aplikasi, mis. http://localhost:3005 (tanpa garis miring di akhir). */
  appUrl: string;
  /** Akun belum punya password (daftar via Google). */
  googleOnly?: boolean;
  /** Recipient's `users.locale`; null means the instance default. */
  locale?: string | null;
  /** Zone for the expiry time (DEFAULT_TIMEZONE); invalid or missing means UTC. */
  timeZone?: string | null;
  /** How long the code is valid, in minutes. */
  validMinutes?: number;
};

type TemplateProps = { email: string; code: string; appUrl: string; googleOnly: boolean; copy: PasswordResetCopy };

/** The email's words for these props, in the recipient's locale. */
export function passwordResetEmailCopy(props: PasswordResetEmailProps): PasswordResetCopy {
  return passwordResetCopy({
    translatorFor: (locale) => translatorFor(locale) as unknown as EmailTranslate,
    locale: props.locale,
    timeZone: props.timeZone,
    name: props.name,
    email: props.email,
    expiresAt: props.expiresAt,
    validMinutes: props.validMinutes ?? 15,
    productName: brand.productName,
  });
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
  accent: brand.accent,
  accentOn: brand.onAccent,
  codeBg: '#f7f4ed',
};

const fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function PasswordResetEmail({ email, code, appUrl, googleOnly, copy }: TemplateProps) {
  const verifyUrl = passwordResetVerifyUrl(appUrl, email);

  return (
    <Html lang={copy.lang} dir="ltr">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{copy.preview}</Preview>
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
            {copy.heading}
          </Heading>

          <Text style={{ margin: '0 0 12px', fontSize: '15px', lineHeight: '24px', color: colors.dim }}>
            {copy.greeting}
          </Text>
          <Text style={{ margin: '0 0 16px', fontSize: '15px', lineHeight: '24px', color: colors.dim }}>
            {copy.intro}
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
            {copy.validity}
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
              {copy.button}
            </Button>
          </Section>

          {googleOnly && (
            <Text style={{ margin: '0 0 16px', fontSize: '14px', lineHeight: '22px', color: colors.dim }}>
              {copy.googleOnly}
            </Text>
          )}

          <Hr style={{ borderColor: colors.border, margin: '8px 0 16px' }} />

          <Text style={{ margin: '0 0 12px', fontSize: '13px', lineHeight: '20px', color: colors.muted }}>
            {copy.ignore}
          </Text>
          <Text style={{ margin: 0, fontSize: '12px', lineHeight: '18px', color: colors.muted }}>
            {copy.footer}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Render subject + HTML + plain text untuk dikirim lewat email.service. */
export async function renderPasswordResetEmail(props: PasswordResetEmailProps) {
  const copy = passwordResetEmailCopy(props);
  const element = (
    <PasswordResetEmail
      email={props.email}
      code={props.code}
      appUrl={props.appUrl}
      googleOnly={props.googleOnly ?? false}
      copy={copy}
    />
  );
  const [html, text] = await Promise.all([
    render(element),
    render(element, {
      plainText: true,
      // Judul tidak perlu HURUF BESAR semua di versi plain text.
      htmlToTextOptions: { selectors: [{ selector: 'h1', options: { uppercase: false } }] },
    }),
  ]);
  return { subject: copy.subject, html, text };
}
