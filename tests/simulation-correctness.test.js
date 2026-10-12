/**
 * Batch F — Simulation correctness (D-10).
 * Executable tests against simulateTradeOutcome (real calculation).
 * Run: node tests/simulation-correctness.test.js
 */
const assert = require("assert");
const {
  simulateTradeOutcome,
} = require("../utils/simulate-outcome");

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

const target = 2;
const stop = 1;

// 1. BUY-path: stop only (MAE magnitude >= stop; MFE below target)
test("1. Stop-loss only (positive MAE magnitude hits stop)", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 0.5, mae_r: 1.2, actual_r: -0.3 },
    target,
    stop
  );
  assert.strictEqual(o.usable, true);
  assert.strictEqual(o.rr, -1);
  assert.strictEqual(o.reason, "stop");
});

// 2. SELL-path is identical at R layer (direction already normalized in storage)
test("2. Stop-loss only with negative stored MAE still uses magnitude", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 0.4, mae_r: -1.5, actual_r: -0.8 },
    target,
    stop
  );
  assert.strictEqual(o.usable, true);
  assert.strictEqual(o.rr, -1);
  assert.strictEqual(o.reason, "stop");
});

// 3. Target only
test("3. Take-profit only (MFE >= target, MAE below stop)", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 2.5, mae_r: 0.3, actual_r: 1.1 },
    target,
    stop
  );
  assert.strictEqual(o.usable, true);
  assert.strictEqual(o.rr, 2);
  assert.strictEqual(o.reason, "target");
});

// 4. Target only with signed MFE input
test("4. Take-profit uses abs(MFE)", () => {
  const o = simulateTradeOutcome(
    { mfe_r: -3, mae_r: 0.2, actual_r: 0.5 },
    target,
    stop
  );
  assert.strictEqual(o.rr, 2);
  assert.strictEqual(o.reason, "target");
});

// 5. Neither
test("5. Neither level hit → keep actual_r", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 1.0, mae_r: 0.5, actual_r: 0.7 },
    target,
    stop
  );
  assert.strictEqual(o.usable, true);
  assert.strictEqual(o.rr, 0.7);
  assert.strictEqual(o.reason, "neither_keep_actual");
});

// 6. Both crossed → conservative stop
test("6. Both levels met → conservative stop (not optimistic target)", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 3, mae_r: 1.5, actual_r: 0.2 },
    target,
    stop
  );
  assert.strictEqual(o.usable, true);
  assert.strictEqual(o.rr, -1);
  assert.strictEqual(o.reason, "both_conservative_stop");
});

// 7. MAE convention: positive magnitude compared to abs(stop)
test("7. MAE convention is non-negative magnitude vs abs(stopR)", () => {
  // Old bug: mae (positive) <= stop (negative) never true
  const o = simulateTradeOutcome(
    { mfe_r: 0, mae_r: 1.0, actual_r: -0.5 },
    2,
    1
  );
  assert.strictEqual(o.reason, "stop");
  assert.strictEqual(o.rr, -1);
});

// 8. Missing / invalid extremes
test("8a. Missing MFE and MAE → not usable", () => {
  const o = simulateTradeOutcome({ actual_r: 1 }, target, stop);
  assert.strictEqual(o.usable, false);
  assert.strictEqual(o.reason, "missing_extremes");
});

test("8b. Zero MFE and MAE treated as missing", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 0, mae_r: 0, actual_r: 1 },
    target,
    stop
  );
  assert.strictEqual(o.usable, false);
});

test("8c. Invalid levels → not usable", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 2, mae_r: 1, actual_r: 0 },
    0,
    1
  );
  assert.strictEqual(o.usable, false);
  assert.strictEqual(o.reason, "invalid_levels");
});

// 9. Determinism
test("9. Identical inputs produce identical outcomes", () => {
  const t = { mfe_r: 2.2, mae_r: 0.8, actual_r: 1.0 };
  const a = simulateTradeOutcome(t, 2, 1);
  const b = simulateTradeOutcome(t, 2, 1);
  assert.deepStrictEqual(a, b);
});

// Boundary equality
test("Boundary: MFE exactly equals target → target", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 2, mae_r: 0.1, actual_r: 0.5 },
    2,
    1
  );
  assert.strictEqual(o.reason, "target");
  assert.strictEqual(o.rr, 2);
});

test("Boundary: MAE exactly equals stop → stop", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 0.1, mae_r: 1, actual_r: -0.2 },
    2,
    1
  );
  assert.strictEqual(o.reason, "stop");
  assert.strictEqual(o.rr, -1);
});

test("stopR sign from client is ignored (positive or negative input)", () => {
  const t = { mfe_r: 0.2, mae_r: 1.1, actual_r: -0.4 };
  const a = simulateTradeOutcome(t, 2, 1);
  const b = simulateTradeOutcome(t, 2, -1);
  assert.deepStrictEqual(a, b);
});

test("Only MFE present can still hit target", () => {
  const o = simulateTradeOutcome(
    { mfe_r: 3, mae_r: null, actual_r: 0.5 },
    2,
    1
  );
  assert.strictEqual(o.reason, "target");
});

test("Only MAE present can still hit stop", () => {
  const o = simulateTradeOutcome(
    { mfe_r: null, mae_r: 1.5, actual_r: -0.5 },
    2,
    1
  );
  assert.strictEqual(o.reason, "stop");
});

console.log(`\nSimulation correctness: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
