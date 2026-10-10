# Changelog

## [0.4.1](https://github.com/Aldyernesto/shotstash/compare/v0.4.0...v0.4.1) (2026-10-10)


### Bug fixes

* **install:** preflight no longer reports a free port as taken on BusyBox ([a46b8e2](https://github.com/Aldyernesto/shotstash/commit/a46b8e21123aa40d7ea8b4fdb53c05e859759e9e))


### Documentation

* **launch:** Show HN text with verified install time, test coverage and harder answers ([752d103](https://github.com/Aldyernesto/shotstash/commit/752d1034da682d76edbf82dfdf17ff9b0e72b3d8))

## [0.4.0](https://github.com/Aldyernesto/shotstash/compare/v0.3.0...v0.4.0) (2026-10-07)


### Features

* **install:** the one-line install pulls the published images ([d6d8682](https://github.com/Aldyernesto/shotstash/commit/d6d86824950de7b2676f7b93ebb684286c452074))
* **promo:** 30-second launch trailer, playable in the browser ([bc9efc6](https://github.com/Aldyernesto/shotstash/commit/bc9efc6a8ed63f201f84c1d2d8a4b5374c4bcecd))

## [0.3.0](https://github.com/Aldyernesto/shotstash/compare/v0.2.0...v0.3.0) (2026-10-07)


### Features

* **admin:** read-only admins open the Admin Panel to look ([48741e2](https://github.com/Aldyernesto/shotstash/commit/48741e2f47a76c822fe4f7b59d776be1cb947409))
* repository face, public demo mode and launch kit ([a28beb2](https://github.com/Aldyernesto/shotstash/commit/a28beb2146a54f2bf81dd2dc616b58f98d99a259))


### Bug fixes

* **demo:** review fixes for demo privacy, reset, sessions and try-it ([0aaaa62](https://github.com/Aldyernesto/shotstash/commit/0aaaa62fe7028f533b5e5e920f1b7fe796c7dae5))
* **share:** let every role list share links ([0e8cbcf](https://github.com/Aldyernesto/shotstash/commit/0e8cbcfed981955be9a6e217310e70adf774983b))


### Documentation

* link the live demo; note memlock and limits for unprivileged LXC hosts ([f7f35b1](https://github.com/Aldyernesto/shotstash/commit/f7f35b1c5e416470d908228bcb0ae34282c08a5a))
* quick start and compose header use docker/init.sh ([62ef8f2](https://github.com/Aldyernesto/shotstash/commit/62ef8f220d54e94a94876e1bb55ed0e1bb767ade))

## [0.2.0](https://github.com/Aldyernesto/shotstash/compare/v0.1.0...v0.2.0) (2026-10-06)


### Features

* brand module, privacy scanner and green CI skeleton ([19b9b35](https://github.com/Aldyernesto/shotstash/commit/19b9b358d29a0eb5a676ce84673479ff3c2ca882))
* **brand:** rebrand Shotstash to the blue three-bar identity ([f216e9b](https://github.com/Aldyernesto/shotstash/commit/f216e9b6e21f6b31e4d26193ace0f0398d0cd5a4))
* **docs:** docs site on GitHub Pages with guides, architecture page and user guide ([3b52113](https://github.com/Aldyernesto/shotstash/commit/3b52113e5a0ef61dd7c5c12215154f665a90752b))
* **i18n:** English for every remaining surface and a mandatory i18n gate ([1900504](https://github.com/Aldyernesto/shotstash/commit/19005045381ebf75f1b8b1da756b9e164b9a7aa5))
* **i18n:** next-intl foundation, English auth and dashboard copy ([4f790b2](https://github.com/Aldyernesto/shotstash/commit/4f790b27500c10a4b5bfe269ba11f641aab823a5))
* initial extraction of Shotstash core ([8d1a64d](https://github.com/Aldyernesto/shotstash/commit/8d1a64da732e2602d43c5b976dc7f7bcfac67a83))
* **media:** thumbnails, processed versions, search parity, 10k library, share 404s and STORE ZIP ([74e2ed8](https://github.com/Aldyernesto/shotstash/commit/74e2ed8ba7ea18e0c0db1947d1ba4ace3b6f29f2))
* **pipeline:** job queue, worker contract v1 and reference proxy worker ([37cbaa5](https://github.com/Aldyernesto/shotstash/commit/37cbaa5b1e7f0b188b7b9f12acfc0b2b9bcd4826))
* **realtime:** pipeline jobs in the UI, ordered realtime through Dragonfly ([72bddcd](https://github.com/Aldyernesto/shotstash/commit/72bddcddca4872e581733e2cd253265f14422ada))
* **release:** full CI gates, release automation, generated GraphQL and OpenAPI references ([bb039b9](https://github.com/Aldyernesto/shotstash/commit/bb039b9c800f314b37065ee7c2edcc031b3b97b6))
* **runtime:** Docker image, compose quick start and runtime config ([8774b1c](https://github.com/Aldyernesto/shotstash/commit/8774b1c7bc2f4f49587de0ed7f7440bd13f55737))
* **security:** holes, first-run setup, edge hardening, trash lifecycle ([21ff304](https://github.com/Aldyernesto/shotstash/commit/21ff304c306e04d6a8a8869daba72c29159795a2))
* **security:** route auth modes, cookie media, signed shares, one permission function ([23243f0](https://github.com/Aldyernesto/shotstash/commit/23243f0c0ccf6cd5c5fd798a9b634552a9fb4b78))
* **storage:** storage backends (local and S3) and resumable uploads with dedup ([0e3aede](https://github.com/Aldyernesto/shotstash/commit/0e3aeded53d32ee7156bc5356a4c8e243130a0f3))


### Bug fixes

* **deps:** patch graphql-tools and sharp advisories ([14609db](https://github.com/Aldyernesto/shotstash/commit/14609db00e1eb6616b6524c4144e4b9be8299310))
* **docs:** platform-neutral docs lockfile; reword the public build-time variable note ([30db1fc](https://github.com/Aldyernesto/shotstash/commit/30db1fc7b71a0e10be9e8ab5aa75e5852d33b3db))
* **docs:** review fixes for the docs site, guides and backup rehearsal ([4c58335](https://github.com/Aldyernesto/shotstash/commit/4c58335ff18f6b3e7ed36240c5add79ac04a977e))
* **media:** review fixes for thumbnails, search, ZIP, shares and the share page layout ([c73a891](https://github.com/Aldyernesto/shotstash/commit/c73a89155740c9875bf067a05dbfea7b6f45ab3c))
* **pipeline:** review fixes for the queue, worker contract and reference worker ([e10b8d5](https://github.com/Aldyernesto/shotstash/commit/e10b8d5de5d4c974226987720ae6bc637b89ed74))
* **realtime:** review fixes for live jobs, streams, mentions and the discussion toggle ([854d4c2](https://github.com/Aldyernesto/shotstash/commit/854d4c217b0dff501541485d99ca5319ab6db9d3))
* **storage:** build the legacy marker path through pathOf (Turbopack traced the media folder) ([c72fd0f](https://github.com/Aldyernesto/shotstash/commit/c72fd0f9c7b306310f4e151c5577f67859c988ed))


### Documentation

* README with positioning, v1 scope, stack and roadmap to the first public release ([1f431dc](https://github.com/Aldyernesto/shotstash/commit/1f431dcbc8ce1ddf363d7b8f064a6084530cd2b6))
* README wording for the extracted core (roles, pipeline, status) ([28d8368](https://github.com/Aldyernesto/shotstash/commit/28d8368ba413b3064cac6b51427bce64f8a6801e))
