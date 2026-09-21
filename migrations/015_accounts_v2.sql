-- GhostTrader Accounts V2 — Account Command Center
--
-- Standalone reference form of the change applied at startup in db/init.js.
-- Purely additive and non-destructive:
--   * every new column has a safe default, so no existing account row
--     changes behavior until a user explicitly edits it
--   * no column is dropped, renamed, or narrowed
--   * no trade row is touched
--
-- Adds:
--   accounts.broker         - free-text broker/prop-firm name (optional)
--   accounts.account_type   - one of manual/prop/personal/demo/evaluation
--   accounts.is_primary     - the user's single "default" account
--   accounts.archived_at    - when the account was archived (active=false),
--                             cleared on reactivate; powers the "archived N
--                             days ago" detail without a new events table
--   accounts.updated_at     - last edit timestamp, maintained by the app
--                             (no trigger, consistent with the rest of the
--                             schema which has no update triggers either)

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS broker VARCHAR(80),
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'accounts_type_check'
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT accounts_type_check
      CHECK (account_type IN ('manual','prop','personal','demo','evaluation'));
  END IF;
END $$;

-- At most one primary account per user. A partial unique index (rather
-- than a boolean pair-check) means "no primary yet" is perfectly valid
-- (index simply has no row for that user) and the app only has to worry
-- about clearing the old primary before setting a new one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_primary_per_user
  ON accounts(user_id) WHERE is_primary;

-- Backfill: give every user who has accounts but no primary yet a
-- primary, chosen as their oldest active account (or oldest account of
-- any status if none are active). Additive/idempotent — only runs for
-- users with zero existing is_primary=true rows.
UPDATE accounts a
SET is_primary = TRUE
WHERE a.id = (
  SELECT a2.id FROM accounts a2
  WHERE a2.user_id = a.user_id
  ORDER BY a2.active DESC, a2.created_at ASC, a2.id ASC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM accounts p WHERE p.user_id = a.user_id AND p.is_primary
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_active
  ON accounts(user_id, active);

CREATE INDEX IF NOT EXISTS idx_accounts_user_type
  ON accounts(user_id, account_type);
