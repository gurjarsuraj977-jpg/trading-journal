/**
 * Behavioral Intelligence Foundation — pure-function tests (Batch 1).
 * Run: node tests/behavior-foundation.test.js
 */
const assert = require("assert");

const {
  getSampleStatus,
  shouldSurface,
  STATUS,
  CONFIDENCE_LEVEL,
} = require("../behavior/confidence");

const {
  normalizeSegmentValue,
  buildSegmentKey,
  parseSegmentKey,
  UNSPECIFIED,
} = require("../behavior/segments");

const {
  baselineDifference,
  confidenceBucket,
  riskDeviation,
  metricSignal,
} = require("../behavior/signals");

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
    pass++;
  } catch (e) {
    console.log("FAIL  " + name + "  ->  " + e.message);
    fail++;
  }
}

// ── Sample status ──────────────────────────────────────────────

test("sampleStatus: 0 → insufficient", () => {
  const r = getSampleStatus(0);
  assert.strictEqual(r.status, STATUS.INSUFFICIENT);
  assert.strictEqual(r.confidenceLevel, CONFIDENCE_LEVEL.NONE);
  assert.strictEqual(r.sampleSize, 0);
});

test("sampleStatus: 7 → insufficient", () => {
  assert.strictEqual(getSampleStatus(7).status, STATUS.INSUFFICIENT);
});

test("sampleStatus: 8 → emerging", () => {
  const r = getSampleStatus(8);
  assert.strictEqual(r.status, STATUS.EMERGING);
  assert.strictEqual(r.confidenceLevel, CONFIDENCE_LEVEL.LOW);
  assert.strictEqual(r.sampleSize, 8);
});

test("sampleStatus: 19 → emerging", () => {
  assert.strictEqual(getSampleStatus(19).status, STATUS.EMERGING);
});

test("sampleStatus: 20 → meaningful", () => {
  const r = getSampleStatus(20);
  assert.strictEqual(r.status, STATUS.MEANINGFUL);
  assert.strictEqual(r.confidenceLevel, CONFIDENCE_LEVEL.MEDIUM);
});

test("sampleStatus: 49 → meaningful", () => {
  assert.strictEqual(getSampleStatus(49).status, STATUS.MEANINGFUL);
});

test("sampleStatus: 50 → strong", () => {
  const r = getSampleStatus(50);
  assert.strictEqual(r.status, STATUS.STRONG);
  assert.strictEqual(r.confidenceLevel, CONFIDENCE_LEVEL.HIGH);
});

test("sampleStatus: 100 → strong", () => {
  assert.strictEqual(getSampleStatus(100).status, STATUS.STRONG);
});

test("sampleStatus: invalid → insufficient (size 0)", () => {
  const r = getSampleStatus(NaN);
  assert.strictEqual(r.status, STATUS.INSUFFICIENT);
  assert.strictEqual(r.sampleSize, 0);
});

test("shouldSurface: insufficient → false", () => {
  assert.strictEqual(shouldSurface(0), false);
  assert.strictEqual(shouldSurface(7), false);
});

test("shouldSurface: emerging+ → true", () => {
  assert.strictEqual(shouldSurface(8), true);
  assert.strictEqual(shouldSurface(50), true);
});

// ── Segment normalization ──────────────────────────────────────

test("normalize: null → Unspecified", () => {
  assert.strictEqual(normalizeSegmentValue(null), UNSPECIFIED);
});

test("normalize: undefined → Unspecified", () => {
  assert.strictEqual(normalizeSegmentValue(undefined), UNSPECIFIED);
});

test('normalize: "" → Unspecified', () => {
  assert.strictEqual(normalizeSegmentValue(""), UNSPECIFIED);
});

test('normalize: "   " → Unspecified', () => {
  assert.strictEqual(normalizeSegmentValue("   "), UNSPECIFIED);
});

test('normalize: "Fear" → Fear (preserve case)', () => {
  assert.strictEqual(normalizeSegmentValue("Fear"), "Fear");
});

