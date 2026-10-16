# GhostTrader V8 — Phase 1 report

Scope: protect existing functionality, fix confirmed correctness issues, add regression protection.
Not touched: manual Add Account flow, TradeLocker integration, MT5, the database itself, any user data.

## A. Change log (every modified/added file)

| File | What changed | Why / risk addressed | Compatibility |
|---|---|---|---|
| `metrics/formulas.js` | Added `groupStats()` and `summarizeTradeRows()` (pure). Existing functions untouched. | One shared way to compute per-group win rate / profit factor / avg R, built on the existing `winRate`, `profitFactor`, `rStats`. Unavailable = `null`, never fake 0; never NaN/Infinity. | Additive exports only. |
| `metrics/service.js` | `loadBreakdowns` now also aggregates wins/losses/gross profit/gross loss/R sample per group (shared `GROUP_AGG` SQL) and returns win rate, profit factor, avg R. | Source of the real stats; same classification as `getMetrics` (win `>0`, loss `<0`, else breakeven; R sample = `actual_r IS NOT NULL`). | Rows keep `name/trades/pnl`; new fields are additive. `analytics-routes` only reads the old three. |
| `routes/premium-routes.js` | Removed hardcoded `winRate:0, profitFactor:0, avgR:0` from `edge.*` (symbols/strategies/setups/sessions/markets). Psychology `emotions`/`confidence` now also carry real `avgR`/`profitFactor`. Weekly stats use the shared helper. `r` is nullable (no more `NULL → 0R`). Process/weekly rows now take the **most recent** 2000 trades (was the oldest 2000). | Placeholder analytics; fake zeros; for journals >2000 trades the current week and latest process flags were silently dropped. | Same response keys. `winRate`/`avgR`/`profitFactor` may now be `null`; `profitFactorInfinite` added. Identical results for journals ≤2000 trades except the stats are now real. |
| `public/js/insights-reports.js` | `insightRow` and `reports()` show unavailable stats as “—”; `profitFactorInfinite` shows “∞”. Output for available values is identical. | Psychology rows showed a fake “PF ∞” and “0.00R” because the API never sent those fields; weekly cards showed 0.0% / 0.00R with no data. | `legacyGroupRow` (Edge/Leak lists) unchanged. |
| `routes/ai-coach-routes.js` | Null-safe average R. | **Confirmed bug:** `m.avgR.toFixed()` threw for any user with no trades (or no R data) → HTTP 500 “Coach unavailable.” | Only the no-R case changes. |
| `behavior/service.js` | `getBehaviorSummary()` implemented as `{sampleSize, baseline, signals, patterns}` composed from the existing services. | It was an exported stub that always threw. No caller anywhere (verified by search + test). Kept the export name for compatibility rather than deleting it. | No existing behavior changed. |
| `db/init.js` | The boot-time “Main Account” backfill now runs only for users with **no accounts at all**. | **Confirmed bug:** every boot/deploy re-created an empty “Main Account” for users who had renamed it (reproduced on a real DB). | Legacy users with zero accounts still get one; no row is ever deleted. Revert = restore the old `NOT EXISTS` clause. |
| `render.yaml` | Added `TRUST_PROXY=1`. | Without it, all clients share the proxy IP, so the 30-per-15-min login limiter is one global bucket (anyone can lock everyone out). | Env var already supported by `server.js`. If the service isn’t Blueprint-managed, set it in the Render dashboard. |
| `package.json` | Added `"test": "node tests/run-all.js"`. | There was no test command. | None. |
| `tests/behavior-ui-batch3a.test.js`, `tests/behavior-ui-batch3b.test.js` | **Three assertions changed (not weakened):** two string pins on the old `insightRow` expressions → behavioral checks (available / unavailable / infinite / missing-field); one pin that required the placeholder literal `winRate: 0, profitFactor: 0, avgR: 0` → asserts those literals are gone. | Those assertions froze exactly the behavior Phase 1 was asked to change (their own comments say “known defects… separate batch”). All other assertions in both files are unchanged and pass. | — |
| New: `tests/breakdown-metrics.test.js`, `premium-analytics-db.test.js`, `behavior-summary.test.js`, `ai-coach-null-r-db.test.js`, `db-init.test.js`, `account-flow-db.test.js`, `tests/run-all.js`, `tests/helpers/*` | Regression tests, runner, isolated-DB helper. | See section C. | Test-only. |

