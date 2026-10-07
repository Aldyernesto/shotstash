# Contributing to Shotstash

Thanks for helping. Shotstash is MIT licensed, and there is no paid tier: everything lives in this repository. Everyone who takes part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Set up

To run Shotstash itself, one line is enough (Docker with the Compose plugin):

```bash
git clone https://github.com/Aldyernesto/shotstash.git && cd shotstash && sh docker/init.sh && docker compose up -d
```

`docker/init.sh` writes `.env` with fresh random secrets (it never overwrites an existing one) and runs the preflight check.

That line runs the published images of the latest release, not the code in your checkout. To run your own changes in Docker, build them: set `COMPOSE_FILE=docker-compose.yml` in `.env` (or export it in the shell, which wins over `.env`) and start with `docker compose up -d --build`. If you create `.env` by hand with `cp .env.example .env` instead of `docker/init.sh`, it carries the same images line, so change it the same way.

To work on the code, you need Node.js 24. Follow "Development" in the [README](README.md); in short:

```bash
npm install
cp .env.example .env   # set SESSION_SECRET (openssl rand -hex 32); COMPOSE_FILE only matters for docker compose
npx prisma generate
npm run dev:db              # embedded PostgreSQL on port 55433; keep it running
npx prisma migrate deploy   # in a second terminal
npm run dev:seed            # development accounts
npm run dev                 # http://localhost:3005
```

## Before you push

Run the checks listed under "Before you push" in the [README](README.md); CI runs the same ones on every pull request. Tests use `node --test` (`npm test`). The local end-to-end scripts (`npm run e2e:setup`, `npm run e2e:security` and the others) are described in the README too.

## Commits and pull requests

- **Commit style:** [Conventional Commits](https://www.conventionalcommits.org/), for example `feat(share): expiring links` or `fix(upload): resume after a 503`. Mark a breaking change with `!` (`feat!: ...`) or a `BREAKING CHANGE:` footer and describe the migration. The changelog and version numbers are generated from these messages ([docs/releasing.md](docs/releasing.md)).
- **Pull requests:** one topic per pull request, a Conventional Commit title, and the checklist in the template filled in. For a large change, open an issue first so we can agree on the approach.
- **Review:** every pull request gets a first review within a week. If it has been quiet longer than that, a friendly ping on the pull request is welcome.

## Conventions

- **Generated files:** after changing `src/graphql/schema.ts` run `npm run sdl`; after changing a route under `src/app` run `npm run openapi`; after changing `src/lib/config.ts` run `npm run env:example`. Commit the regenerated files.
- **Code layout:** new domain code goes into `src/modules/<domain>/` and is imported through `@/modules/<domain>` only. Modules never import from `src/app`, `src/components`, `src/graphql` or `src/services` (lint enforces it).
- **UI text** comes from `messages/en.json` ([docs/i18n.md](docs/i18n.md)).
- **Screenshots and sample media** in issues, pull requests and docs use synthetic data only: generated images and clips, invented names, no real people.

## Security issues

Please report them privately through GitHub security advisories, not in a public issue; see [SECURITY.md](SECURITY.md).