test('normalize: "fear" → fear (no lowercasing)', () => {
  assert.strictEqual(normalizeSegmentValue("fear"), "fear");
});

test('normalize: " Fear " → "Fear" (trim only)', () => {
  assert.strictEqual(normalizeSegmentValue(" Fear "), "Fear");
});

// ── Segment keys ───────────────────────────────────────────────

test("buildSegmentKey: emotion_before:Fear", () => {
  assert.strictEqual(
    buildSegmentKey("emotion_before", "Fear"),
    "emotion_before:Fear"
  );
});

test("buildSegmentKey: strategy:Breakout", () => {
  assert.strictEqual(
    buildSegmentKey("strategy", "Breakout"),
    "strategy:Breakout"
  );
});

test("buildSegmentKey: empty value → Unspecified", () => {
  assert.strictEqual(
    buildSegmentKey("session", ""),
    "session:Unspecified"
  );
});

test("buildSegmentKey: special characters preserved", () => {
  assert.strictEqual(
    buildSegmentKey("setup", "Breakout (NY) — v2"),
    "setup:Breakout (NY) — v2"
  );
});

test("buildSegmentKey: value containing colon", () => {
  assert.strictEqual(
    buildSegmentKey("notes", "a:b:c"),
    "notes:a:b:c"
  );
});

test("parseSegmentKey: round-trip", () => {
  const key = buildSegmentKey("emotion_before", "Fear");
  const parsed = parseSegmentKey(key);
  assert.strictEqual(parsed.dimension, "emotion_before");
  assert.strictEqual(parsed.value, "Fear");
});

test("parseSegmentKey: value with colons", () => {
  const parsed = parseSegmentKey("notes:a:b:c");
  assert.strictEqual(parsed.dimension, "notes");
  assert.strictEqual(parsed.value, "a:b:c");
});

// ── Baseline difference ────────────────────────────────────────

test("baselineDifference: positive", () => {
  const r = baselineDifference(0.2, 0.1);
  assert.strictEqual(r.value, 0.2);
  assert.strictEqual(r.baseline, 0.1);
  assert.strictEqual(r.difference, 0.1);
});

test("baselineDifference: negative", () => {
  const r = baselineDifference(-0.3, 0.1);
  assert.strictEqual(r.difference, -0.4);
});

test("baselineDifference: equal", () => {
  assert.strictEqual(baselineDifference(1, 1).difference, 0);
});

test("baselineDifference: invalid → 0 fallback", () => {
  const r = baselineDifference(NaN, null);
  assert.strictEqual(r.value, 0);
  assert.strictEqual(r.baseline, 0);
  assert.strictEqual(r.difference, 0);
});

// ── Confidence buckets ─────────────────────────────────────────

test("confidenceBucket: 0 → 0-20", () => {
  const b = confidenceBucket(0);
  assert.strictEqual(b.label, "0-20");
  assert.strictEqual(b.min, 0);
  assert.strictEqual(b.max, 20);
});

test("confidenceBucket: 20 → 0-20", () => {
  assert.strictEqual(confidenceBucket(20).label, "0-20");
});

test("confidenceBucket: 21 → 21-40", () => {
  assert.strictEqual(confidenceBucket(21).label, "21-40");
});

test("confidenceBucket: 40 → 21-40", () => {
  assert.strictEqual(confidenceBucket(40).label, "21-40");
});

test("confidenceBucket: 41 → 41-60", () => {
  assert.strictEqual(confidenceBucket(41).label, "41-60");
});

test("confidenceBucket: 60 → 41-60", () => {
  assert.strictEqual(confidenceBucket(60).label, "41-60");
});

test("confidenceBucket: 61 → 61-80", () => {
  assert.strictEqual(confidenceBucket(61).label, "61-80");
});

test("confidenceBucket: 80 → 61-80", () => {
  assert.strictEqual(confidenceBucket(80).label, "61-80");
});

test("confidenceBucket: 81 → 81-100", () => {
  assert.strictEqual(confidenceBucket(81).label, "81-100");
});

