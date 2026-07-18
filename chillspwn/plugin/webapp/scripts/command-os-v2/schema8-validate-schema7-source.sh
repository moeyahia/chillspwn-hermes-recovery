#!/usr/bin/env bash

set -euo pipefail

[[ $# -eq 1 ]] || {
  echo "usage: schema8-validate-schema7-source.sh PLUGIN_ROOT" >&2
  exit 64
}

PLUGIN_ROOT="$(realpath -m -- "$1")"
MIGRATIONS="$PLUGIN_ROOT/webapp/server/db/migrations"

[[ -d "$PLUGIN_ROOT" && ! -L "$PLUGIN_ROOT" ]] || {
  echo "schema-7 source is not a real plugin directory: $PLUGIN_ROOT" >&2
  exit 66
}
[[ -f "$MIGRATIONS/007_audit_journey.ts" ]] || {
  echo "schema-7 source lacks migration 007" >&2
  exit 66
}
[[ -f "$MIGRATIONS/index.ts" ]] || {
  echo "schema-7 source lacks the migration index" >&2
  exit 66
}
[[ ! -e "$MIGRATIONS/008_follow_up_context.ts" ]] || {
  echo "source is not schema 7: migration 008 is already present" >&2
  exit 65
}

latest="$(find "$MIGRATIONS" -maxdepth 1 -type f -name '[0-9][0-9][0-9]_*.ts' -printf '%f\n' | LC_ALL=C sort | tail -n 1)"
[[ "$latest" == "007_audit_journey.ts" ]] || {
  echo "source is not the exact schema-7 migration set: latest=$latest" >&2
  exit 65
}
[[ "$(grep -Fxc 'import { auditJourneyMigration } from "./007_audit_journey";' "$MIGRATIONS/index.ts")" == "1" ]] || {
  echo "schema-7 source lacks the exact migration-007 import anchor" >&2
  exit 65
}
[[ "$(grep -Fxc '  auditJourneyMigration,' "$MIGRATIONS/index.ts")" == "1" ]] || {
  echo "schema-7 source lacks the exact migration-007 registration anchor" >&2
  exit 65
}
[[ "$(grep -Fc 'followUpContextMigration' "$MIGRATIONS/index.ts")" == "0" ]] || {
  echo "source is not schema 7: migration 008 is registered" >&2
  exit 65
}

printf 'schema7_source_valid\t%s\n' "$PLUGIN_ROOT"
