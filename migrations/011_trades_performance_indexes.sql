-- GhostTrader V8 — Fix Batch 2: trades performance indexes
--
-- The trades table previously had no index beyond its primary key
-- and the existing TradeLocker uq_trades_tradelocker_position
-- partial unique index. These indexes support existing, already-
-- shipped query patterns:
--
--   idx_trades_user_date    -> WHERE user_id = $1 [AND trade_date ...]
--                              ORDER BY trade_date [DESC]
--                              (GET /api/trades, calendar, analytics,
--                              premium/insights, CSV export, AI coach)
--
--   idx_trades_user_account -> WHERE user_id = $1 AND account = $2
--                              (accounts list JOIN, execution lab,
--                              analytics/premium account filter,
--                              simulation account filter)
--
--   idx_trades_user_symbol  -> WHERE user_id = $1 AND symbol = $2
--                              (simulation symbol filter)
--
-- This migration is idempotent (IF NOT EXISTS) and additive only:
-- no existing index, constraint, or data is modified or removed.
--
-- NOTE: these same statements are also applied directly in
-- db/init.js, which is the mechanism this project actually runs
-- on every boot. This file exists to keep the numbered migrations/
-- directory consistent with prior entries (008/009/010); it is not
-- itself executed by any script in this project.

CREATE INDEX IF NOT EXISTS idx_trades_user_date
  ON trades(user_id, trade_date);

CREATE INDEX IF NOT EXISTS idx_trades_user_account
  ON trades(user_id, account);

CREATE INDEX IF NOT EXISTS idx_trades_user_symbol
  ON trades(user_id, symbol);