test("confidenceBucket: 100 → 81-100", () => {
  assert.strictEqual(confidenceBucket(100).label, "81-100");
});

test("confidenceBucket: invalid → null", () => {
  assert.strictEqual(confidenceBucket(NaN), null);
  assert.strictEqual(confidenceBucket(undefined), null);
  assert.strictEqual(confidenceBucket(-1), null);
  assert.strictEqual(confidenceBucket(101), null);
});

// ── Risk deviation ─────────────────────────────────────────────

test("riskDeviation: above baseline (ratio 2)", () => {
  const r = riskDeviation(2, 1);
  assert.strictEqual(r.value, 2);
  assert.strictEqual(r.baseline, 1);
  assert.strictEqual(r.difference, 1);
  assert.strictEqual(r.ratio, 2);
  assert.strictEqual(r.direction, "above");
});

test("riskDeviation: below baseline", () => {
  const r = riskDeviation(0.5, 1);
  assert.strictEqual(r.direction, "below");
  assert.strictEqual(r.ratio, 0.5);
  assert.strictEqual(r.difference, -0.5);
});

test("riskDeviation: equal", () => {
  const r = riskDeviation(1.0, 1.0);
  assert.strictEqual(r.direction, "equal");
  assert.strictEqual(r.ratio, 1);
  assert.strictEqual(r.difference, 0);
});

test("riskDeviation: zero baseline, zero value → ratio 1", () => {
  const r = riskDeviation(0, 0);
  assert.strictEqual(r.ratio, 1);
  assert.strictEqual(r.direction, "equal");
});

test("riskDeviation: zero baseline, nonzero value → ratio null", () => {
  const r = riskDeviation(2, 0);
  assert.strictEqual(r.ratio, null);
  assert.strictEqual(r.direction, "above");
});

test("riskDeviation: missing value → unknown", () => {
  const r = riskDeviation(null, 1);
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.direction, "unknown");
  assert.strictEqual(r.ratio, null);
  assert.strictEqual(r.difference, null);
});

test("riskDeviation: missing baseline → unknown", () => {
  const r = riskDeviation(2, undefined);
  assert.strictEqual(r.baseline, null);
  assert.strictEqual(r.direction, "unknown");
});

test("riskDeviation: invalid numbers → unknown", () => {
  const r = riskDeviation("x", "y");
  assert.strictEqual(r.direction, "unknown");
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.baseline, null);
});

// ── metricSignal ───────────────────────────────────────────────

test("metricSignal: full contract", () => {
  const s = metricSignal({
    metric: "expectancy",
    dimension: "emotion_before",
    segmentValue: "Fear",
    sampleSize: 18,
    value: -0.21,
    baseline: 0.14,
  });
  assert.strictEqual(s.metric, "expectancy");
  assert.strictEqual(s.segment, "emotion_before:Fear");
  assert.strictEqual(s.sampleSize, 18);
  assert.strictEqual(s.value, -0.21);
  assert.strictEqual(s.baseline, 0.14);
  assert.ok(Math.abs(s.difference - -0.35) < 1e-9);
  assert.strictEqual(s.status, STATUS.EMERGING);
  assert.strictEqual(s.confidenceLevel, CONFIDENCE_LEVEL.LOW);
});

test("metricSignal: explicit segment key", () => {
  const s = metricSignal({
    metric: "avgR",
    segment: "strategy:Breakout",
    sampleSize: 55,
    value: 0.4,
    baseline: 0.2,
  });
  assert.strictEqual(s.segment, "strategy:Breakout");
  assert.strictEqual(s.status, STATUS.STRONG);
});

test("metricSignal: insufficient sample", () => {
  const s = metricSignal({
    metric: "winRate",
    sampleSize: 3,
    value: 100,
    baseline: 50,
  });
  assert.strictEqual(s.status, STATUS.INSUFFICIENT);
  assert.strictEqual(s.segment, "overall");
});

// ── Summary ────────────────────────────────────────────────────

console.log("");
console.log(`Behavioral foundation: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