No migration file was changed. No schema change was made.

## B. Findings that drove decisions
- Hardcoded zeros: `edge.*` in `premium-routes.js` (confirmed). The Edge/Leak UI deliberately hid them; the Psychology UI did not (fake “PF ∞”, “0.00R”).
- `getBehaviorSummary`: exported, zero callers, never worked.
- Premium rows were `ORDER BY trade_date ASC LIMIT 2000` → for large journals the *newest* trades were cut off (reproduced: 5 trades this week reported as 0).

## C. Test report

Baseline (original ZIP, run here): 25 `*.test.js` files, **470 passed, 0 failed**. `tests/us100-live-spec.js` is a live TradeLocker script that needs `DATABASE_URL`; it is not part of the suite and was not run.

Final: `npm test` → **31 files, 507 passed, 0 failed, 0 skipped** (with a test database). Without `TEST_DATABASE_URL`: 481 passed, 0 failed, 5 DB files reported as SKIPPED (never counted as passed).

New tests (37): group-metric math on hand-calculated data (win/loss/breakeven, no-loser, all-loss, all-breakeven, missing/invalid values, empty); real `/api/premium` handler on PostgreSQL vs an independent calculation, user-boundary and account-filter checks, summary reconciliation, >2000-trade recency; `getBehaviorSummary`; AI coach with no trades/no R; init on a clean DB, in-place upgrade of a legacy schema holding data (nothing lost or altered, unmatched trades stay `NULL`), idempotence, no phantom accounts; manual Add Account exact name/balance, duplicate/invalid input, trade↔account association, rename/archive keep trades, 409 on delete with trades, cross-user 404s.

Checked that the new tests can fail: against the original `premium-routes.js`/`service.js` 5 of 8 premium tests fail; against the original `ai-coach-routes.js` 2 of 3 fail; the old `Main Account` behavior fails the init test.

Could not run / limits:
- `npm install` is blocked in this sandbox (registry refused), so `express`, `pg`, `bcryptjs`, `jsonwebtoken` were never installed. The server was **not started** and **no HTTP-level or real-`pg` test ran**. DB tests ran against a local PostgreSQL 16 through a `psql`-based test adapter (`tests/helpers/psql-session.js`) and call route handlers directly with a stubbed `express`. When `pg` is installed, the helper uses it automatically — that path is written but was not exercised here.
- Not run: the live Render deployment, your production database, TradeLocker.
- Syntax: `node --check` passed on every modified and new JS file. No lint config exists in the project.

## D. Database safety report

**How the DB is initialized.** `server.js` calls `db/init.js` on every boot and only starts listening after it finishes. `init.js` is plain inline SQL, all idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, guarded `DO $$` blocks for constraints). There is **no migration runner and no migrations table**; the `migrations/` folder is never read by the app.

**Numbered migrations.** `008`–`015` (note `010` sits in `migrations/migrations/`) are *reference copies*. I applied them to a legacy schema: they run without errors, but they are a **strict subset** of `init.js` — they omit `playbooks`, `playbook_rules`, `missed_trades`, `replay_*`, `backtests`, `mt5_connections` and 24 `trades` columns. **Treat `db/init.js` as the source of truth; do not run the numbered files by hand.** Unchanged in this phase.

**Does any migration risk data loss?** None drops, truncates or rewrites data. Relationships: `trades.account_id → accounts(id) ON DELETE SET NULL`; `accounts/trades/playbooks… → users ON DELETE CASCADE` (so deleting a *user* removes their data — admin hard-delete is intentional and needs confirmation). The backfill only links trades whose `(user, account name)` matches; unmatched trades stay `NULL`, never guessed (tested).

