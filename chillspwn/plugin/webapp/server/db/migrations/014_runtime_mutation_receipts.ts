import type { Migration } from "../types";

export const runtimeMutationReceiptsMigration: Migration = {
  version: 14,
  name: "runtime_mutation_receipts",
  sql: `
CREATE TABLE runtime_mutation_receipts (
  receipt_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('in_progress', 'succeeded', 'failed')),
  owner_token TEXT,
  lease_expires_at TEXT,
  boundary_json TEXT CHECK (boundary_json IS NULL OR json_valid(boundary_json)),
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (
    (state = 'in_progress' AND owner_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND response_json IS NULL AND error_json IS NULL AND completed_at IS NULL)
    OR
    (state = 'succeeded' AND owner_token IS NULL AND lease_expires_at IS NULL
      AND response_json IS NOT NULL AND error_json IS NULL AND completed_at IS NOT NULL)
    OR
    (state = 'failed' AND owner_token IS NULL AND lease_expires_at IS NULL
      AND response_json IS NULL AND error_json IS NOT NULL AND completed_at IS NOT NULL)
  )
) STRICT;

CREATE INDEX idx_runtime_mutation_receipts_state_lease
  ON runtime_mutation_receipts(state, lease_expires_at, updated_at);

-- Preserve the route receipts written by the pre-v14 settings-backed implementation.
-- Completed responses remain replayable. Interrupted reservations are imported with an
-- already-expired lease and no fabricated boundary, so the new runtime fails closed
-- unless an exact canonical audit receipt can prove what committed.
INSERT INTO runtime_mutation_receipts (
  receipt_key, request_hash, actor_id, state, owner_token, lease_expires_at,
  boundary_json, response_json, error_json, started_at, completed_at, updated_at
)
SELECT
  key,
  json_extract(value_json, '$.requestHash'),
  COALESCE(json_extract(value_json, '$.actorId'), updated_by),
  CASE
    WHEN json_extract(value_json, '$.state') = 'in_progress'
      OR json_type(value_json, '$.response') IS NULL
    THEN 'in_progress'
    ELSE 'succeeded'
  END,
  CASE
    WHEN json_extract(value_json, '$.state') = 'in_progress'
      OR json_type(value_json, '$.response') IS NULL
    THEN COALESCE(
      json_extract(value_json, '$.ownerToken'),
      'migrated:' || substr(key, length(key) - 63, 64)
    )
    ELSE NULL
  END,
  CASE
    WHEN json_extract(value_json, '$.state') = 'in_progress'
      OR json_type(value_json, '$.response') IS NULL
    THEN updated_at
    ELSE NULL
  END,
  NULL,
  CASE
    WHEN COALESCE(json_extract(value_json, '$.state'), 'succeeded') <> 'in_progress'
      AND json_type(value_json, '$.response') IS NOT NULL
    THEN value_json -> '$.response'
    ELSE NULL
  END,
  NULL,
  COALESCE(json_extract(value_json, '$.startedAt'), updated_at),
  CASE
    WHEN COALESCE(json_extract(value_json, '$.state'), 'succeeded') <> 'in_progress'
      AND json_type(value_json, '$.response') IS NOT NULL
    THEN COALESCE(json_extract(value_json, '$.completedAt'), updated_at)
    ELSE NULL
  END,
  updated_at
FROM settings
WHERE key GLOB 'idempotency.runtime.*'
  AND json_type(value_json, '$.requestHash') = 'text';
`,
};
