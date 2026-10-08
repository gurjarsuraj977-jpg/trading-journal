/**
 * Behavioral Intelligence service skeleton.
 *
 * Reuses Unified Metrics filter contract (buildTradeFilters).
 * Does NOT re-implement win rate / expectancy / PF / drawdown.
 * Does NOT expose HTTP routes yet (Batch 1 foundation only).
 */

const { buildTradeFilters } = require("../metrics/query-builder");
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

/**
 * Resolve the shared filter contract used by Unified Metrics.
 * Preserves user ownership, account dual-match, timezone dates, source.
 *
 * @param {Function} db
 * @param {object} opts  { userId, accountId?, accountName?, from?, to?, tz?, source? }
 * @returns {Promise<object>} filter result from buildTradeFilters
 */
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

/**
 * Skeleton entry points — full implementations land in later batches.
 * These establish the service contract without inventing metrics.
 */

async function getBehaviorSummary(_db, _opts) {
  // Batch 2+
  throw new Error("getBehaviorSummary not implemented in Batch 1");
}

async function getBehaviorSignals(_db, _opts) {
  // Batch 3+
  throw new Error("getBehaviorSignals not implemented in Batch 1");
}

async function getBehaviorBaseline(_db, _opts) {
  // Batch 2+
  throw new Error("getBehaviorBaseline not implemented in Batch 1");
}

module.exports = {
  resolveFilters,
  getBehaviorSummary,
  getBehaviorSignals,
  getBehaviorBaseline,
  // re-export pure helpers for convenience / testing
  getSampleStatus,
  shouldSurface,
  normalizeSegmentValue,
  buildSegmentKey,
  UNSPECIFIED,
  baselineDifference,
  confidenceBucket,
  riskDeviation,
  metricSignal,
};
