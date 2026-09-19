-- GhostTrader Batch 1C - trades -> accounts relationship (trades.account_id)
--
-- Standalone reference form of the change applied at startup in db/init.js.
--
-- trades.account (free-text VARCHAR name) is left fully intact: several
-- other features (analytics, execution stats, simulation, CSV import,
-- missed trades) still filter/join on it and are out of this batch's
-- scope, so nothing there needs to change. This migration only ADDS
-- trades.account_id alongside it, backfills it from the existing
-- (user_id, account name) match, and adds a foreign key once backfill
-- has run.
--
-- Safety notes:
--   * Additive only - no column is dropped, no row is deleted or rewritten.
--   * account_id is nullable. Any trade whose account name doesn't match
--     one of that user's current accounts is left with account_id = NULL
--     rather than guessed at - it is never assigned to the wrong account.
--   * A FOREIGN KEY only enforces referential integrity for non-NULL
--     values, so adding it after backfill is safe regardless of whether
--     every row matched.
--   * Idempotent: safe to run multiple times. The UPDATE only touches
--     rows where account_id IS NULL, and the constraint is added inside
--     a guarded DO block that checks pg_constraint first.

ALTER TABLE trades
ADD COLUMN IF NOT EXISTS account_id INTEGER;

UPDATE trades t
SET account_id = a.id
FROM accounts a
WHERE t.account_id IS NULL
  AND t.user_id = a.user_id
  AND t.account = a.name;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_trades_account_id'
  ) THEN
    ALTER TABLE trades
    ADD CONSTRAINT fk_trades_account_id
    FOREIGN KEY (account_id) REFERENCES accounts(id)
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trades_account_id
ON trades(account_id);

-- Diagnostic: run this manually after migrating to see match counts.
-- SELECT COUNT(*) AS total, COUNT(account_id) AS populated,
--        COUNT(*) - COUNT(account_id) AS unmatched
-- FROM trades;
