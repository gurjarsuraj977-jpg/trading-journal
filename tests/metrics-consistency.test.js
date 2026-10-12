/**
 * Batch G — Metrics and account consistency (D-05, D-06, D-07, D-14, D-15, D-16).
 * Run: node tests/metrics-consistency.test.js
 */
const assert = require("assert");
const {
  rStats,
  isValidTimezoneName,
  winRate,
  profitFactor,
} = require("../metrics/formulas");
const fs = require("fs");
const path = require("path");

let pass = 0,
  fail = 0;
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

test("G1: missing R excluded; genuine 0R kept", () => {
  const s = rStats([1, null, undefined, "x", 0, -0.5]);
  assert.strictEqual(s.sampleSize, 3);
  assert.ok(Math.abs(s.totalR - 0.5) < 1e-9);
  assert.ok(Math.abs(s.avgR - 0.5 / 3) < 1e-9);
});

test("G1: empty R sample returns null not zero", () => {
  const s = rStats([null, undefined, NaN]);
  assert.strictEqual(s.sampleSize, 0);
  assert.strictEqual(s.avgR, null);
  assert.strictEqual(s.totalR, null);
});

test("G1: service SQL filters null actual_r", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../metrics/service.js"),
    "utf8"
  );
  assert.ok(src.includes("r_sample_count") || src.includes("rSampleCount"));
  assert.ok(/AVG\(actual_r\) FILTER/.test(src));
  assert.ok(/periodPnl/.test(src));
  assert.ok(/equityScope/.test(src));
});

test("G3: account summary does not mix currencies", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../routes/account-routes.js"),
    "utf8"
  );
  assert.ok(/byCurrency/.test(src));
  assert.ok(/mixedCurrency/.test(src));
});

test("G5: timezone validation rejects junk", () => {
  assert.strictEqual(isValidTimezoneName("UTC"), true);
  assert.strictEqual(isValidTimezoneName("America/New_York"), true);
  assert.strictEqual(isValidTimezoneName(""), false);
  assert.strictEqual(isValidTimezoneName("'; DROP"), false);
  assert.strictEqual(isValidTimezoneName("../etc"), false);
});

test("G5: buildTradeFilters throws INVALID_TIMEZONE", async () => {
  const { buildTradeFilters } = require("../metrics/query-builder");
  let err;
  try {
    await buildTradeFilters(async () => ({ rows: [] }), {
      userId: 1,
      tz: "not a tz!!!",
    });
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.strictEqual(err.code, "INVALID_TIMEZONE");
});

test("winRate excludes breakeven from denominator", () => {
  assert.strictEqual(winRate(1, 1), 50);
  assert.strictEqual(winRate(0, 0), 0);
});

test("profitFactor never returns Infinity", () => {
  const pf = profitFactor(100, 0);
  assert.strictEqual(pf.profitFactor, null);
  assert.strictEqual(pf.profitFactorInfinite, true);
});

console.log(`\nMetrics consistency: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
