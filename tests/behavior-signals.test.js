/**
 * Behavioral Batch 3 — Signals pure tests.
 * Run: node tests/behavior-signals.test.js
 */
const assert = require("assert");
const { winRate, expectancy } = require("../metrics/formulas");
const { STATUS } = require("../behavior/confidence");
const {
  outcomesFromAgg,
  buildSegmentSignal,
  buildBucketSignal,
  buildEmotionSignal,
  buildMistakeSignal,
  buildRiskSignal,
  buildExitEfficiencySignal,
  buildStreakSignal,
  evidenceOf,
} = require("../behavior/signal-builder");
const { emptySignals } = require("../behavior/patterns");
const { getBehaviorSignals } = require("../behavior/service");
const { confidenceBucket } = require("../behavior/signals");
const { normalizeSegmentValue, UNSPECIFIED } = require("../behavior/segments");

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

const base = { winRate: 50, averageR: 0.1, expectancy: 0.05 };

// ── Empty ──────────────────────────────────────────────────────
test("emptySignals: no NaN/Infinity", () => {
  const s = emptySignals();
  assert.deepStrictEqual(s.segments, []);
  assert.strictEqual(s.risk, null);
  assert.strictEqual(s.exitEfficiency, null);
  assert.strictEqual(s.streaks, null);
  const j = JSON.stringify(s);
  assert.ok(!j.includes("NaN") && !j.includes("Infinity"));
});

test("getBehaviorSignals rejects missing userId", async () => {
  let ok = false;
  try {
    await getBehaviorSignals(async () => ({ rows: [] }), {});
  } catch (e) {
    ok = /userId/i.test(e.message);
  }
  assert.ok(ok);
});

// ── Outcomes / segment ─────────────────────────────────────────
test("outcomesFromAgg: uses Unified Metrics formulas", () => {
  const o = outcomesFromAgg({
    trades: 10,
    wins: 6,
    losses: 4,
    avg_win: 100,
    avg_loss: -50,
    avg_r: 0.2,
    total_r: 2.0,
  });
  assert.strictEqual(o.sampleSize, 10);
  assert.strictEqual(o.winRate, winRate(6, 4));
  assert.strictEqual(o.expectancy, expectancy(6, 4, 100, 50));
  assert.strictEqual(o.averageR, 0.2);
});

test("segment: single segment with baseline difference", () => {
  const s = buildSegmentSignal(
    "session",
    "London",
    {
      trades: 32,
      wins: 18,
      losses: 14,
      avg_win: 50,
      avg_loss: -30,
      avg_r: 0.24,
      total_r: 7.68,
    },
    base
  );
  assert.strictEqual(s.dimension, "session");
  assert.strictEqual(s.segment, "London");
  assert.strictEqual(s.sampleSize, 32);
  assert.strictEqual(s.evidence.status, STATUS.MEANINGFUL);
  assert.ok(Math.abs(s.difference.averageR - (0.24 - 0.1)) < 1e-9);
});

test("segment: sample size boundaries", () => {
  assert.strictEqual(
    buildSegmentSignal("s", "a", { trades: 7, wins: 1, losses: 1, avg_win: 1, avg_loss: -1, avg_r: 0, total_r: 0 }, base)
      .evidence.status,
    STATUS.INSUFFICIENT
  );
  assert.strictEqual(
    buildSegmentSignal("s", "a", { trades: 8, wins: 1, losses: 1, avg_win: 1, avg_loss: -1, avg_r: 0, total_r: 0 }, base)
      .evidence.status,
    STATUS.EMERGING
  );
  assert.strictEqual(
    buildSegmentSignal("s", "a", { trades: 50, wins: 1, losses: 1, avg_win: 1, avg_loss: -1, avg_r: 0, total_r: 0 }, base)
      .evidence.status,
    STATUS.STRONG
  );
});

// ── Confidence buckets ─────────────────────────────────────────
test("confidence bucket 0 preserved via confidenceBucket", () => {
  assert.strictEqual(confidenceBucket(0).label, "0-20");
});

test("confidence buckets boundaries", () => {
  assert.strictEqual(confidenceBucket(20).label, "0-20");
  assert.strictEqual(confidenceBucket(21).label, "21-40");
  assert.strictEqual(confidenceBucket(40).label, "21-40");
  assert.strictEqual(confidenceBucket(41).label, "41-60");
  assert.strictEqual(confidenceBucket(60).label, "41-60");
  assert.strictEqual(confidenceBucket(61).label, "61-80");
  assert.strictEqual(confidenceBucket(80).label, "61-80");
  assert.strictEqual(confidenceBucket(81).label, "81-100");
  assert.strictEqual(confidenceBucket(100).label, "81-100");
});

test("bucket signal structure", () => {
  const s = buildBucketSignal(
    "confidence",
    "81-100",
    { trades: 28, wins: 17, losses: 11, avg_win: 80, avg_loss: -40, avg_r: 0.31, total_r: 8.68 },
    base
  );
  assert.strictEqual(s.bucket, "81-100");
  assert.strictEqual(s.sampleSize, 28);
  assert.ok(Math.abs(s.difference - 0.21) < 1e-9);
  assert.strictEqual(s.evidence.status, STATUS.MEANINGFUL);
});

// ── Emotions ───────────────────────────────────────────────────
test("emotion normalize: null/empty/whitespace → Unspecified", () => {
  assert.strictEqual(normalizeSegmentValue(null), UNSPECIFIED);
  assert.strictEqual(normalizeSegmentValue(""), UNSPECIFIED);
  assert.strictEqual(normalizeSegmentValue("  "), UNSPECIFIED);
});

