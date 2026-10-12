/**
 * Pure Strategy Simulator outcome (Batch F / D-10).
 *
 * MAE / MFE convention (matches trade save path in server.js):
 *   mfe_r and mae_r are stored as non-negative R magnitudes
 *   (price distance / entry–SL distance). Direction is already
 *   normalized when extremes are derived from BUY/SELL prices.
 *
 * Dual-hit policy:
 *   When both target and stop thresholds are satisfied by recorded
 *   extremes, the stop is taken (conservative). Journal MFE/MAE are
 *   path extremes only; they do not establish intrabar order.
 */

/**
 * @param {{ mfe_r?: any, mae_r?: any, actual_r?: any }} trade
 * @param {number} targetR  R target (sign ignored)
 * @param {number} stopR    R stop magnitude (sign ignored)
 * @returns {{ usable: boolean, rr: number, reason: string }}
 */
function simulateTradeOutcome(trade, targetR, stopR) {
  const mfeRaw = Number(trade && trade.mfe_r);
  const maeRaw = Number(trade && trade.mae_r);
  const hasMfe = Number.isFinite(mfeRaw) && mfeRaw !== 0;
  const hasMae = Number.isFinite(maeRaw) && maeRaw !== 0;
  if (!hasMfe && !hasMae) {
    return { usable: false, rr: 0, reason: "missing_extremes" };
  }

  const mfe = Math.abs(mfeRaw);
  const mae = Math.abs(maeRaw);
  const target = Math.abs(Number(targetR));
  const stopAbs = Math.abs(Number(stopR));
  if (
    !Number.isFinite(target) ||
    !Number.isFinite(stopAbs) ||
    target <= 0 ||
    stopAbs <= 0
  ) {
    return { usable: false, rr: 0, reason: "invalid_levels" };
  }

  const hitTarget = hasMfe && mfe >= target;
  const hitStop = hasMae && mae >= stopAbs;

  if (hitTarget && hitStop) {
    return { usable: true, rr: -stopAbs, reason: "both_conservative_stop" };
  }
  if (hitTarget) {
    return { usable: true, rr: target, reason: "target" };
  }
  if (hitStop) {
    return { usable: true, rr: -stopAbs, reason: "stop" };
  }

  const actual = Number(trade.actual_r);
  const rr = Number.isFinite(actual) ? actual : 0;
  return { usable: true, rr, reason: "neither_keep_actual" };
}

module.exports = { simulateTradeOutcome };
