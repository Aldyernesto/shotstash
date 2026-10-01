# syntax=docker/dockerfile:1
# Shotstash reference worker image (Story 5.3): Node 24 and ffmpeg, makes
# 720p H.264/AAC proxies through the worker contract. No npm dependencies;
# the build context is the repository root, filtered by
# docker/worker.Dockerfile.dockerignore to the worker/ folder only.
#
#   docker build -f docker/worker.Dockerfile --build-arg VERSION=1.2.3 \
#     --build-arg SOURCE_URL=https://github.com/<owner>/shotstash -t shotstash-worker .

ARG NODE_IMAGE=node:24-trixie-slim

FROM ${NODE_IMAGE}
ARG VERSION=dev
# The repository URL, passed by the release workflow (server URL plus owner/repo),
# so the label follows the repository wherever it lives. Empty for local builds.
ARG SOURCE_URL=
LABEL org.opencontainers.image.title="Shotstash worker" \
      org.opencontainers.image.description="Reference processing worker for Shotstash (720p proxies with ffmpeg)" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="${SOURCE_URL}" \
      org.opencontainers.image.version="${VERSION}"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /worker
ENV NODE_ENV=production \
    WORKER_HEALTH_PORT=8080 \
    WORKER_TMP_DIR=/tmp
COPY worker/package.json ./package.json
COPY worker/src ./src

# Runs as the image's unprivileged `node` user (uid 1000); scratch files go to /tmp.
USER node
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/main.mjs"]
