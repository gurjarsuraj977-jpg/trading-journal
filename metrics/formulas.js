/**
 * Pure metric formulas — single source of truth for classification,
 * win rate, expectancy, profit factor, and drawdown.
 * No I/O. Safe to unit-test without a database.
 */

function classifyPnl(profitLoss) {
  const p = Number(profitLoss);
  if (!Number.isFinite(p) || p === 0) return "breakeven";
  return p > 0 ? "win" : "loss";
}

/**
 * Win rate: wins / (wins + losses) * 100.
 * Breakeven trades are excluded from the denominator.
 */
function winRate(wins, losses) {
  const w = Number(wins) || 0;
  const l = Number(losses) || 0;
  const d = w + l;
  if (d === 0) return 0;
  return (w / d) * 100;
}

/**
 * Expectancy using classified trades only (wins + losses).
 * E = (wins/classified)*avgWin - (losses/classified)*avgLossAbs
 */
function expectancy(wins, losses, avgWin, avgLossAbs) {
  const w = Number(wins) || 0;
  const l = Number(losses) || 0;
  const classified = w + l;
  if (classified === 0) return 0;
  const aw = Number(avgWin) || 0;
  const al = Math.abs(Number(avgLossAbs) || 0);
  return (w / classified) * aw - (l / classified) * al;
}

/**
 * Profit factor. JSON-safe: never returns Infinity.
 * { profitFactor, profitFactorInfinite }
 */
function profitFactor(grossProfit, grossLossAbs) {
  const gp = Number(grossProfit) || 0;
  const gl = Math.abs(Number(grossLossAbs) || 0);
  if (gl === 0 && gp > 0) {
    return { profitFactor: null, profitFactorInfinite: true };
  }
  if (gl === 0 && gp === 0) {
    return { profitFactor: 0, profitFactorInfinite: false };
  }
  if (gl === 0) {
    return { profitFactor: 0, profitFactorInfinite: false };
  }
  return { profitFactor: gp / gl, profitFactorInfinite: false };
}

/**
 * Ordered cumulative P&L → max drawdown (absolute) and streaks.
 * rows: [{ profit_loss }] in chronological order.
 */
function equityStats(rows) {
  let eq = 0;
  let peak = 0;
  let dd = 0;
  let ws = 0;
  let ls = 0;
  let bestWinStreak = 0;
  let bestLossStreak = 0;
  const curve = [];

  for (const row of rows || []) {
    const p = Number(row.profit_loss);
    const pnl = Number.isFinite(p) ? p : 0;
    eq += pnl;
    peak = Math.max(peak, eq);
    dd = Math.min(dd, eq - peak);
    if (pnl > 0) {
      ws++;
      ls = 0;
      bestWinStreak = Math.max(bestWinStreak, ws);
    } else if (pnl < 0) {
      ls++;
      ws = 0;
      bestLossStreak = Math.max(bestLossStreak, ls);
    } else {
      // breakeven does not break or extend streaks
    }
    curve.push({
      date: row.trade_date,
      equity: eq,
      pnl: eq,
    });
  }

  return {
    maxDrawdown: Math.abs(dd),
    bestWinStreak,
    bestLossStreak,
    curve,
    endingPnl: eq,
  };
}

module.exports = {
  classifyPnl,
  winRate,
  expectancy,
  profitFactor,
  equityStats,
};
