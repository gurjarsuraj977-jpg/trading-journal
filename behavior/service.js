/**
 * Behavioral Intelligence service.
 *
 * Reuses Unified Metrics filter contract (buildTradeFilters).
 * Does NOT re-implement win rate / expectancy / PF / drawdown.
 * Batch 2: trader-specific baseline.
 * Batch 3: signals + patterns.
 */

const { buildTradeFilters } = require("../metrics/query-builder");
const { getMetrics } = require("../metrics/service");
const { getSampleStatus, shouldSurface } = require("./confidence");
const {
  normalizeSegmentValue,
  buildSegmentKey,
  UNSPECIFIED,
} = require("./segments");
const {
  baselineDifference,
  confidenceBucket,
  riskDeviation,
  metricSignal,
} = require("./signals");
const {
  buildRiskBaseline,
  buildActivityBaseline,
  buildPsychologyBaseline,
  buildPerformanceBaseline,
  assembleBaseline,
  queryBehavioralAggregates,
  queryActiveDays,
} = require("./baselines");
const {
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
} = require("./signal-builder");
const { derivePatterns, emptySignals } = require("./patterns");

async function resolveFilters(db, opts) {
  const userId = Number(opts.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("userId is required");
  }
  return buildTradeFilters(db, {
    userId,
    accountId: opts.accountId,
    accountName: opts.accountName,
    from: opts.from,
    to: opts.to,
    tz: opts.tz,
    source: opts.source,
  });
}

async function getBehaviorBaseline(db, opts) {
  const userId = Number(opts.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("userId is required");
  }

  const filter = await resolveFilters(db, opts);
  const { where, params } = filter;

  const m = await getMetrics(db, {
    userId,
    accountId: opts.accountId,
    accountName: opts.accountName,
    from: opts.from,
    to: opts.to,
    tz: opts.tz || filter.tz,
    source: opts.source,
    includeCurve: false,
    includeBreakdowns: false,
  });

  const [agg, activeDays] = await Promise.all([
    queryBehavioralAggregates(db, where, params),
    queryActiveDays(db, where, params),
  ]);

  const sampleSize = Number(m.tradeCount) || Number(agg.trade_count) || 0;

  return assembleBaseline({
    sampleSize,
    performance: buildPerformanceBaseline(m),
    risk: buildRiskBaseline({
      count: Number(agg.risk_count) || 0,
      avg: agg.avg_risk,
      stddev: agg.stddev_risk,
      min: agg.min_risk,
      max: agg.max_risk,
    }),
    activity: buildActivityBaseline(sampleSize, activeDays),
    psychology: buildPsychologyBaseline({
      confCount: Number(agg.conf_count) || 0,
      avgConfidence: agg.avg_confidence,
      ruleCount: Number(agg.rule_count) || 0,
      avgRuleScore: agg.avg_rule_score,
    }),
  });
}

/**
 * Evidence-backed behavioral signals under the selected filters.
 */
async function getBehaviorSignals(db, opts) {
  const userId = Number(opts.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("userId is required");
  }

  const filter = await resolveFilters(db, opts);
  const { where, params } = filter;

  const m = await getMetrics(db, {
    userId,
    accountId: opts.accountId,
    accountName: opts.accountName,
    from: opts.from,
    to: opts.to,
    tz: opts.tz || filter.tz,
    source: opts.source,
    includeCurve: false,
    includeBreakdowns: false,
  });

  const totalTrades = Number(m.tradeCount) || 0;
  if (totalTrades === 0) {
    return emptySignals();
  }

  const baselinePerf = {
    winRate: m.winRate,
    averageR: m.avgR,
    expectancy: m.expectancy,
  };
  const baselineRisk = m.avgRiskPercent;

  const DIMENSIONS = [
    ["session", "session"],
    ["strategy", "strategy"],
    ["setup", "setup"],
    ["market_condition", "market_condition"],
    ["symbol", "symbol"],
    ["direction", "direction"],
    ["source", "source"],
  ];

  const [
    dimResults,
    confBuckets,
    ruleBuckets,
    emotionBefore,
    emotionAfter,
    mistakes,
    riskStats,
    exitStats,
    chronoRows,
  ] = await Promise.all([
    Promise.all(
      DIMENSIONS.map(([dim, col]) =>
        queryDimensionGroups(db, where, params, col).then((rows) =>
          rows.map((row) =>
            buildSegmentSignal(dim, row.name, row, baselinePerf)
          )
        )
      )
    ),
    queryScoreBuckets(db, where, params, "confidence").then((rows) =>
      rows.map((row) =>
        buildBucketSignal("confidence", row.bucket, row, baselinePerf)
      )
    ),
    queryScoreBuckets(db, where, params, "rule_score").then((rows) =>
      rows.map((row) =>
        buildBucketSignal("rule_score", row.bucket, row, baselinePerf)
      )
    ),
    queryDimensionGroups(db, where, params, "emotion_before").then((rows) =>
      rows.map((row) =>
        buildEmotionSignal("emotion_before", row.name, row, baselinePerf)
      )
    ),
    queryDimensionGroups(db, where, params, "emotion_after").then((rows) =>
      rows.map((row) =>
        buildEmotionSignal("emotion_after", row.name, row, baselinePerf)
      )
    ),
    queryDimensionGroups(db, where, params, "mistakes").then((rows) =>
      rows
        .filter((row) => row.name !== "Unspecified")
        .map((row) =>
          buildMistakeSignal(row.name, row, totalTrades, baselinePerf)
        )
    ),
    queryRiskStats(db, where, params),
    queryExitEfficiency(db, where, params),
    queryChronologicalPnl(db, where, params),
  ]);

  const segments = dimResults.flat();

  // playbook_id as dimension (numeric → string)
  const playbookRows = await queryDimensionGroups(
    db,
    where,
    params,
    "CAST(playbook_id AS TEXT)"
  );
  for (const row of playbookRows) {
    if (row.name === "Unspecified") continue;
    segments.push(
      buildSegmentSignal("playbook", row.name, row, baselinePerf)
    );
  }

  return {
    segments,
    confidence: confBuckets,
    emotions: [...emotionBefore, ...emotionAfter],
    ruleScore: ruleBuckets,
    risk: buildRiskSignal(
      {
        avg: riskStats.avg,
        stddev: riskStats.stddev,
        min: riskStats.min,
        max: riskStats.max,
      },
      baselineRisk,
      Number(riskStats.trade_count) || totalTrades
    ),
    exitEfficiency: buildExitEfficiencySignal(exitStats),
    mistakes,
    streaks: buildStreakSignal(chronoRows),
  };
}

async function getBehaviorPatterns(db, opts) {
  const signals = await getBehaviorSignals(db, opts);
  return derivePatterns(signals);
}

async function getBehaviorSummary(_db, _opts) {
  throw new Error("getBehaviorSummary not implemented yet");
}

module.exports = {
  resolveFilters,
  getBehaviorBaseline,
  getBehaviorSignals,
  getBehaviorPatterns,
  getBehaviorSummary,
  getSampleStatus,
  shouldSurface,
  normalizeSegmentValue,
  buildSegmentKey,
  UNSPECIFIED,
  baselineDifference,
  confidenceBucket,
  riskDeviation,
  metricSignal,
  buildRiskBaseline,
  buildActivityBaseline,
  buildPsychologyBaseline,
  buildPerformanceBaseline,
  assembleBaseline,
  derivePatterns,
  emptySignals,
};
