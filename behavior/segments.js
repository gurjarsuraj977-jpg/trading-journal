/**
 * Pure helpers for behavioral segmentation.
 * Exact stored values are preserved — no lowercasing, no synonym merge.
 */

const UNSPECIFIED = "Unspecified";

/**
 * Normalize a segment value for grouping.
 * - null / undefined / empty / whitespace-only → "Unspecified"
 * - otherwise: trim surrounding whitespace, preserve original casing
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeSegmentValue(value) {
  if (value === null || value === undefined) return UNSPECIFIED;
  const s = String(value).trim();
  if (s === "") return UNSPECIFIED;
  return s;
}

/**
 * Build a stable segment key: "dimension:value"
 * Colon and special characters in the value are left as-is;
 * the key is simply dimension + ":" + normalized value.
 *
 * @param {string} dimension  e.g. "emotion_before", "strategy"
 * @param {*} value
 * @returns {string}
 */
function buildSegmentKey(dimension, value) {
  const dim = String(dimension || "").trim() || "unknown";
  const val = normalizeSegmentValue(value);
  return `${dim}:${val}`;
}

/**
 * Parse a segment key back into { dimension, value }.
 * Only the first colon is the separator.
 * @param {string} key
 * @returns {{ dimension: string, value: string }}
 */
function parseSegmentKey(key) {
  const s = String(key || "");
  const i = s.indexOf(":");
  if (i < 0) {
    return { dimension: s || "unknown", value: UNSPECIFIED };
  }
  return {
    dimension: s.slice(0, i) || "unknown",
    value: s.slice(i + 1) || UNSPECIFIED,
  };
}

module.exports = {
  UNSPECIFIED,
  normalizeSegmentValue,
  buildSegmentKey,
  parseSegmentKey,
};
