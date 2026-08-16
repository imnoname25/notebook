# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --ignore-scripts

FROM base AS production-dependencies
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts \
    && npm cache clean --force

FROM base AS builder
ARG NOTEBOOK_VERSION=0.2.0
ARG NOTEBOOK_GIT_SHA=unknown
ENV NOTEBOOK_VERSION=${NOTEBOOK_VERSION} \
    NOTEBOOK_GIT_SHA=${NOTEBOOK_GIT_SHA}
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate && npm run build

FROM base AS runner
ARG NOTEBOOK_VERSION=0.2.0
ARG NOTEBOOK_GIT_SHA=unknown
ARG NOTEBOOK_CHANNEL=unknown
ARG OCI_SOURCE=https://github.com/imnoname25/notebook
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads \
    BACKUP_DIR=/data/backups \
    HOME=/tmp \
    NOTEBOOK_VERSION=${NOTEBOOK_VERSION} \
    NOTEBOOK_GIT_SHA=${NOTEBOOK_GIT_SHA} \
    NOTEBOOK_CHANNEL=${NOTEBOOK_CHANNEL}
LABEL org.opencontainers.image.title="Notebook" \
      org.opencontainers.image.description="Simple self-hosted digital notebook" \
      org.opencontainers.image.source=${OCI_SOURCE} \
      org.opencontainers.image.version=${NOTEBOOK_VERSION} \
      org.opencontainers.image.revision=${NOTEBOOK_GIT_SHA}
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/package.json ./package.json
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY docker/notebook-entrypoint.sh /usr/local/bin/notebook-entrypoint
COPY docker/preflight.mjs /app/docker/preflight.mjs
RUN mkdir -p /data/uploads /data/backups \
    && chmod 0755 /usr/local/bin/notebook-entrypoint \
    && chmod 0644 /app/docker/preflight.mjs

EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/usr/local/bin/notebook-entrypoint"]
CMD ["node", "server.js"]
