---
name: Shotstash
status: stub
updated: '2026-09-27'
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
  accent-light: '#8a6508'
  # == Brand (same in both themes) ==
  yellow: '#efe749'
  yellow-edge: '#b9b22c'
  gold: '#d4a83c'
  ink: '#141310'
  paper: '#ffffff'
  yellow-08: '#efe74914'
  yellow-14: '#efe74924'
  yellow-35: '#efe74959'
  yellow-45: '#efe74973'
  yellow-55: '#efe7498c'
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
  yellow-20: '#efe74933'
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
  warning: '#d4a83c'
  warning-text: '#d4a83c'
  warning-text-light: '#7a5905'
  warning-bg: '#d4a83c1a'
  warning-bg-light: '#d4a83c14'
  warning-border: '#d4a83c59'
  warning-border-light: '#d4a83c66'
brand:
  # Mirrors src/lib/brand.ts. The brand module is the source of truth; keep these in sync.
  productName: 'Shotstash'
  accent: '#efe749'
  accentEdge: '#b9b22c'
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
- Text on the yellow accent is always `ink`.

## Brand tokens

Product identity lives in one module, `src/lib/brand.ts` (AD-11). The generated block between
`/* brand:start */` and `/* brand:end */` in `globals.css` exposes it to CSS; regenerate it with
`npm run brand:css` and never edit it by hand.

| Token | Value | CSS custom property |
|---|---|---|
| Product name | Shotstash | `--brand-name` |
| Accent | `#efe749` (same as `yellow`) | `--brand-accent` |
| Accent edge | `#b9b22c` (same as `yellow-edge`) | `--brand-accent-edge` |
| Theme color | `#141310` (same as `ink`) | `--brand-theme-color` |
| Wordmark on dark | `/brand/logo-on-dark.svg` | `--brand-logo-on-dark` |
| Wordmark on light | `/brand/logo-on-light.svg` | `--brand-logo-on-light` |
| Icon | `/brand/icon.svg` | `--brand-icon` |

The wordmark is Poppins Black (SIL Open Font License) outlined to paths, so the SVG renders
without the web font. To rebrand, change `brand.ts`, replace the files in `public/brand/` and the
favicon `src/app/icon.svg` (a copy of `public/brand/icon.svg`), and run `npm run brand:css`.
