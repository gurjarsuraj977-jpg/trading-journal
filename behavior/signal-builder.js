/**
 * Behavioral signal assembly from aggregate rows.
 * Uses metrics/formulas for win rate / expectancy — no competing formulas.
 * Pure assembly + SQL helpers for Batch 3.
 */

const { winRate, expectancy, equityStats } = require("../metrics/formulas");
const { getSampleStatus } = require("./confidence");
const { normalizeSegmentValue } = require("./segments");
const { confidenceBucket } = require("./signals");
const { finiteOrNull } = require("./baselines");

const SCORE_BUCKETS = Object.freeze([
  { label: "0-20", min: 0, max: 20 },
  { label: "21-40", min: 21, max: 40 },
  { label: "41-60", min: 41, max: 60 },
  { label: "61-80", min: 61, max: 80 },
  { label: "81-100", min: 81, max: 100 },
]);

function evidenceOf(n) {
  const e = getSampleStatus(n);
  return { status: e.status, confidenceLevel: e.confidenceLevel };
}

function safeNum(n) {
  return finiteOrNull(n);
}

/**
 * Build outcome metrics from a grouped SQL aggregate row.
 * Row fields: trades, wins, losses, gross_profit, gross_loss_abs, avg_win, avg_loss, total_r, avg_r
 */
function outcomesFromAgg(row) {
  const trades = Number(row.trades) || 0;
  const wins = Number(row.wins) || 0;
  const losses = Number(row.losses) || 0;
  const avgWin = Number(row.avg_win) || 0;
  const avgLossAbs = Math.abs(Number(row.avg_loss) || 0);
  return {
    sampleSize: trades,
    winRate: winRate(wins, losses),
    averageR: safeNum(row.avg_r) ?? 0,
    totalR: safeNum(row.total_r) ?? 0,
    expectancy: expectancy(wins, losses, avgWin, avgLossAbs),
  };
}

/**
 * Segment performance signal with baseline comparison.
 */
function buildSegmentSignal(dimension, segmentName, aggRow, baseline) {
  const o = outcomesFromAgg(aggRow);
  const bWr = safeNum(baseline && baseline.winRate);
  const bAr = safeNum(baseline && baseline.averageR);
  const bExp = safeNum(baseline && baseline.expectancy);
  return {
    dimension,
    segment: segmentName,
    sampleSize: o.sampleSize,
    winRate: o.winRate,
    averageR: o.averageR,
    totalR: o.totalR,
    expectancy: o.expectancy,
    baseline: {
      winRate: bWr,
      averageR: bAr,
      expectancy: bExp,
    },
    difference: {
      winRate: bWr == null ? null : o.winRate - bWr,
      averageR: bAr == null ? null : o.averageR - bAr,
      expectancy: bExp == null ? null : o.expectancy - bExp,
    },
    evidence: evidenceOf(o.sampleSize),
  };
}

/**
 * Confidence / rule-score bucket signal.
 */
function buildBucketSignal(dimension, bucketLabel, aggRow, baseline) {
  const o = outcomesFromAgg(aggRow);
  const bAr = safeNum(baseline && baseline.averageR);
  return {
    dimension,
    bucket: bucketLabel,
    sampleSize: o.sampleSize,
    averageR: o.averageR,
    winRate: o.winRate,
    expectancy: o.expectancy,
    totalR: o.totalR,
    baselineAverageR: bAr,
    difference: bAr == null ? null : o.averageR - bAr,
    evidence: evidenceOf(o.sampleSize),
  };
}

/**
 * Emotion segment signal.
 */
function buildEmotionSignal(dimension, segmentName, aggRow, baseline) {
  const o = outcomesFromAgg(aggRow);
  const bAr = safeNum(baseline && baseline.averageR);
  return {
    dimension,
    segment: segmentName,
    sampleSize: o.sampleSize,
    winRate: o.winRate,
    averageR: o.averageR,
    expectancy: o.expectancy,
    totalR: o.totalR,
    baselineAverageR: bAr,
    difference: bAr == null ? null : o.averageR - bAr,
    evidence: evidenceOf(o.sampleSize),
  };
}