test("emotion normalize: case preserved", () => {
  assert.strictEqual(normalizeSegmentValue("Confident"), "Confident");
  assert.strictEqual(normalizeSegmentValue("fear"), "fear");
});

test("emotion signal", () => {
  const s = buildEmotionSignal(
    "emotion_before",
    "Confident",
    { trades: 21, wins: 13, losses: 8, avg_win: 60, avg_loss: -30, avg_r: 0.28, total_r: 5.88 },
    base
  );
  assert.strictEqual(s.segment, "Confident");
  assert.strictEqual(s.evidence.status, STATUS.MEANINGFUL);
});

// ── Rule score ─────────────────────────────────────────────────
test("rule score zero preserved in bucket signal", () => {
  const s = buildBucketSignal(
    "rule_score",
    "0-20",
    { trades: 5, wins: 1, losses: 4, avg_win: 10, avg_loss: -20, avg_r: -0.5, total_r: -2.5 },
    base
  );
  assert.strictEqual(s.bucket, "0-20");
  assert.strictEqual(s.sampleSize, 5);
  assert.strictEqual(s.evidence.status, STATUS.INSUFFICIENT);
});

// ── Risk ───────────────────────────────────────────────────────
test("risk signal: averages and deviation", () => {
  const s = buildRiskSignal(
    { avg: 1.18, stddev: 0.21, min: 0.5, max: 2.0 },
    1.02,
    47
  );
  assert.strictEqual(s.dimension, "risk");
  assert.strictEqual(s.averageRiskPercent, 1.18);
  assert.ok(Math.abs(s.deviationPercent - 0.16) < 1e-9);
  assert.strictEqual(s.evidence.status, STATUS.MEANINGFUL);
});

test("risk signal: empty → null", () => {
  assert.strictEqual(buildRiskSignal({}, 1, 0), null);
});

test("risk signal: zero values valid", () => {
  const s = buildRiskSignal({ avg: 0, stddev: 0, min: 0, max: 0 }, 0, 10);
  assert.strictEqual(s.averageRiskPercent, 0);
  assert.strictEqual(s.deviationPercent, 0);
});

// ── Exit efficiency ────────────────────────────────────────────
test("exit efficiency: valid capture", () => {
  const s = buildExitEfficiencySignal({
    sampleSize: 34,
    avgMfe: 1.82,
    avgMae: 0.4,
    avgActualR: 0.91,
    avgCapture: 0.5,
  });
  assert.strictEqual(s.averageCaptureRatio, 0.5);
  assert.strictEqual(s.evidence.status, STATUS.MEANINGFUL);
});

test("exit efficiency: zero sample → null", () => {
  assert.strictEqual(buildExitEfficiencySignal({ sampleSize: 0 }), null);
});

test("exit efficiency: no divide-by-zero in SQL path (mfe>0 filter)", () => {
  // Capture ratio only computed when mfe_r > 0 in queryExitEfficiency
  const s = buildExitEfficiencySignal({
    sampleSize: 2,
    avgMfe: 1,
    avgMae: null,
    avgActualR: 0.5,
    avgCapture: 0.5,
  });
  assert.strictEqual(s.averageCaptureRatio, 0.5);
});

// ── Mistakes ───────────────────────────────────────────────────
test("mistake frequency and impact", () => {
  const s = buildMistakeSignal(
    "Late Entry",
    { trades: 12, wins: 3, losses: 9, avg_win: 20, avg_loss: -25, avg_r: -0.17, total_r: -2.04 },
    144,
    base
  );
  assert.strictEqual(s.segment, "Late Entry");
  assert.ok(Math.abs(s.frequencyPercent - (12 / 144) * 100) < 1e-9);
  assert.ok(Math.abs(s.difference - (-0.17 - 0.1)) < 1e-9);
  assert.strictEqual(s.evidence.status, STATUS.EMERGING);
});

// ── Streaks ────────────────────────────────────────────────────
test("streaks: all wins", () => {
  const rows = [
    { profit_loss: 10 },
    { profit_loss: 20 },
    { profit_loss: 5 },
  ];
  const s = buildStreakSignal(rows);
  assert.strictEqual(s.longestWinStreak, 3);
  assert.strictEqual(s.longestLossStreak, 0);
  assert.strictEqual(s.sampleSize, 3);
});

test("streaks: all losses", () => {
  const s = buildStreakSignal([
    { profit_loss: -1 },
    { profit_loss: -2 },
    { profit_loss: -3 },
    { profit_loss: -4 },
  ]);
  assert.strictEqual(s.longestLossStreak, 4);
  assert.strictEqual(s.longestWinStreak, 0);
});

test("streaks: alternating", () => {
  const s = buildStreakSignal([
    { profit_loss: 1 },
    { profit_loss: -1 },
    { profit_loss: 1 },
    { profit_loss: -1 },
  ]);
  assert.strictEqual(s.longestWinStreak, 1);
  assert.strictEqual(s.longestLossStreak, 1);
});

test("streaks: mixed chronological", () => {
  const s = buildStreakSignal([
    { profit_loss: 1 },
    { profit_loss: 2 },
    { profit_loss: 3 },
    { profit_loss: -1 },
    { profit_loss: -2 },
    { profit_loss: 5 },
  ]);
  assert.strictEqual(s.longestWinStreak, 3);
  assert.strictEqual(s.longestLossStreak, 2);
});

test("streaks: empty → null", () => {
  assert.strictEqual(buildStreakSignal([]), null);
});

test("streaks: breakeven does not break streaks (equityStats)", () => {
  const s = buildStreakSignal([
    { profit_loss: 1 },
    { profit_loss: 0 },
    { profit_loss: 2 },
  ]);
  assert.strictEqual(s.longestWinStreak, 2);
});

console.log("");
console.log(`Behavior signals: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
