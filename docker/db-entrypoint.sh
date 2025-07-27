#!/bin/sh
set -e
/usr/local/bin/docker-entrypoint.sh postgres &
pid=$!
until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do
  sleep 1
done
bunx drizzle-kit migrate || { echo "Migration failed"; kill $pid; exit 1; }
wait "$pid"
