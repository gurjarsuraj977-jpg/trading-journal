/**
 * Shared filter contract for Unified Metrics.
 * Produces parameterized WHERE clauses scoped to a single user.
 */
const {
  tradeMatchClauseNoAlias,
  resolveAccount,
} = require("../utils/account-match");

const VALID_SOURCES = new Set([
  "all",
  "manual",
  "csv",
  "tradelocker",
  "mt5",
]);

/**
 * Build WHERE + params for metrics queries against `trades` (no alias).
 */
async function buildTradeFilters(db, opts) {
  const userId = Number(opts.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("userId is required");
  }

  const tz = String(opts.tz || "UTC").trim() || "UTC";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from || ""))
    ? String(opts.from)
    : "";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.to || ""))
    ? String(opts.to)
    : "";
  let source = String(opts.source || "all").toLowerCase();
  if (!VALID_SOURCES.has(source)) source = "all";

  // $1 = userId, $2 = tz (always present for timezone() predicates).
  // $2 is intentionally always bound: loadBreakdowns, active-day queries,
  // and date filters all hard-reference $2. When from/to are absent the
  // tautology below keeps placeholder/param counts aligned and gives
  // PostgreSQL an explicit text type (avoids 08P01 / 42P18).
  const params = [userId, tz];
  const clauses = ["user_id = $1", "$2::text IS NOT NULL"];

  let resolvedAccount = null;
  if (opts.accountId != null && Number(opts.accountId) > 0) {
    resolvedAccount = await resolveAccount(db, userId, {
      id: Number(opts.accountId),
    });
  } else if (opts.accountName && String(opts.accountName).trim()) {
    resolvedAccount = await resolveAccount(db, userId, {
      name: String(opts.accountName).trim(),
    });
  }

  if (opts.accountId != null && Number(opts.accountId) > 0 && !resolvedAccount) {
    clauses.push("FALSE");
  } else if (
    opts.accountName &&
    String(opts.accountName).trim() &&
    !resolvedAccount
  ) {
    params.push(String(opts.accountName).trim());
    clauses.push(`account = $${params.length} AND account_id IS NULL`);
  } else if (resolvedAccount) {
    params.push(resolvedAccount.id, resolvedAccount.name);
    clauses.push(
      tradeMatchClauseNoAlias(`$${params.length - 1}`, `$${params.length}`)
    );
  }

  if (from) {
    params.push(from);
    clauses.push(`timezone($2, trade_date)::date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    clauses.push(`timezone($2, trade_date)::date <= $${params.length}::date`);
  }

  if (source !== "all") {
    params.push(source);
    clauses.push(`source = $${params.length}`);
  }

  return {
    where: clauses.join(" AND "),
    params,
    tz,
    from,
    to,
    source,
    account: resolvedAccount,
  };
}

/**
 * Journal list date filters — same inclusive local-calendar semantics.
 * Mutates params and clauses arrays.
 * When from/to omitted, no date clause is added (backward compatible).
 * When tz omitted, defaults to UTC.
 */
function appendJournalDateFilters(params, clauses, { from, to, tz }) {
  const t = String(tz || "UTC").trim() || "UTC";
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(String(from))) {
    params.push(t, String(from));
    const tzIdx = params.length - 1;
    const dIdx = params.length;
    clauses.push(
      `timezone($${tzIdx}, trade_date)::date >= $${dIdx}::date`
    );
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
    params.push(t, String(to));
    const tzIdx = params.length - 1;
    const dIdx = params.length;
    clauses.push(
      `timezone($${tzIdx}, trade_date)::date <= $${dIdx}::date`
    );
  }
}

module.exports = {
  buildTradeFilters,
  appendJournalDateFilters,
  VALID_SOURCES,
};
