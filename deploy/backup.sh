#!/usr/bin/env sh
# Nightly PostgreSQL backup (cron: 15 3 * * * /opt/rajar-x-yt/deploy/backup.sh).
# Only the database is backed up — temporary media is never backed up by design.
set -eu
DEST="${BACKUP_DIR:-/var/backups/rajar-x}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DEST"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose -f "$(dirname "$0")/../docker-compose.yml" exec -T postgres \
  pg_dump -U rajarx -d rajarx --format=custom --no-owner > "$DEST/rajarx-$STAMP.dump"
find "$DEST" -name 'rajarx-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $DEST/rajarx-$STAMP.dump"
