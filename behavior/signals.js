/**
 * Pure behavioral calculation helpers.
 * Does NOT re-implement win rate, expectancy, profit factor, etc.
 * Those remain the authority of metrics/formulas.js.
 */

const { getSampleStatus } = require("./confidence");
const { buildSegmentKey } = require("./segments");

/**
 * Difference of an observed value against a baseline.
 * @param {number} value
 * @param {number} baseline
 * @returns {{ value: number, baseline: number, difference: number }}
 */
function baselineDifference(value, baseline) {
  const v = toFinite(value, 0);
  const b = toFinite(baseline, 0);
  return {
    value: v,
    baseline: b,
    difference: v - b,
  };
}

/**
 * Confidence buckets matching existing Premium Insights ranges.
 * Confidence is stored as INTEGER 0–100; 0 is preserved as-is.
 *
 * @param {number} confidence
 * @returns {{ label: string, min: number, max: number } | null}
 */
function confidenceBucket(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return null;

  // Boundaries inclusive as used in premium-routes
  if (c >= 0 && c <= 20) return { label: "0-20", min: 0, max: 20 };
  if (c >= 21 && c <= 40) return { label: "21-40", min: 21, max: 40 };
  if (c >= 41 && c <= 60) return { label: "41-60", min: 41, max: 60 };
  if (c >= 61 && c <= 80) return { label: "61-80", min: 61, max: 80 };
  if (c >= 81 && c <= 100) return { label: "81-100", min: 81, max: 100 };
  return null;
}

/**
 * Compare a trade's risk % against a baseline risk %.
 * Handles null/undefined/zero baseline without NaN/Infinity.
 *
 * @param {number|null|undefined} riskPercent
 * @param {number|null|undefined} baselineRiskPercent
 * @returns {{
 *   value: number|null,
 *   baseline: number|null,
 *   difference: number|null,
 *   ratio: number|null,
 *   direction: "above"|"below"|"equal"|"unknown"
 * }}
 */
function riskDeviation(riskPercent, baselineRiskPercent) {
  const value = toFiniteOrNull(riskPercent);
  const baseline = toFiniteOrNull(baselineRiskPercent);

  if (value === null || baseline === null) {
    return {
      value,
      baseline,
      difference: null,
      ratio: null,
      direction: "unknown",
    };
  }

  const difference = value - baseline;
  let ratio = null;
  if (baseline === 0) {
    // Avoid Infinity: if baseline is 0 and value is 0 → ratio 1; else null
    ratio = value === 0 ? 1 : null;
  } else {
    ratio = value / baseline;
  }

  let direction = "equal";
  if (difference > 0) direction = "above";
  else if (difference < 0) direction = "below";

  return {
    value,
    baseline,
    difference,
    ratio,
    direction,
  };
}

/**
 * Standard behavioral signal object.
 * @param {object} opts
 * @param {string} opts.metric
 * @param {string} [opts.segment]  full key or raw segment label
 * @param {string} [opts.dimension]
 * @param {*} [opts.segmentValue]
 * @param {number} opts.sampleSize
 * @param {number} opts.value
 * @param {number} opts.baseline
 * @returns {{
 *   metric: string,
 *   segment: string,
 *   sampleSize: number,
 *   value: number,
 *   baseline: number,
 *   difference: number,
 *   status: string,
 *   confidenceLevel: string
 * }}
 */
function metricSignal(opts) {
  const sampleSize = Math.max(0, Math.floor(Number(opts.sampleSize) || 0));
  const { status, confidenceLevel } = getSampleStatus(sampleSize);
  const { value, baseline, difference } = baselineDifference(
    opts.value,
    opts.baseline
  );

  let segment = opts.segment;
  if (!segment && opts.dimension != null) {
    segment = buildSegmentKey(opts.dimension, opts.segmentValue);
  }
  if (!segment) segment = "overall";

  return {
    metric: String(opts.metric || "unknown"),
    segment: String(segment),
    sampleSize,
    value,
    baseline,
    difference,
    status,
    confidenceLevel,
  };
}

function toFinite(n, fallback) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function toFiniteOrNull(n) {
  if (n === null || n === undefined) return null;
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

module.exports = {
  baselineDifference,
  confidenceBucket,
  riskDeviation,
  metricSignal,
};
