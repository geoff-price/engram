-- Database-level Telegram message dedup
-- Prevents duplicate processing across serverless cold starts

CREATE TABLE IF NOT EXISTS processed_messages (
  message_id  BIGINT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-cleanup: delete entries older than 24 hours
-- (Telegram only retries within minutes, so 24h is very generous)
CREATE INDEX IF NOT EXISTS idx_processed_messages_at
  ON processed_messages (processed_at);
