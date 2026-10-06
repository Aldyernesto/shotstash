# Launch-day checklist

Work top to bottom; do not post anything until every box above "Posts" is ticked. Items marked (owner) need the maintainer's own accounts, servers or judgement.

## Before launch day (owner)

- [ ] Decide the demo domain and the server it runs on (never a machine that holds real media).
- [ ] Three outside readers each look at the README for 30 seconds, then say what Shotstash is, who it is for and how to install it. Fix the README until all three get it right.
- [ ] Three SM-2 tester runs done and recorded in [validation.md](validation.md), both targets met.
- [ ] Fill every placeholder in `launch/`: `grep -rn "<demo-url>\|<date>" launch/`.

## Launch day

1. [ ] **Privacy scan of the whole tree** from a clean checkout of `main`: `node scripts/privacy-scan.mjs --all` (with gitleaks installed). It must report nothing.
2. [ ] **CI green on `main`**: every job of the latest run passed.
3. [ ] **Merge the release PR** (release-please PR #1, v0.2.0). Wait for the release workflow to finish: the GitHub release, its changelog and the tag `v0.2.0` exist.
4. [ ] **Container images published**: `ghcr.io/aldyernesto/shotstash` and `ghcr.io/aldyernesto/shotstash-worker` show `0.2.0`, `0.2` and `latest` for linux/amd64 and linux/arm64.
5. [ ] **Make both GHCR packages public** (package settings, visibility) and check an anonymous pull: `docker logout ghcr.io && docker pull ghcr.io/aldyernesto/shotstash:0.2.0`.
6. [ ] **README badges**: the release badge shows v0.2.0; add the container image badge linking to the GHCR package now that it exists.
7. [ ] **Demo live** (owner), following the docs guide "Run a public demo" (https://aldyernesto.github.io/shotstash/docs/demo/):
   - [ ] server up with TLS on the demo domain, behind the reverse proxy from the networking guide, `TRUST_PROXY=true`;
   - [ ] `SHOTSTASH_DEMO_MODE=true`, a `DEMO_ADMIN_PASSWORD`, and `SETUP_TOKEN` set; first-run setup done by the owner;
   - [ ] demo data seeded inside the container (`docker compose exec -u node app node dist/demo.js seed`), the sign-in page shows the demo accounts;
   - [ ] the nightly reset is scheduled (check the next morning that it ran);
   - [ ] `SHOTSTASH_CORS_ORIGINS` set to the docs origin only (`https://aldyernesto.github.io`, or the docs domain);
   - [ ] repository variable `DEMO_ORIGIN` set to the demo origin, `docs.yml` rerun, and the REST reference try-it console answers from the demo;
   - [ ] external uptime monitor on the demo's `/api/health`.
8. [ ] **README demo link**: uncomment the demo line in the README and fill in the URL; replace `<demo-url>` in `launch/`.
9. [ ] **Last look**: open the repository page logged out, on a phone and a desktop. Banner, tagline, GIF, one-line install, badges and demo link all render; every link works.

## Posts

10. [ ] Posts in the order and on the days in [schedule.md](schedule.md): Show HN first, r/selfhosted a few days later, Product Hunt optional, awesome-selfhosted only once the first release is older than four months.

## Still open after launch (owner)

- [ ] Watch issues daily for the first two weeks; first reply within a week at most (CONTRIBUTING promise).
- [ ] Record stars, issues and demo traffic at day 14 and at three months.
- [ ] awesome-selfhosted submission on its date ([awesome-selfhosted.md](awesome-selfhosted.md)).
