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

/**
 * R-sample stats from an array of actual_r values.
 * Null/NaN/non-finite are excluded. Genuine 0R is kept.
 * Returns null averages when there is no valid sample (not 0).
 */
function rStats(values) {
  const valid = [];
  for (const v of values || []) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    valid.push(n);
  }
  const sampleSize = valid.length;
  if (sampleSize === 0) {
    return { sampleSize: 0, avgR: null, totalR: null };
  }
  const totalR = valid.reduce((a, b) => a + b, 0);
  return { sampleSize, avgR: totalR / sampleSize, totalR };
}

const finiteOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Per-group performance statistics (symbol / strategy / setup / session /
 * emotion / confidence band / week ...). Built ONLY from the primitives above
 * (winRate, profitFactor) so every surface classifies and divides the same way.
 *
 * Input is pre-aggregated counts and sums:
 *   { trades, wins, losses, grossProfit, grossLoss (abs), rSampleCount, totalR }
 *
 * "Unavailable" is `null`, never a fake 0:
 *   winRate       null when the group has no winning or losing trade
 *                 (only breakeven trades -> nothing to rate)
 *   profitFactor  null when there is no gross profit and no gross loss;
 *                 null + profitFactorInfinite=true when profit exists but no loss;
 *                 0 only when there ARE losses and no profit (a genuine 0)
 *   avgR          null when the group has no valid R sample
 * Every number returned is finite (never NaN / Infinity).
 */
function groupStats(input) {
  const i = input || {};
  const trades = Math.max(0, Math.floor(Number(i.trades) || 0));
  const wins = Math.max(0, Math.floor(Number(i.wins) || 0));
  const losses = Math.max(0, Math.floor(Number(i.losses) || 0));
  const breakeven = Math.max(0, trades - wins - losses);
  const gp = Math.max(0, Number(i.grossProfit) || 0);
  const gl = Math.abs(Number(i.grossLoss) || 0);

  const decisive = wins + losses;
  const wr = decisive > 0 ? winRate(wins, losses) : null;

  let pf = null;
  let pfInfinite = false;
  if (gl > 0) {
    pf = finiteOrNull(profitFactor(gp, gl).profitFactor);
  } else if (gp > 0) {
    pfInfinite = true;
  }

  const rCount = Math.max(0, Math.floor(Number(i.rSampleCount) || 0));
  const totalR = finiteOrNull(i.totalR);
  const avgR = rCount > 0 && totalR !== null ? finiteOrNull(totalR / rCount) : null;

  return {
    trades,
    wins,
    losses,
    breakeven,
    winRate: wr,
    profitFactor: pf,
    profitFactorInfinite: pfInfinite,
    avgR,
    totalR: rCount > 0 ? totalR : null,
    rSampleCount: rCount,
  };
}

/**
 * groupStats() for an in-memory list of trades: [{ pnl, r }].
 * pnl: non-finite counts as breakeven and adds nothing (same as SQL NULL).
 * r:   null / undefined / "" / non-finite are excluded from the R sample;
 *      a genuine 0R is kept (same rule as rStats / the SQL service).
 */
function summarizeTradeRows(rows) {
  let wins = 0;
  let losses = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  const rValues = [];
  let trades = 0;
  for (const row of rows || []) {
    trades++;
    const p = Number(row && row.pnl);
    if (Number.isFinite(p)) {
      if (p > 0) {
        wins++;
        grossProfit += p;
      } else if (p < 0) {
        losses++;
        grossLoss += -p;
      }
    }
    rValues.push(row ? row.r : null);
  }
  const r = rStats(rValues);
  return groupStats({
    trades,
    wins,
    losses,
    grossProfit,
    grossLoss,
    rSampleCount: r.sampleSize,
    totalR: r.totalR,
  });
}

/** Basic IANA-like timezone name check (rejects empty / injection-ish). */
function isValidTimezoneName(tz) {
  const t = String(tz || "").trim();
  if (!t || t.length > 64) return false;
  // Allow UTC, Etc/GMT, Area/Location, and common aliases
  if (t === "UTC" || t === "GMT") return true;
  if (!/^[A-Za-z0-9_+\-\/]+$/.test(t)) return false;
  if (t.includes("..") || t.startsWith("/")) return false;
  return true;
}

module.exports = {
  classifyPnl,
  winRate,
  expectancy,
  profitFactor,
  equityStats,
  rStats,
  groupStats,
  summarizeTradeRows,
  isValidTimezoneName,
};
