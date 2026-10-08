/**
 * Behavioral Intelligence — Trader Baseline pure tests (Batch 2).
 * Run: node tests/behavior-baseline.test.js
 *
 * DB-backed integration tests are not included: DATABASE_URL is not
 * assumed available in this environment. Filter/ownership isolation is
 * enforced by reusing metrics/query-builder (covered by metrics tests).
 */
const assert = require("assert");

const { getSampleStatus, STATUS, CONFIDENCE_LEVEL } = require("../behavior/confidence");
const {
  finiteOrNull,
  buildRiskBaseline,
  buildActivityBaseline,
  buildPsychologyBaseline,
  buildPerformanceBaseline,
  assembleBaseline,
} = require("../behavior/baselines");
const { getBehaviorBaseline } = require("../behavior/service");

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

// ── Sample size / evidence (Batch 1 contract reused) ─────────────

test("evidence: sampleSize 0 → insufficient", () => {
  const e = getSampleStatus(0);
  assert.strictEqual(e.status, STATUS.INSUFFICIENT);
  assert.strictEqual(e.confidenceLevel, CONFIDENCE_LEVEL.NONE);
});

test("evidence: sampleSize 1 → insufficient", () => {
  assert.strictEqual(getSampleStatus(1).status, STATUS.INSUFFICIENT);
});

test("evidence: sampleSize 7 → insufficient", () => {
  assert.strictEqual(getSampleStatus(7).status, STATUS.INSUFFICIENT);
});

test("evidence: sampleSize 8 → emerging", () => {
  assert.strictEqual(getSampleStatus(8).status, STATUS.EMERGING);
});

test("evidence: sampleSize 20 → meaningful", () => {
  assert.strictEqual(getSampleStatus(20).status, STATUS.MEANINGFUL);
});

test("evidence: sampleSize 50 → strong", () => {
  assert.strictEqual(getSampleStatus(50).status, STATUS.STRONG);
});

// ── Risk baseline ──────────────────────────────────────────────

test("risk: mean of 1,1,2 ≈ 1.333...", () => {
  // Pure aggregate simulation of SQL AVG/STDDEV_POP/MIN/MAX
  const values = [1, 1, 2];
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  const risk = buildRiskBaseline({
    count: 3,
    avg,
    stddev,
    min: 1,
    max: 2,
  });
  assert.ok(Math.abs(risk.averagePercent - 4 / 3) < 1e-9);
  assert.strictEqual(risk.minPercent, 1);
  assert.strictEqual(risk.maxPercent, 2);
  assert.ok(Number.isFinite(risk.stdDevPercent));
});

test("risk: empty → all null", () => {
  const risk = buildRiskBaseline({ count: 0 });
  assert.strictEqual(risk.averagePercent, null);
  assert.strictEqual(risk.stdDevPercent, null);
  assert.strictEqual(risk.minPercent, null);
  assert.strictEqual(risk.maxPercent, null);
});

test("risk: null/invalid averages → null fields", () => {
  const risk = buildRiskBaseline({
    count: 2,
    avg: NaN,
    stddev: Infinity,
    min: null,
    max: undefined,
  });
  assert.strictEqual(risk.averagePercent, null);
  assert.strictEqual(risk.stdDevPercent, null);
  assert.strictEqual(risk.minPercent, null);
  assert.strictEqual(risk.maxPercent, null);
});

test("risk: zero risk is valid numeric", () => {
  const risk = buildRiskBaseline({
    count: 1,
    avg: 0,
    stddev: 0,
    min: 0,
    max: 0,
  });
  assert.strictEqual(risk.averagePercent, 0);
  assert.strictEqual(risk.minPercent, 0);
  assert.strictEqual(risk.maxPercent, 0);
});

// ── Activity baseline ──────────────────────────────────────────

test("activity: 2+1+3 trades across 3 days → 2.0 per day", () => {
  const a = buildActivityBaseline(6, 3);
  assert.strictEqual(a.totalTrades, 6);
  assert.strictEqual(a.activeDays, 3);
  assert.strictEqual(a.tradesPerActiveDay, 2);
});

test("activity: zero active days → tradesPerActiveDay null", () => {
  const a = buildActivityBaseline(0, 0);
  assert.strictEqual(a.totalTrades, 0);
  assert.strictEqual(a.activeDays, 0);
  assert.strictEqual(a.tradesPerActiveDay, null);
});

test("activity: trades without days still null ratio", () => {
  // Should not happen in practice, but guard division
  const a = buildActivityBaseline(5, 0);
  assert.strictEqual(a.tradesPerActiveDay, null);
});

// ── Timezone / active-day definition (contract documentation) ──
// Active day = distinct timezone(tz, trade_date)::date.
// SQL uses $2 = tz from buildTradeFilters — same as Unified Metrics.
// Pure tests cannot execute PostgreSQL timezone(); we assert the
// builder contract and that zero days never divide.

test("activity contract: local-calendar definition documented", () => {
  // Boundary timestamps that fall on different UTC vs local days must
  // be grouped by the requested tz in SQL (queryActiveDays).
  // This pure test verifies the math layer only.
  const a = buildActivityBaseline(3, 2);
  assert.strictEqual(a.tradesPerActiveDay, 1.5);
});

