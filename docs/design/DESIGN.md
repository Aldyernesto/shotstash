---
name: Shotstash
status: stub
updated: '2026-09-28'
description: Design spine for Shotstash, a self-hosted media cloud for creators. Dark theme is the default, light theme is secondary; the hero stage and card objects stay dark in both themes.
colors:
  # Theme rule: a base name is the DARK theme value (default); the -light suffix is the
  # LIGHT theme value. A base name with a -light pair compiles to ONE CSS custom property
  # that switches value under html[data-theme="light"]. Invariant groups have no -light pair.
  # == Page chrome (follows theme) ==
  bg: '#0f0f0d'
  bg-light: '#f5f4ee'
  surface: '#1b1b18'
  surface-light: '#ffffff'
  surface-2: '#252521'
  surface-2-light: '#f0eee6'
  line: '#33322d'
  line-light: '#e2dfd5'
  input-border: '#6b695f'
  input-border-light: '#8a877c'
  text: '#fafaf5'
  text-light: '#141310'
  text-soft: '#dcdad2'
  text-soft-light: '#4a4438'
  muted: '#a3a197'
  muted-light: '#6d6a60'
  nav-idle: '#bdbbb2'
  nav-idle-light: '#4a4438'
  meta: '#9a988f'
  meta-light: '#6d6a60'
  placeholder: '#8d8b83'
  placeholder-light: '#6d6a60'
  # == Accent (brand blue, same in both themes) ==
  accent: '#3563f2'
  accent-edge: '#2446c7'
  accent-2: '#8aa5ff'
  accent-text-light: '#2a4fd6'
  on-accent: '#ffffff'
  ink: '#141310'
  paper: '#ffffff'
  accent-08: '#3563f214'
  accent-14: '#3563f224'
  accent-20: '#3563f233'
  accent-35: '#3563f259'
  accent-45: '#3563f273'
  accent-55: '#3563f28c'
  # == Invariant: hero stage, card objects, scrims, white overlays (never switch theme) ==
  stage-1: '#34322d'
  stage-mid: '#26251f'
  stage-2: '#1a1a17'
  stage-2-75: '#1a1a17bf'
  stage-text: '#fafaf5'
  stage-sub: '#dedcd3'
  object-back-top: '#282826'
  object-back-bottom: '#1a1a18'
  pocket-top: '#2d2d2a'
  pocket-mid: '#1e1e1b'
  pocket-bottom: '#161614'
  object-cell-glow: '#23221e'
  photo-frame: '#eeeae2'
  label-pill: '#0b0b0a'
  rep-placeholder: '#222222'
  object-text: '#fafaf5'
  object-meta: '#9a988f'
  scrim: '#0a0a09'
  scrim-60: '#0a0a0999'
  scrim-85: '#0a0a09d9'
  scrim-92: '#0a0a09eb'
  scrim-95: '#0a0a09f2'
  pocket-shadow-warm: '#3c32148c'
  white-10: '#ffffff1a'
  white-12: '#ffffff1f'
  white-14: '#ffffff24'
  white-16: '#ffffff29'
  white-25: '#ffffff40'
  # == Status: fill values are theme-independent; *-text, *-bg, *-border follow theme ==
  danger: '#e5484d'
  danger-text: '#f07a7e'
  danger-text-light: '#b8292f'
  danger-bg: '#e5484d1a'
  danger-bg-light: '#e5484d12'
  danger-border: '#e5484d59'
  danger-border-light: '#e5484d66'
  ok: '#3fb68b'
  ok-text: '#3fb68b'
  ok-text-light: '#1b6f52'
  ok-bg: '#3fb68b1a'
  ok-bg-light: '#3fb68b12'
  ok-border: '#3fb68b59'
  ok-border-light: '#3fb68b66'
  warning: '#dca43b'
  warning-text: '#dca43b'
  warning-text-light: '#7a5905'
  warning-bg: '#dca43b1a'
  warning-bg-light: '#dca43b14'
  warning-border: '#dca43b59'
  warning-border-light: '#dca43b66'
brand:
  # Mirrors src/lib/brand.ts. The brand module is the source of truth; keep these in sync.
  productName: 'Shotstash'
  mark: '#3d6cff'
  accent: '#3563f2'
  accentEdge: '#2446c7'
  onAccent: '#ffffff'
  themeColor: '#141310'
  logoOnDark: '/brand/logo-on-dark.svg'
  logoOnLight: '/brand/logo-on-light.svg'
  icon: '/brand/icon.svg'
---

# Shotstash design spine

> **Stub.** This file currently carries the color tokens and the brand tokens only. The full
> spine (typography, spacing, components, motion) is rewritten in a later story.

## Colors

The `colors:` block in the frontmatter is the single source of the palette. Every value is
installed in `src/app/globals.css` as `--app-spine-<name>`; `npm run check:tokens`
(`scripts/check-design-tokens.mjs`) fails CI when the two drift apart.

