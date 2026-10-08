/**
 * Evidence-strength labels for behavioral signals.
 * These are NOT statistical significance / p-values.
 */

const SAMPLE_THRESHOLDS = Object.freeze({
  INSUFFICIENT_MAX: 7, // n < 8
  EMERGING_MAX: 19, // 8–19
  MEANINGFUL_MAX: 49, // 20–49
  // 50+ → strong
});

const STATUS = Object.freeze({
  INSUFFICIENT: "insufficient",
  EMERGING: "emerging",
  MEANINGFUL: "meaningful",
  STRONG: "strong",
});

const CONFIDENCE_LEVEL = Object.freeze({
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

/**
 * Map sample size → evidence status + confidence level.
 * @param {number} sampleSize
 * @returns {{ status: string, confidenceLevel: string, sampleSize: number }}
 */
function getSampleStatus(sampleSize) {
  const n = Number(sampleSize);
  const size = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;

  if (size <= SAMPLE_THRESHOLDS.INSUFFICIENT_MAX) {
    return {
      status: STATUS.INSUFFICIENT,
      confidenceLevel: CONFIDENCE_LEVEL.NONE,
      sampleSize: size,
    };
  }
  if (size <= SAMPLE_THRESHOLDS.EMERGING_MAX) {
    return {
      status: STATUS.EMERGING,
      confidenceLevel: CONFIDENCE_LEVEL.LOW,
      sampleSize: size,
    };
  }
  if (size <= SAMPLE_THRESHOLDS.MEANINGFUL_MAX) {
    return {
      status: STATUS.MEANINGFUL,
      confidenceLevel: CONFIDENCE_LEVEL.MEDIUM,
      sampleSize: size,
    };
  }
  return {
    status: STATUS.STRONG,
    confidenceLevel: CONFIDENCE_LEVEL.HIGH,
    sampleSize: size,
  };
}

/**
 * Whether a signal should be surfaced to the trader.
 * Insufficient evidence is never surfaced.
 * @param {number} sampleSize
 * @returns {boolean}
 */
function shouldSurface(sampleSize) {
  return getSampleStatus(sampleSize).status !== STATUS.INSUFFICIENT;
}

module.exports = {
  SAMPLE_THRESHOLDS,
  STATUS,
  CONFIDENCE_LEVEL,
  getSampleStatus,
  shouldSurface,
};
