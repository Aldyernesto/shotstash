#!/bin/sh
# Shotstash container entrypoint (Stories 6.1, 6.2).
#
# 1. As root (only then): create the media directory and give it to the app
#    user when that user cannot write it (a bind mount owned by root), then
#    drop privileges with setpriv and run this script again as that user.
# 2. As the app user: apply database migrations, then exec the server so
#    SIGTERM from `docker stop` reaches node.
#
# Any other command (`docker compose run --rm app npx prisma migrate status`)
# runs as the app user without migrations.
set -eu

APP_USER=node
MEDIA_DIR="${STORAGE_LOCAL_ROOT:-/data/media}"

if [ "$(id -u)" = "0" ]; then
  cannot_fix() {
    cat >&2 <<MSG
entrypoint: cannot give $MEDIA_DIR to the app user (uid $(id -u "$APP_USER")).
The media folder is probably on NFS (root_squash) or a CIFS/SMB share, where
root in the container may not change owners. On the host, make the folder
(./data/media next to docker-compose.yml) writable by uid $(id -u "$APP_USER"), for example:

  sudo chown -R $(id -u "$APP_USER"):$(id -g "$APP_USER") ./data/media

or mount the share with uid=$(id -u "$APP_USER"),gid=$(id -g "$APP_USER").
MSG
    exit 1
  }
  mkdir -p "$MEDIA_DIR" || cannot_fix
  # Anything inside not owned by the app user (a root-owned subfolder too) needs fixing.
  if [ -n "$(find "$MEDIA_DIR" ! -user "$APP_USER" -print -quit 2>/dev/null)" ] \
    || ! setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups test -w "$MEDIA_DIR"; then
    echo "entrypoint: giving $MEDIA_DIR to $APP_USER"
    chown -R "$APP_USER:$APP_USER" "$MEDIA_DIR" || cannot_fix
  fi
  exec setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups "$0" "$@"
fi

if [ "$*" != "node dist/server.js" ]; then
  exec "$@"
fi

echo "entrypoint: applying database migrations"
if ! node_modules/.bin/prisma migrate deploy; then
  cat >&2 <<'MSG'

entrypoint: the database migration failed, so Shotstash did not start.

  Read the error above, or all logs:  docker compose logs app
  Is the database running?            docker compose ps db
  Show the migration state:           docker compose run --rm app npx prisma migrate status

Before v1.0.0, databases are throwaway: when a migration cannot be fixed,
start over with an empty database (this deletes all accounts and metadata;
back up ./data/media first if you want to keep the files):

  docker compose down -v && docker compose up -d

MSG
  exit 1
fi

exec node dist/server.js