/**
 * Mistake segment signal with frequency.
 */
function buildMistakeSignal(segmentName, aggRow, totalTrades, baseline) {
  const o = outcomesFromAgg(aggRow);
  const total = Math.max(0, Number(totalTrades) || 0);
  const bAr = safeNum(baseline && baseline.averageR);
  return {
    dimension: "mistake",
    segment: segmentName,
    sampleSize: o.sampleSize,
    frequencyPercent: total > 0 ? (o.sampleSize / total) * 100 : 0,
    averageR: o.averageR,
    totalR: o.totalR,
    winRate: o.winRate,
    baselineAverageR: bAr,
    difference: bAr == null ? null : o.averageR - bAr,
    evidence: evidenceOf(o.sampleSize),
  };
}

/**
 * Risk consistency signal from aggregate stats + baseline risk %.
 */
function buildRiskSignal(stats, baselineRiskPercent, sampleSize) {
  const n = Math.max(0, Math.floor(Number(sampleSize) || 0));
  if (n === 0) return null;
  const avg = safeNum(stats.avg);
  const std = safeNum(stats.stddev);
  const min = safeNum(stats.min);
  const max = safeNum(stats.max);
  const base = safeNum(baselineRiskPercent);
  return {
    dimension: "risk",
    baselineRiskPercent: base,
    averageRiskPercent: avg,
    stdDevPercent: std,
    minRiskPercent: min,
    maxRiskPercent: max,
    deviationPercent: avg != null && base != null ? avg - base : null,
    sampleSize: n,
    evidence: evidenceOf(n),
  };
}

/**
 * Exit efficiency from MFE/MAE aggregates.
 */
function buildExitEfficiencySignal(stats) {
  const n = Math.max(0, Math.floor(Number(stats.sampleSize) || 0));
  if (n === 0) return null;
  const avgMfe = safeNum(stats.avgMfe);
  const avgMae = safeNum(stats.avgMae);
  const avgActual = safeNum(stats.avgActualR);
  const avgCapture = safeNum(stats.avgCapture);
  return {
    dimension: "exit_efficiency",
    sampleSize: n,
    averageMfeR: avgMfe,
    averageMaeR: avgMae,
    averageActualR: avgActual,
    averageCaptureRatio: avgCapture,
    evidence: evidenceOf(n),
  };
}

/**
 * Streaks from chronological profit_loss rows via equityStats.
 */
function buildStreakSignal(orderedRows) {
  const rows = orderedRows || [];
  const n = rows.length;
  if (n === 0) return null;
  const stats = equityStats(rows);
  return {
    dimension: "streaks",
    longestWinStreak: stats.bestWinStreak,
    longestLossStreak: stats.bestLossStreak,
    sampleSize: n,
    evidence: evidenceOf(n),
  };
}

/** Shared SELECT fragment for outcome aggregates. */
const OUTCOME_SELECT = `
  COUNT(*)::int AS trades,
  COUNT(*) FILTER (WHERE profit_loss > 0)::int AS wins,
  COUNT(*) FILTER (WHERE profit_loss < 0)::int AS losses,
  COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss > 0), 0)::numeric AS avg_win,
  COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss < 0), 0)::numeric AS avg_loss,
  COALESCE(AVG(actual_r), 0)::numeric AS avg_r,
  COALESCE(SUM(actual_r), 0)::numeric AS total_r
`;

/**
 * SQL group by a text dimension column (session, strategy, etc.).
 */
async function queryDimensionGroups(db, where, params, column) {
  // column is a trusted internal identifier, never user input
  const r = await db(
    `SELECT
       COALESCE(NULLIF(TRIM(${column}), ''), 'Unspecified') AS name,
       ${OUTCOME_SELECT}
     FROM trades
     WHERE ${where}
     GROUP BY COALESCE(NULLIF(TRIM(${column}), ''), 'Unspecified')
     ORDER BY trades DESC`,
    params
  );
  return r.rows;
}

/**
 * Confidence / rule_score bucket groups via SQL CASE.
 */
