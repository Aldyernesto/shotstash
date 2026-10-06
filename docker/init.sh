#!/bin/sh
# Shotstash init (Story 8.1): the one-line install's first step.
#
#   sh docker/init.sh && docker compose up -d
#
# Creates .env from .env.example with a random value for every secret the
# operator would otherwise generate (SESSION_SECRET, MEDIA_SIGNING_SECRET,
# SETUP_TOKEN, WORKER_BOOTSTRAP_TOKEN, POSTGRES_PASSWORD), then runs the
# preflight. An existing .env is never overwritten (only the preflight runs).
# No secret is printed. Needs openssl or /dev/urandom with od.
set -u

cd "$(dirname "$0")/.." || exit 1

SECRETS="SESSION_SECRET MEDIA_SIGNING_SECRET SETUP_TOKEN WORKER_BOOTSTRAP_TOKEN POSTGRES_PASSWORD"

random_hex() {
  # 32 random bytes as 64 hex characters (letters and digits only: safe in a database URL).
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    echo
  else
    return 1
  fi
}

if [ -f .env ]; then
  echo ".env already exists: kept as it is (delete it first to start over)."
else
  if [ ! -f .env.example ]; then
    echo "No .env.example next to docker/: run this from a Shotstash checkout."
    exit 1
  fi
  umask 077
  tmp=".env.init.$$"
  cp .env.example "$tmp" || exit 1
  for name in $SECRETS; do
    value="$(random_hex)" || {
      rm -f "$tmp"
      echo "Cannot generate random values: install openssl."
      exit 1
    }
    if [ "${#value}" -ne 64 ]; then
      rm -f "$tmp"
      echo "Cannot generate random values: install openssl."
      exit 1
    fi
    # Replace the empty assignment of the example (first match only).
    sed "s/^$name=\$/$name=$value/" "$tmp" > "$tmp.next" && mv "$tmp.next" "$tmp" || {
      rm -f "$tmp" "$tmp.next"
      exit 1
    }
    if ! grep -q "^$name=$value\$" "$tmp"; then
      rm -f "$tmp"
      echo "Could not set $name in .env (is .env.example from this version?)."
      exit 1
    fi
  done
  mv "$tmp" .env || exit 1
  echo "Created .env with random secrets (SESSION_SECRET, MEDIA_SIGNING_SECRET, SETUP_TOKEN, WORKER_BOOTSTRAP_TOKEN, POSTGRES_PASSWORD)."
  echo "First-run setup asks for SETUP_TOKEN: read it with  grep SETUP_TOKEN .env"
  echo "Set APP_URL in .env to the address people open (LAN IP or domain) before you share links."
fi

sh docker/preflight.sh
