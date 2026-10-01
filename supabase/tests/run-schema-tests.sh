#!/usr/bin/env bash
#
# Applies every MAGI migration to a throwaway Postgres database and runs the schema
# assertions in schema-test.sql. Nothing here touches a hosted Supabase project.
#
# Requirements: postgresql-16 and postgresql-16-pgvector on PATH.
#
# Usage:  ./supabase/tests/run-schema-tests.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/tmp/magi-pgdata}"
PGPORT="${PGPORT:-5433}"
PGHOST=/tmp
DB=magi_test

export PATH="$PGBIN:$PATH"

if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  if [ ! -d "$PGDATA" ]; then
    echo "==> initialising throwaway cluster at $PGDATA"
    initdb -D "$PGDATA" -A trust >/dev/null
  fi
  echo "==> starting postgres on port $PGPORT"
  pg_ctl -D "$PGDATA" -l /tmp/magi-pg.log -o "-k $PGHOST -p $PGPORT" start >/dev/null
  sleep 2
fi

psql -h "$PGHOST" -p "$PGPORT" -U "$(whoami)" -q \
  -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" postgres

run() { psql -h "$PGHOST" -p "$PGPORT" -U "$(whoami)" -d "$DB" -v ON_ERROR_STOP=1 -q -f "$1"; }

echo "==> applying supabase stand-in harness"
run "$HERE/supabase-harness.sql"

echo "==> applying migrations"
for f in "$MIGRATIONS"/*.sql; do
  printf '    %-52s' "$(basename "$f")"
  run "$f" && echo "ok"
done

echo "==> running assertions"
psql -h "$PGHOST" -p "$PGPORT" -U "$(whoami)" -d "$DB" -v ON_ERROR_STOP=1 \
  -f "$HERE/schema-test.sql" 2>&1 | grep -E 'PASS|FAIL|LEAK|ERROR|---'

echo "==> done"
