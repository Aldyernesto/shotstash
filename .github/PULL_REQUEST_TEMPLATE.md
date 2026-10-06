<!-- Title: a Conventional Commit, for example `feat(share): expiring links` or `fix(upload): resume after a 503`. -->

## What and why

<!-- What changes, and the problem it solves. Link the issue: "Closes #123". -->

## How to check it

<!-- Steps a reviewer can follow. For UI changes, add screenshots made with synthetic data only (generated media, invented names). -->

## Checklist

- [ ] The title is a Conventional Commit; a breaking change uses `!` and describes the migration.
- [ ] `npm run lint` and `npm run typecheck`
- [ ] `npm run check:tokens && npm run check:legacy && npm run brand:css -- --check`
- [ ] `npm run security:matrix -- --check` (route auth matrix)
- [ ] `npm run i18n:check`, and new UI text lives in `messages/en.json`
- [ ] `npm run env:example:check` (after changing `src/lib/config.ts`, run `npm run env:example`)
- [ ] `npm run sdl:check` and `npm run openapi:check` (regenerated files committed)
- [ ] `npm run audit:check`
- [ ] `npm test`
- [ ] `node scripts/privacy-scan.mjs --all`
- [ ] `npm run build`
- [ ] Docs changed: `npm ci --prefix docs && npm run build --prefix docs`
- [ ] No secrets, real media or personal data anywhere in the change
