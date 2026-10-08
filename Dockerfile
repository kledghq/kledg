# Kledg production image: docker build -t kledg . ; see docs/self-hosting.md
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Shown on the "Mises à jour" page: docker build --build-arg KLEDG_COMMIT=$(git rev-parse HEAD) .
ARG KLEDG_BUILD_DATE=""
ENV NEXT_TELEMETRY_DISABLED=1 KLEDG_BUILD_DATE=${KLEDG_BUILD_DATE}
RUN pnpm prisma generate && pnpm next build

# Migration tooling only (the standalone server does not ship the Prisma CLI).
FROM base AS migrator
WORKDIR /migrator
RUN npm init -y >/dev/null && npm install --no-audit --no-fund prisma@7.7.0 dotenv@17.4.2

FROM node:22-alpine AS runner
WORKDIR /app
# Version and commit of the image, read by lib/updates/version.ts.
ARG KLEDG_COMMIT=""
ARG KLEDG_VERSION=""
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
  KLEDG_RUNTIME=docker KLEDG_COMMIT=${KLEDG_COMMIT} KLEDG_VERSION=${KLEDG_VERSION}
# postgresql18-client: pg_dump for the backup taken before each migration (dumps
# PostgreSQL 9.2 to 18 servers, so any managed version). /app/storage: receipt
# files of the filesystem driver (KLEDG_STORAGE_DIR), mounted as a volume.
RUN apk add --no-cache postgresql18-client \
  && addgroup -S kledg && adduser -S kledg -G kledg \
  && mkdir -p /app/backups /app/storage && chown kledg:kledg /app/backups /app/storage \
  && chmod 700 /app/storage
COPY --from=build --chown=kledg:kledg /app/.next/standalone ./
COPY --from=build --chown=kledg:kledg /app/.next/static ./.next/static
COPY --from=build --chown=kledg:kledg /app/public ./public
COPY --from=build --chown=kledg:kledg /app/prisma ./prisma
COPY --from=build --chown=kledg:kledg /app/prisma.config.ts ./prisma.config.ts
COPY --from=migrator --chown=kledg:kledg /migrator/node_modules ./migrator/node_modules
COPY --chown=kledg:kledg docker-entrypoint.sh docker-migrate.sh ./
# Executable even from a checkout that lost the mode bits (Windows clones).
RUN chmod 755 docker-entrypoint.sh docker-migrate.sh
USER kledg
EXPOSE 3000
# PORT: hosts may set their own (Render 10000, Clever Cloud 8080); /api/health checks the database too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