**Data migration required:** none.

**Other observations (not changed):** init has no transaction and no advisory lock, so two instances booting simultaneously could race on index/constraint creation (idempotent on re-run). `pg_constraint` existence checks are not schema-qualified (irrelevant in a single-schema production DB).

**Test against a copy:** `pg_dump` production → restore into a database whose name contains `test` → run `TEST_DATABASE_URL=postgres://…/yourname_test npm test`, and/or start the app once against the copy and compare `SELECT count(*)` of `users/accounts/trades` before and after. The test helper refuses any URL whose database name lacks “test” or equals `DATABASE_URL`, creates a throw-away database per run and drops only that one.

## E. Deployment (Render)
1. Back up first: Render dashboard → your Postgres → Backups (or `pg_dump "$DATABASE_URL" -Fc -f ghosttrader-$(date +%F).dump`). Note counts: `SELECT (SELECT count(*) FROM users),(SELECT count(*) FROM accounts),(SELECT count(*) FROM trades);`
2. Do **not** change `DATABASE_URL` or `JWT_SECRET`. Confirm `NODE_ENV=production` (Render’s Node default) and set `TRUST_PROXY=1` (render.yaml now includes it; add it manually if the service isn’t Blueprint-managed).
3. Replace the repository files with this ZIP’s contents (keep your real `.env`/Render env vars), commit, push. Render redeploys; `init.js` runs once and is non-destructive.
4. After deploy: check the logs for `[migration] trades.account_id: X/Y rows populated`; re-run the count query (numbers must match step 1; accounts can only go **up** by one per user who had zero accounts); open Insights and Reports.
5. Rollback: redeploy the previous commit. No schema change was made, so no database rollback is needed.

## F. Remaining issues

**Confirmed, intentionally not fixed (and why)**
1. **Missing stop-loss is stored as `actual_r = 0`** (the calculator and CSV import write 0, not NULL), so dashboard/breakdown average R counts those trades as 0R. Breakdowns match the dashboard on purpose; changing the rule shifts every headline average R, so it needs your decision (proposal: R sample = `actual_r IS NOT NULL AND risk_amount > 0`, applied in `getMetrics` and `loadBreakdowns` together).
2. `routes/account-routes.js` account detail uses `COALESCE(AVG(actual_r),0)` (shows 0R when there is no R) and its own stats SQL instead of `getMetrics`; left to avoid changing account-page numbers.
3. **TradeLocker** (out of scope by instruction): synced trades are inserted without `account_id` (renaming that account can orphan them until the next boot’s backfill), `tradelocker-client.js` logs full broker responses (balances/positions) at lines ~272/363/440/519/599, refresh tokens are stored in plaintext.
4. `INITIAL_ADMIN_EMAIL` promotion also happens in register/login: anyone who registers that address before you do becomes admin. The README documents this flow, so it was left alone; register your admin first or remove the variable after bootstrap.
5. Last-admin protection is check-then-update, not atomic (two concurrent demotions could leave zero admins). Admin audit-log IP uses the leftmost `X-Forwarded-For`.
6. UI: the Psychology “Confidence” rows have `label` but no `name`, so the title renders blank (pre-existing, noted by earlier batches); weekly/“this week” uses the server clock, not the user’s timezone.
7. `DELETE /api/trades/:id` doesn’t validate the id (a non-numeric id returns 500 instead of 400; still scoped to the user).
8. Markets breakdown is computed from the capped 2000 most-recent trades, not the full history.
9. Password minimum is 6 characters; DB TLS uses `rejectUnauthorized:false` for non-localhost hosts.

**Need live verification (could not test here)**: real server boot and HTTP flow with the actual `pg` driver; Render environment (`NODE_ENV`, `TRUST_PROXY`); the Insights/Reports pages in a browser; TradeLocker sync; behavior of `init.js` on your actual production data (counts should be unchanged — see section E).
