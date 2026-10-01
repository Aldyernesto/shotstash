# Contributing to Shotstash

Thanks for helping. Shotstash is MIT licensed, and there is no paid tier: everything lives in this repository.

- **Setup:** follow "Development" in the [README](README.md) (Node.js 24, an embedded PostgreSQL for local work).
- **Before you push:** run the checks listed in the README; CI runs the same ones on every pull request.
- **Commit style:** [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(share): expiring links` or `fix(upload): resume after a 503`. Mark a breaking change with `!` (`feat!: ...`) or a `BREAKING CHANGE:` footer and describe the migration. The changelog and version numbers are generated from these messages ([docs/releasing.md](docs/releasing.md)).
- **Generated files:** after changing `src/graphql/schema.ts` run `npm run sdl`; after changing a route under `src/app` run `npm run openapi`; after changing `src/lib/config.ts` run `npm run env:example`. Commit the regenerated files.
- **Code layout:** new domain code goes into `src/modules/<domain>/` and is imported through `@/modules/<domain>` only. Modules never import from `src/app`, `src/components`, `src/graphql` or `src/services` (lint enforces it).
- **UI text** comes from `messages/en.json` ([docs/i18n.md](docs/i18n.md)).
- **Security issues:** please report them privately through GitHub security advisories, not in a public issue.
