#!/bin/sh
# Shotstash preflight (Story 6.2): run before `docker compose up -d`.
# Checks that Docker is available, that .env exists with valid secrets
# (SESSION_SECRET, POSTGRES_PASSWORD, WORKER_BOOTSTRAP_TOKEN), and that the
# app's host port is free.
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

value() {
  # Last assignment of $1 in .env: CR (Windows line ends) and one pair of
  # surrounding double or single quotes removed.
  sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

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
