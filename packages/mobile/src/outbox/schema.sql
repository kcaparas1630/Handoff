-- Durable upload outbox (architecture.md section 7). It holds identifiers, attempt state, and a
-- file reference only: no transcript, no draft text, and no decrypted server records
-- (docs/pii-encryption.md, "Other copies and deliberate limits").
CREATE TABLE IF NOT EXISTS outbox_captures (
  local_id TEXT PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  client_capture_id TEXT NOT NULL UNIQUE,
  capture_id TEXT NULL,
  asset_id TEXT NULL,
  file_uri TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  locale TEXT NOT NULL,
  care_session_id TEXT NULL,
  stage TEXT NOT NULL CHECK (
    stage IN ('saved_locally', 'capture_created', 'uploaded', 'completed', 'failed')
  ),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT NULL,
  next_attempt_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Account switching must never upload another account's recordings, so every read is scoped by
-- the signed-in Clerk user first.
CREATE INDEX IF NOT EXISTS outbox_captures_user_stage_idx
  ON outbox_captures (clerk_user_id, stage);

CREATE INDEX IF NOT EXISTS outbox_captures_child_idx
  ON outbox_captures (clerk_user_id, child_id);
