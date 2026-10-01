# Releasing Shotstash

Releases are automated with [release-please](https://github.com/googleapis/release-please). One maintainer can cut a release by merging one pull request; nobody tags or builds images by hand.

## Commit style

Every commit on `main` follows [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Meaning | Version bump before 1.0 | After 1.0 |
|---|---|---|---|
| `fix:` | a bug fix | patch | patch |
| `feat:` | a new feature | minor | minor |
| `feat!:` or a `BREAKING CHANGE:` footer | a breaking change to the API, the worker contract, configuration or data | minor | major |
| `perf:`, `revert:`, `deps:`, `docs:` | listed in the changelog | patch | patch |
| `chore:`, `ci:`, `test:`, `refactor:`, `build:`, `style:` | not listed | none | none |

A scope is welcome (`fix(upload): ...`). Breaking changes always come first in the changelog, and need a migration note in the commit body.

## The release PR

`.github/workflows/release.yml` runs after the CI workflow (`pr.yml`) finished successfully for a push to `main` (a `workflow_run` trigger), on the commit CI checked. A red CI on `main` means no release PR update and no release. release-please reads the commits since the last tag and keeps one pull request open, titled `chore: release X.Y.Z`. It contains:

- `CHANGELOG.md` with the new section (breaking changes, features, bug fixes, performance, reverts, docs, dependencies), each entry credited to its author;
- the new version in `package.json`, `package-lock.json`, `worker/package.json` (the reference worker reports this version in its manifest) and `info.version` of `openapi.json` (`npm run openapi:check` compares parsed JSON, so release-please's formatting of that bump never counts as drift);
- `.release-please-manifest.json`, the version release-please starts from next time.

**CI on the release PR.** A pull request opened or updated with `GITHUB_TOKEN` starts no workflow, so the release PR would never get its checks. Whenever release-please creates or updates its PR, the workflow therefore starts CI on the PR branch itself (`gh workflow run pr.yml --ref <release branch>`, which needs `actions: write`). The checks appear on the PR like any other run; merge only when they are green.

Configuration lives in `release-please-config.json`. A unit test (`scripts/release-config.test.mjs`) checks that the manifest, the root and worker versions agree and that the workflow and Dockerfiles name no owner.

The repository setting **Settings, Actions, General, Allow GitHub Actions to create and approve pull requests** must be on, or release-please cannot open the PR.

## What a merged release PR does

Merging the release PR pushes to `main`; when CI is green on that commit, the release workflow runs again. This time release-please:

1. tags the merge commit `vX.Y.Z` and creates the GitHub release with the changelog section as its notes;
2. hands `release_created` to the image jobs in the same run (a tag created with `GITHUB_TOKEN` does not start other workflows, so the images cannot be built by a tag trigger).

The image jobs check out the tag and build both images natively, one runner per architecture (`ubuntu-24.04` for amd64, `ubuntu-24.04-arm` for arm64), push each by digest, and then publish one multi-arch manifest per image:

| Image | Tags |
|---|---|
| `ghcr.io/<owner>/shotstash` | `X.Y.Z`, `X.Y`, `latest` |
| `ghcr.io/<owner>/shotstash-worker` | `X.Y.Z`, `X.Y`, `latest` |

- `<owner>` is the GitHub owner of the repository, lowercased.
- Tags come from docker/metadata-action semver patterns with `flavor: latest=auto`, never a raw `latest` tag. `latest` only moves when the published version is the highest stable release among the repository tags, and never for a pre-release; `X.Y` only moves when it is the highest release of that minor line. Republishing an older tag therefore never moves `latest` or `X.Y` backwards.
- Both images get `VERSION=X.Y.Z` as a build argument: the app reports it from `/api/health`, `/api/v1/config` and the status page, the worker in its manifest.
- Labels are set per image (title and description differ for the app and the worker) together with version, licenses, source (the repository URL, also passed as the `SOURCE_URL` build argument) and revision (the tagged commit).

**Each image publishes on its own.** For each image, amd64 is required and arm64 is best effort: if the arm64 leg fails, it shows as failed in the run and that image is published with amd64 only; if the amd64 leg fails, that image is not published (the job fails and says so). A failed leg of one image never blocks the other image.

Every pull request already builds both images for both architectures without pushing (the `images` job in `pr.yml`), so a release rarely discovers a broken build.

The workflow uses only `GITHUB_TOKEN`: `contents: write`, `pull-requests: write` and `actions: write` for the release-please job, `packages: write` for the image jobs.

## Republishing a release

If the publish of a release failed (a flaky runner, a registry outage, an arm64 leg you want to add), rebuild and publish both images for the existing tag: **Actions, Release, Run workflow** with `tag` set to the release tag (such as `v1.2.3`), or

```bash
gh workflow run release.yml -f tag=v1.2.3
```

The run checks out the tag, takes `VERSION` from it, skips release-please and publishes `X.Y.Z` again (plus `X.Y` and `latest` only if that tag is still the highest, see above). Nothing else changes: no new tag, no changelog.

## GHCR packages: link and make public (once)

The first publish creates two packages under the owner (`shotstash` and `shotstash-worker`). New packages start private.

1. Open the owner's **Packages** tab, then each package's **Package settings**.
2. **Link the repository:** packages pushed by this repository's workflow are usually linked already (the `org.opencontainers.image.source` label names the repository). If **Connect repository** is offered, connect it, so the package shows on the repository page and inherits its access.
3. **Manage Actions access:** make sure this repository has the **Write** role, or later publishes fail with 403.
4. **Change visibility** to **Public** (Danger Zone), so anyone can pull without logging in.

Repeat for both packages. After that, every release publishes into the same public packages.

## Using the images

```bash
docker pull ghcr.io/<owner>/shotstash:latest
docker pull ghcr.io/<owner>/shotstash-worker:latest
```

With compose, add the override file `docker-compose.images.yml`, which replaces the local builds with the published images:

```bash
docker compose -f docker-compose.yml -f docker-compose.images.yml pull
docker compose -f docker-compose.yml -f docker-compose.images.yml up -d
```

`IMAGE_TAG` in `.env` picks the release (default `latest`; pin `X.Y.Z` for controlled upgrades). `IMAGE_REGISTRY` defaults to `ghcr.io/aldyernesto`; set it if the project moves (see below).

## Rolling back

Set `IMAGE_TAG` to the previous release (`X.Y.(Z-1)`) and run the `up -d` command above. Every migration stays compatible with the previous release, so the older version runs on the upgraded database. Before 1.0, databases are throwaway: a pre-release may need an empty database. Never move or delete a published tag; publish a fix as a new release instead.

## Moving the repository to an organisation

Nothing in the workflows or Dockerfiles names the owner: image paths come from `github.repository_owner` and the source label from `github.server_url` and `github.repository`. After a transfer, the next release publishes under `ghcr.io/<new owner>/...` automatically (link and publish the new packages as above). Update the README badges and links and the `IMAGE_REGISTRY` default in `docker-compose.images.yml`, and point users at the new image path in the release notes; the old packages stay where they are.

## Checks that guard a release

`pr.yml` runs on every pull request and push to `main`: lint (including module import direction), typecheck, design tokens, legacy allowlist, brand CSS, route matrix, `.env.example`, `schema.graphql` (`npm run sdl:check`), `openapi.json` (`npm run openapi:check`, validated as OpenAPI 3.1), the dependency audit (`npm run audit:check`, exceptions in `audit-allowlist.json` with a reason and an expiry at most 90 days ahead), unit tests, ZIP64, i18n, the privacy scan, the build, the Docker quick start, the S3 contract, the end-to-end legs and the multi-arch image build.