- A base name is the dark theme value; the `-light` suffix is the light theme value. Page
  chrome pairs fold into one custom property that switches value under
  `html[data-theme="light"]`.
- Invariant groups (hero stage, card objects, scrims, white overlays, status fills) never
  switch theme.
- Text and icons on the `accent` fill are always `on-accent` (white).

### Accent family

Shotstash's identity is blue (rebrand of 2026-09-28; the product started from a yellow palette).
The logo keeps `#3d6cff` exactly; the UI accent that carries white text is a slightly deeper blue.
Contrast ratios are WCAG 2.x and are checked by `scripts/accent-contrast.test.mjs` (part of `npm test`).

| Token | Value | Role | Contrast |
|---|---|---|---|
| `accent` | `#3563f2` | Fills: primary buttons, pills, stickers, badges, selection, active nav | white text 4.98:1; as a UI boundary 3.85 / 3.47 / 3.09 on dark bg / surface / surface-2, 4.52 / 4.98 / 4.29 on light |
| `accent-edge` | `#2446c7` | The darker lip under stickers and marks; never a hover fill (it drops to 2.54:1 on the dark bg) | 6.87 / 7.57 / 6.51 on light bg / surface / surface-2 |
| `accent-2` | `#8aa5ff` | Accent text and icons on dark surfaces (dark chrome, hero stage, card objects, label pills); dark focus ring; every accent boundary on the invariant dark layers (photo selection frame, drop outlines, video progress, media-layer focus rings) | 8.14 on bg, 6.52 on surface-2, 5.43 on stage-1 |
| `accent-text-light` | `#2a4fd6` | Accent text and icons on light surfaces (light theme only) | 5.98 on bg, 6.59 on surface, 5.67 on surface-2 |
| `on-accent` | `#ffffff` | Text and icons on `accent` | 4.98 on `accent`, 7.57 on `accent-edge`, 6.59 on `accent-text-light` |
| `accent-08` ... `accent-55` | `accent` at 8 to 55 % alpha | Glow, shadows, empty slots | decorative |

- Never use `accent-2` on a light surface or `accent-text-light` on a dark one; theme-aware text
  should use `--app-accent` (dark: `accent-2`, light: `accent-text-light`).
- The light theme focus ring stays `ink`; the dark theme ring is `accent-2`.
- `accent` itself is only 2.57:1 on `stage-1`, so it is never a boundary on the hero stage,
  card objects or photos; those use `accent-2`.
- Active and selected states use the same accent in both themes (filled accent pill with white
  text, accent frames and dots). The state is never color only: a filled shape, weight 700/800,
  a check or a radio dot always goes with it.
- Status colors keep their meaning: `warning` is amber, not the brand. In the rebrand it moved to
  `#dca43b`, because its previous value was also the retired gold brand token; the new value
  keeps the same amber role (6.90:1 as text on dark surface-2) without reusing a brand hex.
  The warning pairs are part of the contrast test.

## Brand tokens

Product identity lives in one module, `src/lib/brand.ts` (AD-11). The generated block between
`/* brand:start */` and `/* brand:end */` in `globals.css` exposes it to CSS; regenerate it with
`npm run brand:css` and never edit it by hand.

| Token | Value | CSS custom property |
|---|---|---|
| Product name | Shotstash | `--brand-name` |
| Logo blue | `#3d6cff` (the mark; brand assets only) | `--brand-mark` |
| Accent | `#3563f2` (same as `accent`) | `--brand-accent` |
| Accent edge | `#2446c7` (same as `accent-edge`) | `--brand-accent-edge` |
| On accent | `#ffffff` (same as `on-accent`) | `--brand-on-accent` |
| Theme color | `#141310` (same as `ink`) | `--brand-theme-color` |
| Logo on dark (mark + white wordmark) | `/brand/logo-on-dark.svg` | `--brand-logo-on-dark` |
| Logo on light (mark + ink wordmark) | `/brand/logo-on-light.svg` | `--brand-logo-on-light` |
| Icon | `/brand/icon.svg` | `--brand-icon` |

The mark is a `#3d6cff` rounded square with three white bars at opacity 1, 0.7 and 0.4. The
wordmark is Poppins Black (SIL Open Font License) outlined to paths, so the SVG renders without the
web font. The logo files are 1314.2 x 250: a 180 px mark, a 36 px gap, then the wordmark.

To rebrand: edit `src/lib/brand.ts` (including `mark`), replace the SVG sources in `public/brand/`
(`icon.svg`, `logo-on-dark.svg`, `logo-on-light.svg`, `og.svg`), run `npm run brand:assets`
(copies the favicon to `src/app/icon.svg` and renders `logo.png`, `og.png` and
`src/app/apple-icon.png`), then `npm run brand:css`. `scripts/brand-assets.test.mjs` checks that
the mark fill in every SVG equals `brand.mark`.
