# Security policy

Thank you for helping keep Shotstash and the people who run it safe.

## Supported versions

Shotstash is pre-release. Until 1.0.0, security fixes go into the latest release and the `main` branch only; upgrade to get them. From 1.0.0 on, the latest minor release of the current major version receives security fixes.

| Version | Security fixes |
| --- | --- |
| latest release, `main` | yes |
| older releases | no, upgrade first |

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub security advisories: open the repository's Security tab and choose "Report a vulnerability" ([direct link](../../security/advisories/new)). Do not open a public issue, pull request or discussion for a security problem.

A useful report says:

- what an attacker can do, and which role or access they need (none, a share link, a viewer account, a worker token);
- the version or commit, and how Shotstash runs (docker compose, behind which proxy, which storage backend);
- the steps to reproduce, ideally against a fresh install with throwaway data.

Never include real media, personal data or secrets from a live installation.

## What to expect

- An acknowledgement within 7 days.
- An assessment (accepted or not, and why) within 14 days.
- For accepted reports, a fix and a release as soon as the fix is ready, with a GitHub security advisory that credits you unless you prefer otherwise. We coordinate the disclosure date with you; the default is when the fixed release is out.

Shotstash is maintained by volunteers, so these are goals, not contractual deadlines. There is no bug bounty.

## Scope

In scope: the code in this repository (the app, the reference worker, the Docker images and compose files, the docs site).

Out of scope: installations run by other people (report to their operator), denial of service by sheer traffic volume, findings that need an already compromised server or a super admin acting against their own instance, and missing hardening that has no concrete exploit (the [architecture page](docs/content/docs/architecture.mdx) lists what is deliberately deferred, such as a nonce-based Content Security Policy).

## How Shotstash is hardened

The route-by-route authorization table is generated from the code into [docs/security/route-matrix.md](docs/security/route-matrix.md). Every push runs a secret scan and a privacy scan, and a dependency audit fails CI on unlisted high or critical advisories.
