-- GhostTrader Batch 1B - Account lifecycle (archive/reactivate)
--
-- Standalone reference form of the change applied at startup in db/init.js.
-- Additive and non-destructive: existing accounts default to active=TRUE,
-- so no existing account or trade is affected until a user explicitly
-- archives an account via PUT /api/accounts/:id { active:false }.
--
-- Archived accounts remain in the database with all historical trades
-- intact; they are simply excluded from the "active" selector used when
-- creating new Journal trades.

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
