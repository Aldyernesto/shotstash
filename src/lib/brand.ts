/**
 * Single brand source (AD-11). Every product name, tagline, logo path and
 * brand color used by the app reads from here. CSS custom properties are
 * generated from this file by `npm run brand:css` (scripts/gen-brand-css.ts);
 * never edit the generated block in globals.css by hand.
 *
 * To rebrand a fork: change the values below, replace the files under
 * public/brand/, then run `npm run brand:css`.
 */
export const brand = {
  productName: 'Shotstash',
  tagline: 'Self-hosted media cloud for creators',
  description: 'Self-hosted media cloud for creators. Your footage, your hardware, your cloud.',
  /** Placeholder until the operator configures a real mailbox. */
  supportEmail: 'support@example.com',
  /** Sender used by transactional email when EMAIL_FROM is unset. */
  emailFrom: 'no-reply@example.com',
  logo: {
    /** Mark + wordmark for dark backgrounds (white wordmark). */
    onDark: '/brand/logo-on-dark.svg',
    /** Mark + wordmark for light backgrounds (ink wordmark). */
    onLight: '/brand/logo-on-light.svg',
    /** Intrinsic aspect ratio (width / height) of both wordmark files. */
    width: 1314.2,
    height: 250,
  },
  icon: '/brand/icon.svg',
  ogImage: { url: '/brand/og.png', width: 1200, height: 630 },
  /** Square PNG (128px, shown at 64px) used by email templates. */
  emailLogo: '/brand/logo.png',
  /** Logo blue: the rounded square of the three-bar mark. Used by the brand assets only. */
  mark: '#3d6cff',
  /**
   * Brand accent (UI fill): same value as the design spine token `accent`. A slightly
   * deeper blue than the mark so white text on it reaches 4.98:1 (WCAG AA).
   */
  accent: '#3563f2',
  /** Accent edge: same value as the design spine token `accent-edge`. */
  accentEdge: '#2446c7',
  /** Text and icons on the accent fill: same value as the design spine token `on-accent`. */
  onAccent: '#ffffff',
  /** Browser/PWA chrome color (spine token `ink`). */
  themeColor: '#141310',
} as const;

export type Brand = typeof brand;
