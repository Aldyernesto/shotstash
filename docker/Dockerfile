# syntax=docker/dockerfile:1
# Shotstash app image (Story 6.1): Next.js app plus the compiled custom
# server (dist/server.js), ffmpeg for thumbnails, non-root at runtime.
# Built with no .env present: every setting is read at runtime.
#
#   docker build -f docker/Dockerfile --build-arg VERSION=1.2.3 -t shotstash .

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------- deps: every dependency, installed from the lockfile ----------
FROM ${NODE_IMAGE} AS deps
# openssl lets Prisma pick the same engine build the runtime stage needs
# (the runtime gets openssl through ca-certificates).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------- build: Next app, custom server, production node_modules ----------
FROM deps AS build
COPY . .
# The Prisma client is generated before the build (types) and again after
# pruning (pruning may drop it). The URL is a placeholder: generate never
# connects, and this stage is not part of the runtime image.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev --no-audit --no-fund \
 && npx prisma generate

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.title="Shotstash" \
      org.opencontainers.image.description="Self-hosted media cloud for creators" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/Aldyernesto/shotstash" \
      org.opencontainers.image.version="${VERSION}"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3005 \
    STORAGE_LOCAL_ROOT=/data/media \
    SHOTSTASH_VERSION=${VERSION}

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/package-lock.json /app/next.config.ts /app/prisma.config.ts ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/public ./public
COPY --from=build /app/messages ./messages
COPY --from=build /app/dist ./dist
# Next writes its cache under .next at runtime: owned by the app user.
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/shotstash-entrypoint

RUN mkdir -p /data/media && chown node:node /data/media

EXPOSE 3005
VOLUME ["/data/media"]

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3005)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Starts as root only to make /data/media writable, then runs as `node` (uid 1000).
ENTRYPOINT ["shotstash-entrypoint"]
CMD ["node", "dist/server.js"]
