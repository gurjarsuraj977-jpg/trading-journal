/**
 * Behavioral Batch 3 — Patterns pure tests.
 * Run: node tests/behavior-patterns.test.js
 */
const assert = require("assert");
const { derivePatterns, emptySignals } = require("../behavior/patterns");
const { getBehaviorPatterns } = require("../behavior/service");

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

test("derivePatterns: empty signals → []", () => {
  assert.deepStrictEqual(derivePatterns(emptySignals()), []);
  assert.deepStrictEqual(derivePatterns(null), []);
});

test("derivePatterns: skips insufficient segments", () => {
  const patterns = derivePatterns({
    segments: [
      {
        dimension: "session",
        segment: "Asia",
        sampleSize: 3,
        difference: { averageR: 0.5 },
        evidence: { status: "insufficient", confidenceLevel: "none" },
      },
      {
        dimension: "session",
        segment: "London",
        sampleSize: 32,
        difference: { averageR: 0.1 },
        evidence: { status: "meaningful", confidenceLevel: "medium" },
      },
    ],
    confidence: [],
    emotions: [],
    ruleScore: [],
    mistakes: [],
    risk: null,
    exitEfficiency: null,
    streaks: null,
  });
  assert.strictEqual(patterns.length, 1);
  assert.strictEqual(patterns[0].type, "segment_performance");
  assert.strictEqual(patterns[0].segment, "London");
  assert.strictEqual(patterns[0].difference, 0.1);
});

test("derivePatterns: includes risk / exit / streaks", () => {
  const patterns = derivePatterns({
    segments: [],
    confidence: [],
    emotions: [],
    ruleScore: [],
    mistakes: [],
    risk: {
      sampleSize: 47,
      deviationPercent: 0.16,
      evidence: { status: "meaningful", confidenceLevel: "medium" },
    },
    exitEfficiency: {
      sampleSize: 34,
      averageCaptureRatio: 0.5,
      evidence: { status: "meaningful", confidenceLevel: "medium" },
    },
    streaks: {
      sampleSize: 100,
      longestWinStreak: 6,
      longestLossStreak: 4,
      evidence: { status: "strong", confidenceLevel: "high" },
    },
  });
  assert.strictEqual(patterns.length, 3);
  assert.ok(patterns.some((p) => p.type === "risk_consistency"));
  assert.ok(patterns.some((p) => p.type === "exit_efficiency"));
  assert.ok(patterns.some((p) => p.type === "streaks"));
});

test("derivePatterns: confidence and emotion types", () => {
  const patterns = derivePatterns({
    segments: [],
    confidence: [
      {
        dimension: "confidence",
        bucket: "81-100",
        sampleSize: 28,
        difference: 0.17,
        evidence: { status: "meaningful", confidenceLevel: "medium" },
      },
    ],
    emotions: [
      {
        dimension: "emotion_before",
        segment: "Calm",
        sampleSize: 15,
        difference: 0.05,
        evidence: { status: "emerging", confidenceLevel: "low" },
      },
    ],
    ruleScore: [],
    mistakes: [
      {
        dimension: "mistake",
        segment: "Late Entry",
        sampleSize: 12,
        difference: -0.31,
        evidence: { status: "emerging", confidenceLevel: "low" },
      },
    ],
    risk: null,
    exitEfficiency: null,
    streaks: null,
  });
  assert.strictEqual(patterns.length, 3);
  assert.ok(patterns.some((p) => p.type === "confidence_calibration"));
  assert.ok(patterns.some((p) => p.type === "emotion_segment"));
  assert.ok(patterns.some((p) => p.type === "mistake_impact"));
});

test("getBehaviorPatterns rejects missing userId", async () => {
  let ok = false;
  try {
    await getBehaviorPatterns(async () => ({ rows: [] }), {});
  } catch (e) {
    ok = /userId/i.test(e.message);
  }
  assert.ok(ok);
});

console.log("");
console.log(`Behavior patterns: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