// ── Psychology (zeros preserved) ───────────────────────────────

test("psychology: averages including zero", () => {
  const p = buildPsychologyBaseline({
    confCount: 3,
    avgConfidence: (0 + 50 + 100) / 3,
    ruleCount: 2,
    avgRuleScore: (0 + 80) / 2,
  });
  assert.ok(Math.abs(p.averageConfidence - 50) < 1e-9);
  assert.ok(Math.abs(p.averageRuleScore - 40) < 1e-9);
});

test("psychology: no rows → null", () => {
  const p = buildPsychologyBaseline({ confCount: 0, ruleCount: 0 });
  assert.strictEqual(p.averageConfidence, null);
  assert.strictEqual(p.averageRuleScore, null);
});

test("psychology: zero is not reinterpreted as unset", () => {
  const p = buildPsychologyBaseline({
    confCount: 1,
    avgConfidence: 0,
    ruleCount: 1,
    avgRuleScore: 0,
  });
  assert.strictEqual(p.averageConfidence, 0);
  assert.strictEqual(p.averageRuleScore, 0);
});

// ── Performance from Unified Metrics shape ─────────────────────

test("performance: empty metrics → nulls", () => {
  const p = buildPerformanceBaseline({ tradeCount: 0 });
  assert.strictEqual(p.expectancy, null);
  assert.strictEqual(p.averageR, null);
  assert.strictEqual(p.winRate, null);
  assert.strictEqual(p.pnl, null);
});

test("performance: maps Unified Metrics fields", () => {
  const p = buildPerformanceBaseline({
    tradeCount: 10,
    expectancy: 0.21,
    avgR: 0.18,
    totalR: 1.8,
    winRate: 54.2,
    pnl: 120.5,
  });
  assert.strictEqual(p.expectancy, 0.21);
  assert.strictEqual(p.averageR, 0.18);
  assert.strictEqual(p.totalR, 1.8);
  assert.strictEqual(p.winRate, 54.2);
  assert.strictEqual(p.pnl, 120.5);
});

// ── Assemble full baseline ─────────────────────────────────────

test("assembleBaseline: full contract shape", () => {
  const b = assembleBaseline({
    sampleSize: 127,
    performance: {
      expectancy: 0.21,
      averageR: 0.18,
      totalR: 22.86,
      winRate: 54.2,
      pnl: 1000,
    },
    risk: {
      averagePercent: 1.02,
      stdDevPercent: 0.18,
      minPercent: 0.5,
      maxPercent: 1.5,
    },
    activity: {
      totalTrades: 127,
      activeDays: 54,
      tradesPerActiveDay: 127 / 54,
    },
    psychology: {
      averageConfidence: 72.4,
      averageRuleScore: 84.1,
    },
  });
  assert.strictEqual(b.sampleSize, 127);
  assert.strictEqual(b.evidence.status, STATUS.STRONG);
  assert.strictEqual(b.evidence.confidenceLevel, CONFIDENCE_LEVEL.HIGH);
  assert.strictEqual(b.performance.expectancy, 0.21);
  assert.strictEqual(b.risk.averagePercent, 1.02);
  assert.strictEqual(b.activity.activeDays, 54);
  assert.strictEqual(b.psychology.averageConfidence, 72.4);
});

test("assembleBaseline: empty → nulls, no NaN", () => {
  const b = assembleBaseline({ sampleSize: 0 });
  assert.strictEqual(b.sampleSize, 0);
  assert.strictEqual(b.evidence.status, STATUS.INSUFFICIENT);
  assert.strictEqual(b.performance.expectancy, null);
  assert.strictEqual(b.risk.averagePercent, null);
  assert.strictEqual(b.activity.tradesPerActiveDay, null);
  assert.strictEqual(b.psychology.averageConfidence, null);
  // Ensure no NaN/Infinity leaked
  const json = JSON.stringify(b);
  assert.ok(!json.includes("NaN"));
  assert.ok(!json.includes("Infinity"));
});

// ── finiteOrNull ───────────────────────────────────────────────

test("finiteOrNull: rejects NaN/Infinity", () => {
  assert.strictEqual(finiteOrNull(NaN), null);
  assert.strictEqual(finiteOrNull(Infinity), null);
  assert.strictEqual(finiteOrNull(-Infinity), null);
  assert.strictEqual(finiteOrNull(null), null);
  assert.strictEqual(finiteOrNull(1.5), 1.5);
  assert.strictEqual(finiteOrNull(0), 0);
});

// ── Service: userId required ───────────────────────────────────

test("getBehaviorBaseline rejects missing userId", async () => {
  let threw = false;
  try {
    await getBehaviorBaseline(async () => ({ rows: [] }), {});
  } catch (e) {
    threw = /userId/i.test(e.message);
  }
  assert.ok(threw);
});

test("getBehaviorBaseline rejects invalid userId", async () => {
  let threw = false;
  try {
    await getBehaviorBaseline(async () => ({ rows: [] }), { userId: -1 });
  } catch (e) {
    threw = /userId/i.test(e.message);
  }
  assert.ok(threw);
});

// ── Summary ────────────────────────────────────────────────────

console.log("");
console.log(`Behavior baseline: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
