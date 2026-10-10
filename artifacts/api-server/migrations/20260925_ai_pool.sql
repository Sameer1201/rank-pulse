CREATE TABLE IF NOT EXISTS ai_account_cooldowns (
  account_key TEXT PRIMARY KEY,
  blocked_until INTEGER NOT NULL,
  reason TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_response_cache (
  cache_key TEXT PRIMARY KEY,
  response_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_response_cache_expires_at ON ai_response_cache(expires_at);
