# Launch-day checklist

Work top to bottom; do not post anything until every box above "Posts" is ticked. Items marked (owner) need the maintainer's own accounts, servers or judgement.

Status on 2026-10-07 (Day 0): v0.3.0 is released, the images are public and the demo is live. What is still open is marked (owner) and left unticked.

## Before launch day (owner)

- [x] Decide the demo domain and the server it runs on (never a machine that holds real media): https://demostash.aldyernesto.my.id on its own small server.
- [ ] Three outside readers each look at the README for 30 seconds, then say what Shotstash is, who it is for and how to install it. Fix the README until all three get it right. (owner)
- [ ] Three SM-2 tester runs done and recorded in [validation.md](validation.md), both targets met. (owner)
- [ ] Timed fresh install on a clean VPS with the published images: the README one-liner from `git clone` to the first upload, minutes recorded here and in the timing note of the quick start. (owner)
- [x] Fill every placeholder in `launch/` (demo URL and dates); a grep of `launch/` for angle-bracket placeholders finds nothing.

## Launch day

1. [x] **Privacy scan of the whole tree**: `node scripts/privacy-scan.mjs --all` with gitleaks installed must report nothing. CI runs exactly that on every push to `main` (the `check` job of `pr.yml` installs gitleaks, then scans the whole tree), and `main` is green.
2. [x] **CI green on `main`**: every job of the latest run passed.
3. [x] **Merge the release PR** (release-please PR #2, v0.3.0). The release workflow finished: the GitHub release, its changelog and the tag `v0.3.0` exist.
4. [x] **Container images published**: `ghcr.io/aldyernesto/shotstash` and `ghcr.io/aldyernesto/shotstash-worker` show `0.3.0`, `0.3` and `latest` for linux/amd64 and linux/arm64.
5. [x] **Both GHCR packages public** (package settings, visibility), and an anonymous pull works: `docker logout ghcr.io && docker pull ghcr.io/aldyernesto/shotstash:0.3.0`.
6. [x] **README badges**: the release badge shows v0.3.0, and the container badge links to the GHCR package.
7. [ ] **Demo live** (owner, 2 sub-items left), following the docs guide "Run a public demo" (https://aldyernesto.github.io/shotstash/docs/demo/):
   - [x] server up with TLS on the demo domain, behind the reverse proxy from the networking guide, `TRUST_PROXY=true`;
   - [x] `SHOTSTASH_DEMO_MODE=true`, a `DEMO_ADMIN_PASSWORD`, and `SETUP_TOKEN` set; first-run setup done by the owner;
   - [x] demo data seeded inside the container (`docker compose exec -u node app node dist/demo.js seed`), the sign-in page shows the demo accounts;
   - [ ] the nightly reset is scheduled: check on the morning of 2026-10-08 that it ran (owner);
   - [x] `SHOTSTASH_CORS_ORIGINS` set to the docs origin only (`https://aldyernesto.github.io`, or the docs domain);
   - [x] repository variable `DEMO_ORIGIN` set to the demo origin, `docs.yml` rerun, and the REST reference try-it console answers from the demo;
   - [ ] external uptime monitor on https://demostash.aldyernesto.my.id/api/health (owner).
8. [x] **README demo link**: the README links https://demostash.aldyernesto.my.id, and the launch texts carry the same URL.
9. [ ] **Last look** (owner): open the repository page logged out, on a phone and a desktop. Banner, tagline, GIF, one-line install, badges and demo link all render; every link works.

## Posts

10. [ ] Posts in the order and on the days in [schedule.md](schedule.md): Show HN first (2026-10-13), r/selfhosted a few days later (2026-10-18), Product Hunt optional (2026-10-22), awesome-selfhosted only once the first release is more than four months old (from 2027-02-07).

## Still open after launch (owner)

- [ ] Watch issues daily for the first two weeks; first reply within a week at most (CONTRIBUTING promise).
- [ ] Record stars, issues and demo traffic at day 14 and at three months.
- [ ] awesome-selfhosted submission on its date, 2027-02-07 or later ([awesome-selfhosted.md](awesome-selfhosted.md)).
