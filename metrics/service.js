/**
 * Unified Metrics Service — single authority for trading performance.
 *
 * Consumes stored trade facts (profit_loss, actual_r, risk_*).
 * Does NOT invoke Risk Engine V2.
 */
const { buildTradeFilters } = require("./query-builder");
const {
  winRate,
  expectancy,
  profitFactor,
  equityStats,
} = require("./formulas");

async function getMetrics(db, opts) {
  const filter = await buildTradeFilters(db, opts);
  const { where, params, account } = filter;

  const summaryR = await db(
    `SELECT
       COUNT(*)::int AS trade_count,
       COUNT(*) FILTER (WHERE profit_loss > 0)::int AS wins,
       COUNT(*) FILTER (WHERE profit_loss < 0)::int AS losses,
       COUNT(*) FILTER (WHERE profit_loss = 0 OR profit_loss IS NULL)::int AS breakeven,
       COALESCE(SUM(profit_loss), 0)::numeric AS pnl,
       COALESCE(SUM(profit_loss) FILTER (WHERE profit_loss > 0), 0)::numeric AS gross_profit,
       ABS(COALESCE(SUM(profit_loss) FILTER (WHERE profit_loss < 0), 0))::numeric AS gross_loss,
       COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss > 0), 0)::numeric AS avg_win,
       COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss < 0), 0)::numeric AS avg_loss,
       COALESCE(AVG(profit_loss), 0)::numeric AS avg_pnl,
       COALESCE(MAX(profit_loss), 0)::numeric AS best_trade,
       COALESCE(MIN(profit_loss), 0)::numeric AS worst_trade,
       /* G1: exclude null/invalid R from R stats; genuine 0R remains */
       COUNT(actual_r) FILTER (
         WHERE actual_r IS NOT NULL AND actual_r::text ~ '^-?[0-9]'
       )::int AS r_sample_count,
       AVG(actual_r) FILTER (
         WHERE actual_r IS NOT NULL
       )::numeric AS avg_r,
       SUM(actual_r) FILTER (
         WHERE actual_r IS NOT NULL
       )::numeric AS total_r,
       COALESCE(AVG(risk_percent) FILTER (WHERE risk_percent IS NOT NULL), 0)::numeric AS avg_risk_percent,
       COALESCE(AVG(risk_amount) FILTER (WHERE risk_amount IS NOT NULL), 0)::numeric AS avg_risk_amount,
       COALESCE(MAX(risk_percent), 0)::numeric AS largest_risk_percent,
       COALESCE(STDDEV_POP(risk_percent) FILTER (WHERE risk_percent IS NOT NULL), 0)::numeric AS risk_stddev
     FROM trades
     WHERE ${where}`,
    params
  );

  const s = summaryR.rows[0] || {};
  const tradeCount = Number(s.trade_count) || 0;
  const wins = Number(s.wins) || 0;
  const losses = Number(s.losses) || 0;
  const breakeven = Number(s.breakeven) || 0;
  const pnl = Number(s.pnl) || 0;
  const grossProfit = Number(s.gross_profit) || 0;
  const grossLoss = Number(s.gross_loss) || 0;
  const avgWin = Number(s.avg_win) || 0;
  const avgLossRaw = Number(s.avg_loss) || 0;
  const avgLoss = Math.abs(avgLossRaw);
  const pf = profitFactor(grossProfit, grossLoss);
  const exp = expectancy(wins, losses, avgWin, avgLoss);
  const wr = winRate(wins, losses);

  // Sequential stats only when needed
  let maxDrawdown = 0;
  let bestWinStreak = 0;
  let bestLossStreak = 0;
  let equityCurve = [];

  if (opts.includeCurve !== false) {
    const curveR = await db(
      `SELECT profit_loss, trade_date
       FROM trades
       WHERE ${where}
       ORDER BY trade_date ASC, id ASC`,
      params
    );
    const stats = equityStats(curveR.rows);
    maxDrawdown = stats.maxDrawdown;
    bestWinStreak = stats.bestWinStreak;
    bestLossStreak = stats.bestLossStreak;
    equityCurve = stats.curve;
  }

  // Starting balance
  let startingBalance = 0;
  let balanceNote = "none";
  if (account) {
    const b = await db(
      `SELECT COALESCE(starting_balance, 0)::numeric AS sb
       FROM accounts WHERE id = $1 AND user_id = $2`,
      [account.id, opts.userId]
    );
    startingBalance = Number(b.rows[0]?.sb) || 0;
    balanceNote = "selected_account";
  } else {
    const b = await db(
      `SELECT COALESCE(SUM(starting_balance), 0)::numeric AS sb
       FROM accounts WHERE user_id = $1`,
      [opts.userId]
    );
    startingBalance = Number(b.rows[0]?.sb) || 0;
    balanceNote = "aggregate_starting_capital";
  }

  const breakdowns = opts.includeBreakdowns
    ? await loadBreakdowns(db, where, params)
    : undefined;

  return {
    tradeCount,
    wins,
    losses,
    breakeven,
    winRate: wr,

    pnl,
    grossProfit,
    grossLoss,

    avgPnl: Number(s.avg_pnl) || 0,
    avgWin,
    avgLoss,

    bestTrade: Number(s.best_trade) || 0,
    worstTrade: Number(s.worst_trade) || 0,

    profitFactor: pf.profitFactor,
    profitFactorInfinite: pf.profitFactorInfinite,

    expectancy: exp,

    /* G1: null when no valid R sample — UI must not treat as 0R average */
    rSampleCount: Number(s.r_sample_count) || 0,
    avgR: s.avg_r === null || s.avg_r === undefined ? null : Number(s.avg_r),
    totalR: s.total_r === null || s.total_r === undefined ? null : Number(s.total_r),

    avgRiskPercent: Number(s.avg_risk_percent) || 0,
    avgRiskAmount: Number(s.avg_risk_amount) || 0,
    largestRiskPercent: Number(s.largest_risk_percent) || 0,
    riskStddev: Number(s.risk_stddev) || 0,
    /* G4: risk_percent is stored at trade save from Risk Engine V2 using
     * account starting_balance at that time. Historical equity-at-entry is
     * not reconstructed here (no deposit/withdrawal ledger). */

    maxDrawdown,
    bestWinStreak,
    bestLossStreak,

    startingBalance,
    /* G2: periodPnl is P&L inside the filter; currentEquity uses starting
     * balance + period P&L only. Without a full ledger, prior-period P&L
     * outside the date filter is not added. Do not label period P&L alone
     * as "all-time equity" when from/to are set. */
    periodPnl: pnl,
    currentEquity: startingBalance + pnl,
    equityScope:
      filter.from || filter.to ? "starting_balance_plus_period_pnl" : "starting_balance_plus_all_matched_pnl",
    balanceNote,
    equityLimitation:
      "Deposits, withdrawals, and balance adjustments are not modeled. Multi-currency conversion is not applied.",

    equityCurve,
    breakdowns,

    // filter echo for consumers
    filter: {
      tz: filter.tz,
      from: filter.from || null,
      to: filter.to || null,
      source: filter.source,
      accountId: account ? account.id : null,
      accountName: account ? account.name : null,
    },
  };
}

