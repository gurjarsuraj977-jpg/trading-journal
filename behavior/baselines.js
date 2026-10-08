/**
 * Trader-specific baseline calculations (pure + SQL helpers).
 * Baseline = what is historically normal for THIS trader under the selected filters.
 * Does NOT use industry averages or judgment labels.
 */

const { getSampleStatus } = require("./confidence");

/**
 * Safe finite number or null (never NaN/Infinity).
 * @param {*} n
 * @returns {number|null}
 */
function finiteOrNull(n) {
  if (n === null || n === undefined) return null;
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

/**
 * Build risk baseline from aggregate stats.
 * @param {{ avg?: *, stddev?: *, min?: *, max?: *, count?: number }} stats
 * @returns {{ averagePercent: number|null, stdDevPercent: number|null, minPercent: number|null, maxPercent: number|null }}
 */
function buildRiskBaseline(stats) {
  const count = Number(stats && stats.count) || 0;
  if (count <= 0) {
    return {
      averagePercent: null,
      stdDevPercent: null,
      minPercent: null,
      maxPercent: null,
    };
  }
  return {
    averagePercent: finiteOrNull(stats.avg),
    stdDevPercent: finiteOrNull(stats.stddev),
    minPercent: finiteOrNull(stats.min),
    maxPercent: finiteOrNull(stats.max),
  };
}

/**
 * Activity baseline from total trades + distinct local calendar days.
 * @param {number} totalTrades
 * @param {number} activeDays
 * @returns {{ totalTrades: number, activeDays: number, tradesPerActiveDay: number|null }}
 */
function buildActivityBaseline(totalTrades, activeDays) {
  const trades = Math.max(0, Math.floor(Number(totalTrades) || 0));
  const days = Math.max(0, Math.floor(Number(activeDays) || 0));
  return {
    totalTrades: trades,
    activeDays: days,
    tradesPerActiveDay: days > 0 ? trades / days : null,
  };
}

/**
 * Psychology baseline from average confidence / rule_score.
 * Zeros are preserved as raw values (not reinterpreted as "unset").
 * @param {{ avgConfidence?: *, avgRuleScore?: *, confCount?: number, ruleCount?: number }} stats
 * @returns {{ averageConfidence: number|null, averageRuleScore: number|null }}
 */
function buildPsychologyBaseline(stats) {
  const confCount = Number(stats && stats.confCount) || 0;
  const ruleCount = Number(stats && stats.ruleCount) || 0;
  return {
    averageConfidence:
      confCount > 0 ? finiteOrNull(stats.avgConfidence) : null,
    averageRuleScore:
      ruleCount > 0 ? finiteOrNull(stats.avgRuleScore) : null,
  };
}

/**
 * Performance slice from Unified Metrics result (authoritative).
 * @param {object} m  getMetrics() result
 * @returns {{ expectancy: number|null, averageR: number|null, totalR: number|null, winRate: number|null, pnl: number|null }}
 */
function buildPerformanceBaseline(m) {
  if (!m || !(Number(m.tradeCount) > 0)) {
    return {
      expectancy: null,
      averageR: null,
      totalR: null,
      winRate: null,
      pnl: null,
    };
  }
  return {
    expectancy: finiteOrNull(m.expectancy),
    averageR: finiteOrNull(m.avgR),
    totalR: finiteOrNull(m.totalR),
    winRate: finiteOrNull(m.winRate),
    pnl: finiteOrNull(m.pnl),
  };
}

/**
 * Assemble the stable baseline object.
 * @param {object} parts
 * @returns {object}
 */
function assembleBaseline({
  sampleSize,
  performance,
  risk,
  activity,
  psychology,
}) {
  const n = Math.max(0, Math.floor(Number(sampleSize) || 0));
  const evidence = getSampleStatus(n);
  return {
    sampleSize: n,
    evidence: {
      status: evidence.status,
      confidenceLevel: evidence.confidenceLevel,
    },
    performance: performance || buildPerformanceBaseline(null),
    risk: risk || buildRiskBaseline({ count: 0 }),
    activity: activity || buildActivityBaseline(0, 0),
    psychology: psychology || buildPsychologyBaseline({}),
  };
}

/**
 * SQL: risk + psychology aggregates under an existing filter WHERE.
 * Only rows with finite risk_percent contribute to risk stats.
 * Confidence/rule_score include zeros as stored.
 *
 * @param {Function} db
 * @param {string} where
 * @param {Array} params
 * @returns {Promise<object>}
 */
async function queryBehavioralAggregates(db, where, params) {
  const r = await db(
    `SELECT
       COUNT(*)::int AS trade_count,
       COUNT(*) FILTER (
         WHERE risk_percent IS NOT NULL AND risk_percent::text <> 'NaN'
       )::int AS risk_count,
       COALESCE(AVG(risk_percent) FILTER (
         WHERE risk_percent IS NOT NULL
       ), NULL)::numeric AS avg_risk,
       COALESCE(STDDEV_POP(risk_percent) FILTER (
         WHERE risk_percent IS NOT NULL
       ), NULL)::numeric AS stddev_risk,
       COALESCE(MIN(risk_percent) FILTER (
         WHERE risk_percent IS NOT NULL
       ), NULL)::numeric AS min_risk,
       COALESCE(MAX(risk_percent) FILTER (
         WHERE risk_percent IS NOT NULL
       ), NULL)::numeric AS max_risk,
       COUNT(confidence)::int AS conf_count,
       COALESCE(AVG(confidence), NULL)::numeric AS avg_confidence,
       COUNT(rule_score)::int AS rule_count,
       COALESCE(AVG(rule_score), NULL)::numeric AS avg_rule_score
     FROM trades
     WHERE ${where}`,
    params
  );
  return r.rows[0] || {};
}

/**
 * SQL: distinct local-calendar active days under filter.
 * Uses timezone($tzIdx, trade_date)::date — same contract as Unified Metrics.
 *
 * @param {Function} db
 * @param {string} where
 * @param {Array} params  must include tz as $2 (buildTradeFilters convention)
 * @returns {Promise<number>}
 */
async function queryActiveDays(db, where, params) {
  const r = await db(
    `SELECT COUNT(DISTINCT timezone($2, trade_date)::date)::int AS active_days
     FROM trades
     WHERE ${where}`,
    params
  );
  return Number(r.rows[0]?.active_days) || 0;
}

module.exports = {
  finiteOrNull,
  buildRiskBaseline,
  buildActivityBaseline,
  buildPsychologyBaseline,
  buildPerformanceBaseline,
  assembleBaseline,
  queryBehavioralAggregates,
  queryActiveDays,
};
