#!/bin/sh
# Applies pending migrations (docker-migrate.sh: backup first), then starts
# the Next.js server.
#
#   SKIP_MIGRATIONS=true   don't touch the schema (another process migrates)
#   KLEDG_BACKUP, KLEDG_BACKUP_DIR, KLEDG_BACKUP_KEEP: see docker-migrate.sh
#
# With arguments, runs them instead: hosts that replace the command but keep
# the entrypoint (Fly.io release_command, pre-deploy commands) run
# /app/docker-migrate.sh this way.
set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ "${SKIP_MIGRATIONS:-false}" != "true" ]; then
  /app/docker-migrate.sh
fi
exec node server.js
