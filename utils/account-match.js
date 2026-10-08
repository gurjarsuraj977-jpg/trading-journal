/**
 * Shared account ↔ trade matching for GhostTrader.
 *
 * Authoritative relationship: trades.account_id → accounts.id
 * Legacy compatibility: when account_id IS NULL, match on free-text
 * trades.account = accounts.name (same user).
 *
 * Used by account detail, analytics, calendar, trade list, and CSV
 * ingestion so every surface counts the same set of trades for a
 * given account — required for future multi-account intelligence.
 */

/**
 * SQL fragment that matches a trade row `t` to an account identified
 * by id param and name param. Both params must be bound query params.
 *
 * @param {string} accountIdParam  e.g. "$3"
 * @param {string} accountNameParam e.g. "$4"
 */
function tradeMatchClause(accountIdParam, accountNameParam) {
  return `(t.account_id = ${accountIdParam} OR (t.account_id IS NULL AND t.account = ${accountNameParam}))`;
}

/**
 * Same logic without table alias (for queries that only touch trades).
 */
function tradeMatchClauseNoAlias(accountIdParam, accountNameParam) {
  return `(account_id = ${accountIdParam} OR (account_id IS NULL AND account = ${accountNameParam}))`;
}

/**
 * Resolve an account name (or id) owned by userId into { id, name, active }.
 * Returns null if not found / not owned.
 */
async function resolveAccount(db, userId, { name, id } = {}) {
  if (id != null && Number.isInteger(Number(id)) && Number(id) > 0) {
    const r = await db(
      `SELECT id, name, active FROM accounts WHERE user_id = $1 AND id = $2`,
      [userId, Number(id)]
    );
    return r.rowCount ? r.rows[0] : null;
  }
  const n = String(name || "").trim();
  if (!n) return null;
  const r = await db(
    `SELECT id, name, active FROM accounts WHERE user_id = $1 AND name = $2`,
    [userId, n]
  );
  return r.rowCount ? r.rows[0] : null;
}

module.exports = {
  tradeMatchClause,
  tradeMatchClauseNoAlias,
  resolveAccount,
};
