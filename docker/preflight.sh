#!/bin/sh
# Shotstash preflight (Story 6.2): run before `docker compose up -d`.
# Checks that Docker is available, that Docker Compose is new enough for the
# compose files in use (2.24.4 for the images and demo overrides), that .env
# exists with valid secrets (SESSION_SECRET, POSTGRES_PASSWORD,
# WORKER_BOOTSTRAP_TOKEN), and that the app's host port is free. Warns when
# no published image exists for this machine's architecture.
#
#   sh docker/preflight.sh
set -u

cd "$(dirname "$0")/.." || exit 1
fail=0

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH. Install Docker Engine (Linux) or Docker Desktop (macOS, Windows)."
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "The Docker Compose plugin is missing. Install it, then run this again."
  exit 1
fi

if [ ! -f .env ]; then
  echo "No .env file. Create it with: cp .env.example .env"
  exit 1
fi

BUILD_FROM_SOURCE="https://aldyernesto.github.io/shotstash/docs/quick-start/#build-from-source"
MIN_COMPOSE="2.24.4"

# ok, old or unknown: is Docker Compose version $1 (2.31.0, v2.24.4,
# 2.29.1-desktop.1) at least MIN_COMPOSE?
compose_version_check() {
  printf '%s
' "$1" | awk -F. -v min="$MIN_COMPOSE" '
    NR == 1 {
      sub(/^v/, "", $1)
      if ($1 !~ /^[0-9]+$/ || $2 !~ /^[0-9]+/) { print "unknown"; exit }
      split(min, m, ".")
      a = $1 + 0; b = $2 + 0; c = $3 + 0
      if (a != m[1]) { print (a > m[1] ? "ok" : "old"); exit }
      if (b != m[2]) { print (b > m[2] ? "ok" : "old"); exit }
      print (c >= m[3] ? "ok" : "old"); exit
    }
    END { if (NR == 0) print "unknown" }'
}

value() {
  # Last assignment of $1 in .env: CR (Windows line ends) and one pair of
  # surrounding double or single quotes removed.
  sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

# docker compose prefers an exported COMPOSE_FILE over .env; so does this check.
compose_file="${COMPOSE_FILE:-$(value COMPOSE_FILE)}"
compose_version="$(docker compose version --short 2>/dev/null | tr -d '' | head -n 1)"
case "$(compose_version_check "$compose_version")" in
  ok) ;;
  old)
    case "$compose_file" in
      *docker-compose.images.yml* | *docker-compose.demo.yml*)
        echo "Docker Compose $compose_version is too old: the published images need Docker Compose $MIN_COMPOSE or newer (docker-compose.images.yml and docker-compose.demo.yml use !reset and !override)."
        echo "Update Docker Desktop, or the docker-compose-plugin package from Docker's repository on Linux, then run this again."
        echo "To keep this Compose version, build from source instead: $BUILD_FROM_SOURCE"
        fail=1
        ;;
      *)
        echo "Warning: Docker Compose $compose_version is older than $MIN_COMPOSE. Building from source works, but the published images (docker-compose.images.yml) need $MIN_COMPOSE or newer."
        ;;
    esac
    ;;
  *)
    echo "Warning: could not read the Docker Compose version (got: ${compose_version:-nothing}). Shotstash needs Docker Compose $MIN_COMPOSE or newer."
    ;;
esac

case "$(uname -m 2>/dev/null)" in
  x86_64 | amd64 | aarch64 | arm64) ;;
  *)
    echo "Warning: no published Shotstash image exists for this architecture ($(uname -m 2>/dev/null || echo unknown)); the images are linux/amd64 and linux/arm64. Build from source instead: $BUILD_FROM_SOURCE"
    ;;
esac

session="$(value SESSION_SECRET)"
if [ "${#session}" -lt 32 ]; then
  echo "SESSION_SECRET in .env is missing or shorter than 32 characters. Generate one with: openssl rand -hex 32"
  fail=1
fi

pg="$(value POSTGRES_PASSWORD)"
if [ -z "$pg" ]; then
  echo "POSTGRES_PASSWORD is empty in .env. Generate one with: openssl rand -hex 32"
  fail=1
elif ! printf '%s' "$pg" | grep -Eq '^[A-Za-z0-9_-]+$'; then
  echo "POSTGRES_PASSWORD may only contain letters, digits, - and _ (it goes into a database URL). Generate one with: openssl rand -hex 32"
  fail=1
fi

worker_token="$(value WORKER_BOOTSTRAP_TOKEN)"
if [ "${#worker_token}" -lt 32 ]; then
  echo "WORKER_BOOTSTRAP_TOKEN in .env is missing or shorter than 32 characters (the processing worker registers with it). Generate one with: openssl rand -hex 32"
  fail=1
elif [ "$worker_token" = "$session" ]; then
  echo "WORKER_BOOTSTRAP_TOKEN must differ from SESSION_SECRET. Generate its own with: openssl rand -hex 32"
  fail=1
fi

# docker compose prefers an exported SHOTSTASH_PORT over .env; so does this check.
port="${SHOTSTASH_PORT:-$(value SHOTSTASH_PORT)}"
port="${port:-3005}"
if ! printf '%s' "$port" | grep -Eq '^[0-9]+$' || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  echo "SHOTSTASH_PORT must be a port number (1 to 65535), got: $port"
  exit 1
fi

in_use=0
checked=1
if command -v ss >/dev/null 2>&1; then
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$port\$" && in_use=1
elif command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && in_use=1
elif command -v nc >/dev/null 2>&1; then
  nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && in_use=1
else
  checked=0
  echo "Cannot check port $port (install ss, lsof or nc)."
fi
if [ "$in_use" = 1 ]; then
  # A running Shotstash of this checkout holds the port legitimately.
  if docker compose ps --status running --services 2>/dev/null | grep -qx app; then
    echo "Port $port is used by this Shotstash (already running)."
  else
    echo "Port $port is in use. Set SHOTSTASH_PORT in .env to a free port (and APP_URL to match)."
    fail=1
  fi
fi

if [ "$fail" = 0 ]; then
  if [ "$checked" = 1 ]; then
    echo "Preflight passed. Start Shotstash with: docker compose up -d"
  else
    echo "Preflight passed except the port check. Start Shotstash with: docker compose up -d"
  fi
fi
exit "$fail"
