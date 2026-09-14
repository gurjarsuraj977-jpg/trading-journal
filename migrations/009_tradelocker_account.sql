-- GhostTrader V9 - TradeLocker Phase 1 Table

CREATE TABLE IF NOT EXISTS tradelocker_connections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL,
  server VARCHAR(128) NOT NULL,
  account_id VARCHAR(64),
  acc_num INTEGER,
  account_name VARCHAR(128),
  currency VARCHAR(16),
  status VARCHAR(32),
  last_error TEXT,
  last_connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_tradelocker_connections_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_tradelocker_connections_user_id
ON tradelocker_connections(user_id);
