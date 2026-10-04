#!/bin/sh
# Backs up the database when migrations are pending, then applies them.
# Run by docker-entrypoint.sh at start, or alone as a platform's release or
# pre-deploy command (Fly.io release_command, Render preDeployCommand,
# Railway preDeployCommand): /app/docker-migrate.sh
#
#   KLEDG_BACKUP=off       skip the pre-migration backup (hosts whose disk is
#                          wiped at each deploy: rely on their database backups)
#   KLEDG_BACKUP_DIR       where backups go (default /app/backups; mount a volume)
#   KLEDG_BACKUP_KEEP      how many backups to keep (default 5)
#
# Concurrent runs are safe: `prisma migrate deploy` takes an advisory lock and
# skips migrations already applied.
set -e

prisma() {
  NODE_PATH=/app/migrator/node_modules node /app/migrator/node_modules/prisma/build/index.js "$@"
}

database_url() {
  # Same order as prisma.config.ts: the owner's direct connection first.
  for url in "$DATABASE_MIGRATION_URL" "$DATABASE_URL_UNPOOLED" "$POSTGRES_URL_NON_POOLING" "$DATABASE_URL" "$POSTGRES_URL" "$POSTGRESQL_ADDON_URI"; do
    if [ -n "$url" ]; then
      printf '%s' "$url"
      return
    fi
  done
}

backup() {
  dir="${KLEDG_BACKUP_DIR:-/app/backups}"
  # Drop Prisma-only parameters that libpq rejects.
  url=$(database_url | sed -E 's/([?&])(pgbouncer|connection_limit|pool_timeout|schema|socket_timeout)=[^&]*/\1/g; s/[?&]+$//; s/\?&+/?/; s/&&+/\&/g')
  file="$dir/kledg-$(date -u +%Y%m%dT%H%M%SZ).dump"
  mkdir -p "$dir"
  echo "Pending migrations: backing up the database to $file"
  # A failed backup stops the start: better no upgrade than an upgrade without a way back.
  pg_dump --format=custom --no-owner --file="$file" "$url"
  ls -1t "$dir"/kledg-*.dump 2>/dev/null | tail -n +"$((${KLEDG_BACKUP_KEEP:-5} + 1))" | xargs -r rm -f
}

if [ -z "$(database_url)" ]; then
  echo "DATABASE_URL is not set: point it at your PostgreSQL database (docs/self-hosting.md)." >&2
  exit 1
fi

# `migrate status` exits non-zero when migrations are pending (or the
# database is empty, where the backup is harmless).
if [ "${KLEDG_BACKUP:-on}" != "off" ] && ! prisma migrate status >/dev/null 2>&1; then
  backup
fi
prisma migrate deploy
