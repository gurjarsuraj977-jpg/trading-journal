/**
 * Phase 1 - per-group (breakdown) metrics. Pure, no database.
 * Expected values are worked out by hand in the comments, not by the code under test.
 */
const assert = require("assert");
const { groupStats, summarizeTradeRows } = require("../metrics/formulas");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("PASS  " + name); pass++; }
  catch (e) { console.log("FAIL  " + name + "  ->  " + e.message); fail++; }
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const t = (pnl, r) => ({ pnl, r });

test("mixed win/loss/breakeven group", () => {
  // wins +100,+50 ; losses -40,-60 ; breakeven 0
  // winRate = 2/(2+2)=50 ; PF = 150/100 = 1.5 ; R = 2+1-0.8+0-1.2 = 1.0 over 5 -> 0.2
  const g = summarizeTradeRows([t(100, 2), t(50, 1), t(-40, -0.8), t(0, 0), t(-60, -1.2)]);
  assert.strictEqual(g.trades, 5);
  assert.strictEqual(g.wins, 2);
  assert.strictEqual(g.losses, 2);
  assert.strictEqual(g.breakeven, 1);
  close(g.winRate, 50);
  close(g.profitFactor, 1.5);
  assert.strictEqual(g.profitFactorInfinite, false);
  close(g.avgR, 0.2);
  assert.strictEqual(g.rSampleCount, 5);
});

test("no losing trades: profit factor is 'infinite' (null + flag), never Infinity/NaN", () => {
  // +30 (1R), +20 (0.5R), 0 (0R): winRate 2/2 = 100 ; avgR = 1.5/3 = 0.5
  const g = summarizeTradeRows([t(30, 1), t(20, 0.5), t(0, 0)]);
  close(g.winRate, 100);
  assert.strictEqual(g.profitFactor, null);
  assert.strictEqual(g.profitFactorInfinite, true);
  close(g.avgR, 0.5);
  assert.ok(!JSON.stringify(g).includes("Infinity") && !JSON.stringify(g).includes("NaN"));
});

test("all losses: win rate and profit factor are a genuine 0", () => {
  const g = summarizeTradeRows([t(-10, -1), t(-20, -2)]);
  assert.strictEqual(g.winRate, 0);
  assert.strictEqual(g.profitFactor, 0);
  assert.strictEqual(g.profitFactorInfinite, false);
  close(g.avgR, -1.5);
});

test("only breakeven trades: win rate and profit factor are unavailable (null), not 0", () => {
  const g = summarizeTradeRows([t(0, 0), t(0, 0)]);
  assert.strictEqual(g.winRate, null);
  assert.strictEqual(g.profitFactor, null);
  assert.strictEqual(g.profitFactorInfinite, false);
  assert.strictEqual(g.avgR, 0); // two recorded 0R values are a real 0R sample
});

test("missing R values are excluded from avgR; no R at all -> null (not 0)", () => {
  // R sample: 2 and -1 only -> avg 0.5 (null / undefined / '' / NaN / 'x' ignored)
  const g = summarizeTradeRows([t(10, 2), t(-5, -1), t(3, null), t(3, undefined), t(3, ""), t(3, NaN), t(3, "x")]);
  assert.strictEqual(g.rSampleCount, 2);
  close(g.avgR, 0.5);
  const none = summarizeTradeRows([t(10, null), t(-5, undefined)]);
  assert.strictEqual(none.avgR, null);
  assert.strictEqual(none.totalR, null);
  assert.strictEqual(none.rSampleCount, 0);
});

test("invalid P&L values are treated as breakeven, never poison sums", () => {
  const g = summarizeTradeRows([t(NaN, 1), t("abc", 1), t(undefined, 1), t(50, 1), t(-25, -1)]);
  assert.strictEqual(g.wins, 1);
  assert.strictEqual(g.losses, 1);
  assert.strictEqual(g.breakeven, 3);
  close(g.profitFactor, 2);
  close(g.winRate, 50);
});

test("empty dataset: everything unavailable, nothing divides by zero", () => {
  for (const g of [summarizeTradeRows([]), summarizeTradeRows(null), groupStats({}), groupStats(null)]) {
    assert.strictEqual(g.trades, 0);
    assert.strictEqual(g.winRate, null);
    assert.strictEqual(g.profitFactor, null);
    assert.strictEqual(g.profitFactorInfinite, false);
    assert.strictEqual(g.avgR, null);
  }
});

test("groupStats from SQL-style aggregates (string numerics) matches summarizeTradeRows", () => {
  const a = groupStats({ trades: 5, wins: 2, losses: 2, grossProfit: "150.00", grossLoss: "100.00", rSampleCount: 5, totalR: "1.0000" });
  const b = summarizeTradeRows([t(100, 2), t(50, 1), t(-40, -0.8), t(0, 0), t(-60, -1.2)]);
  for (const k of ["avgR", "totalR", "winRate", "profitFactor"]) close(a[k], b[k]);
  for (const k of ["trades", "wins", "losses", "breakeven", "rSampleCount", "profitFactorInfinite"]) {
    assert.strictEqual(a[k], b[k], k);
  }
});

test("non-finite aggregates never leak through", () => {
  const g = groupStats({ trades: 3, wins: 1, losses: 1, grossProfit: NaN, grossLoss: Infinity, rSampleCount: 2, totalR: NaN });
  for (const k of ["winRate", "profitFactor", "avgR", "totalR"]) {
    assert.ok(g[k] === null || Number.isFinite(g[k]), k);
  }
  assert.strictEqual(g.avgR, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