async function queryScoreBuckets(db, where, params, column) {
  const r = await db(
    `SELECT
       bucket,
       COUNT(*)::int AS trades,
       COUNT(*) FILTER (WHERE profit_loss > 0)::int AS wins,
       COUNT(*) FILTER (WHERE profit_loss < 0)::int AS losses,
       COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss > 0), 0)::numeric AS avg_win,
       COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss < 0), 0)::numeric AS avg_loss,
       COALESCE(AVG(actual_r), 0)::numeric AS avg_r,
       COALESCE(SUM(actual_r), 0)::numeric AS total_r
     FROM (
       SELECT
         CASE
           WHEN ${column} >= 0 AND ${column} <= 20 THEN '0-20'
           WHEN ${column} >= 21 AND ${column} <= 40 THEN '21-40'
           WHEN ${column} >= 41 AND ${column} <= 60 THEN '41-60'
           WHEN ${column} >= 61 AND ${column} <= 80 THEN '61-80'
           WHEN ${column} >= 81 AND ${column} <= 100 THEN '81-100'
           ELSE NULL
         END AS bucket,
         profit_loss,
         actual_r
       FROM trades
       WHERE ${where}
         AND ${column} IS NOT NULL
     ) scored
     WHERE bucket IS NOT NULL
     GROUP BY bucket
     ORDER BY bucket`,
    params
  );
  return r.rows;
}

async function queryRiskStats(db, where, params) {
  const r = await db(
    `SELECT
       COUNT(*) FILTER (WHERE risk_percent IS NOT NULL)::int AS risk_count,
       COUNT(*)::int AS trade_count,
       AVG(risk_percent) FILTER (WHERE risk_percent IS NOT NULL)::numeric AS avg,
       STDDEV_POP(risk_percent) FILTER (WHERE risk_percent IS NOT NULL)::numeric AS stddev,
       MIN(risk_percent) FILTER (WHERE risk_percent IS NOT NULL)::numeric AS min,
       MAX(risk_percent) FILTER (WHERE risk_percent IS NOT NULL)::numeric AS max
     FROM trades WHERE ${where}`,
    params
  );
  return r.rows[0] || {};
}

async function queryExitEfficiency(db, where, params) {
  const r = await db(
    `SELECT
       COUNT(*) FILTER (WHERE mfe_r IS NOT NULL AND mfe_r > 0)::int AS sample_size,
       AVG(mfe_r) FILTER (WHERE mfe_r IS NOT NULL AND mfe_r > 0)::numeric AS avg_mfe,
       AVG(mae_r) FILTER (WHERE mae_r IS NOT NULL)::numeric AS avg_mae,
       AVG(actual_r) FILTER (WHERE mfe_r IS NOT NULL AND mfe_r > 0)::numeric AS avg_actual,
       AVG(actual_r / NULLIF(mfe_r, 0))
         FILTER (WHERE mfe_r IS NOT NULL AND mfe_r > 0 AND actual_r IS NOT NULL)::numeric AS avg_capture
     FROM trades WHERE ${where}`,
    params
  );
  const row = r.rows[0] || {};
  return {
    sampleSize: Number(row.sample_size) || 0,
    avgMfe: row.avg_mfe,
    avgMae: row.avg_mae,
    avgActualR: row.avg_actual,
    avgCapture: row.avg_capture,
  };
}

async function queryChronologicalPnl(db, where, params) {
  const r = await db(
    `SELECT profit_loss, trade_date
     FROM trades
     WHERE ${where}
     ORDER BY trade_date ASC, id ASC`,
    params
  );
  return r.rows;
}

module.exports = {
  SCORE_BUCKETS,
  evidenceOf,
  outcomesFromAgg,
  buildSegmentSignal,
  buildBucketSignal,
  buildEmotionSignal,
  buildMistakeSignal,
  buildRiskSignal,
  buildExitEfficiencySignal,
  buildStreakSignal,
  queryDimensionGroups,
  queryScoreBuckets,
  queryRiskStats,
  queryExitEfficiency,
  queryChronologicalPnl,
  confidenceBucket,
  normalizeSegmentValue,
};