async function loadBreakdowns(db, where, params) {
  const make = (sql) => db(sql, params);
  const [sym, strat, sess, dir, days, setup] = await Promise.all([
    make(
      `SELECT symbol AS name, COUNT(*)::int AS trades,
              COALESCE(SUM(profit_loss),0)::numeric AS pnl
       FROM trades WHERE ${where}
       GROUP BY symbol ORDER BY pnl DESC`
    ),
    make(
      `SELECT COALESCE(strategy,'Unspecified') AS name, COUNT(*)::int AS trades,
              COALESCE(SUM(profit_loss),0)::numeric AS pnl
       FROM trades WHERE ${where}
       GROUP BY strategy ORDER BY pnl DESC`
    ),
    make(
      `SELECT COALESCE(session,'Unspecified') AS name, COUNT(*)::int AS trades,
              COALESCE(SUM(profit_loss),0)::numeric AS pnl
       FROM trades WHERE ${where}
       GROUP BY session ORDER BY pnl DESC`
    ),
    make(
      `SELECT direction AS name, COUNT(*)::int AS trades,
              COALESCE(SUM(profit_loss),0)::numeric AS pnl
       FROM trades WHERE ${where}
       GROUP BY direction ORDER BY direction`
    ),
    make(
      `SELECT timezone($2, trade_date)::date AS day,
              COALESCE(SUM(profit_loss),0)::numeric AS pnl,
              COUNT(*)::int AS trades
       FROM trades WHERE ${where}
       GROUP BY timezone($2, trade_date)::date
       ORDER BY day`
    ),
    make(
      `SELECT COALESCE(setup,'Unspecified') AS name, COUNT(*)::int AS trades,
              COALESCE(SUM(profit_loss),0)::numeric AS pnl
       FROM trades WHERE ${where}
       GROUP BY setup ORDER BY pnl DESC`
    ),
  ]);

  return {
    bySymbol: sym.rows,
    byStrategy: strat.rows,
    bySession: sess.rows,
    byDirection: dir.rows,
    byDay: days.rows,
    bySetup: setup.rows,
  };
}

/**
 * Map service result → legacy analytics summary shape for frontend compatibility.
 */
function toAnalyticsSummary(m) {
  return {
    total: m.tradeCount,
    wins: m.wins,
    losses: m.losses,
    breakeven: m.breakeven,
    pnl: m.pnl,
    startingBalance: m.startingBalance,
    currentEquity: m.currentEquity,
    balanceNote: m.balanceNote,
    winRate: m.winRate,
    profitFactor: m.profitFactorInfinite ? 0 : m.profitFactor,
    profitFactorInfinite: m.profitFactorInfinite,
    avgWin: m.avgWin,
    avgLoss: m.avgLoss,
    avgR: m.avgR,
    totalR: m.totalR,
    avgRisk: m.avgRiskPercent,
    expectancy: m.expectancy,
    maxDrawdown: m.maxDrawdown,
    bestWinStreak: m.bestWinStreak,
    bestLossStreak: m.bestLossStreak,
  };
}

module.exports = {
  getMetrics,
  toAnalyticsSummary,
  loadBreakdowns,
};
