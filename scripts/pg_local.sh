#!/bin/bash
# Levanta un Postgres local para pruebas (puerto 54329, sin clave, datos en /var/tmp/md58pg). Solo para desarrollo.
# Uso: bash scripts/pg_local.sh   →   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres npm test
set -e
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1); D=/var/tmp/md58pg
mkdir -p $D && chown postgres $D
[ -f $D/data/PG_VERSION ] || su postgres -c "$BIN/initdb -D $D/data -A trust -U postgres >/dev/null"
su postgres -c "$BIN/pg_ctl -D $D/data -o '-p 54329 -k $D' -l $D/log status >/dev/null || $BIN/pg_ctl -D $D/data -o '-p 54329 -k $D' -l $D/log start"
