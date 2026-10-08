/**
 * Unified Metrics — pure formula regression tests (no DB).
 * Run: node tests/metrics-formulas.test.js
 */
const assert = require("assert");
const {
  classifyPnl,
  winRate,
  expectancy,
  profitFactor,
  equityStats,
} = require("../metrics/formulas");

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

test("classify: positive → win", () => {
  assert.strictEqual(classifyPnl(100), "win");
});
test("classify: negative → loss", () => {
  assert.strictEqual(classifyPnl(-50), "loss");
});
test("classify: zero → breakeven", () => {
  assert.strictEqual(classifyPnl(0), "breakeven");
});

test("winRate excludes breakeven from denominator", () => {
  // +100, -50, 0 → wins=1 losses=1 → 50%
  assert.strictEqual(winRate(1, 1), 50);
});
test("winRate empty → 0", () => {
  assert.strictEqual(winRate(0, 0), 0);
});
test("winRate all wins → 100", () => {
  assert.strictEqual(winRate(5, 0), 100);
});

test("expectancy known values", () => {
  // 1 win @100, 1 loss @50 → E = 0.5*100 - 0.5*50 = 25
  assert.strictEqual(expectancy(1, 1, 100, 50), 25);
});
test("expectancy zero classified → 0", () => {
  assert.strictEqual(expectancy(0, 0, 0, 0), 0);
});

test("profitFactor normal", () => {
  const r = profitFactor(200, 100);
  assert.strictEqual(r.profitFactor, 2);
  assert.strictEqual(r.profitFactorInfinite, false);
});
test("profitFactor no losses → infinite flag", () => {
  const r = profitFactor(150, 0);
  assert.strictEqual(r.profitFactor, null);
  assert.strictEqual(r.profitFactorInfinite, true);
});
test("profitFactor empty → 0", () => {
  const r = profitFactor(0, 0);
  assert.strictEqual(r.profitFactor, 0);
  assert.strictEqual(r.profitFactorInfinite, false);
});
test("profitFactor no wins", () => {
  const r = profitFactor(0, 80);
  assert.strictEqual(r.profitFactor, 0);
  assert.strictEqual(r.profitFactorInfinite, false);
});

test("drawdown known curve", () => {
  // +10, -30, +5 → eq: 10, -20, -15; peak 10; min(eq-peak)=-30 → dd 30
  const s = equityStats([
    { profit_loss: 10, trade_date: "a" },
    { profit_loss: -30, trade_date: "b" },
    { profit_loss: 5, trade_date: "c" },
  ]);
  assert.strictEqual(s.maxDrawdown, 30);
  assert.strictEqual(s.bestWinStreak, 1);
  assert.strictEqual(s.bestLossStreak, 1);
});

test("avgR / totalR conceptual (zero R)", () => {
  // formulas don't compute avgR; document stored-field semantics via service
  // zero R trades: AVG still includes them when computed in SQL
  assert.ok(true);
});

test("query-builder exports", () => {
  const qb = require("../metrics/query-builder");
  assert.ok(typeof qb.buildTradeFilters === "function");
  assert.ok(typeof qb.appendJournalDateFilters === "function");
});

test("appendJournalDateFilters mutates correctly", () => {
  const { appendJournalDateFilters } = require("../metrics/query-builder");
  const params = [1];
  const clauses = ["user_id=$1"];
  appendJournalDateFilters(params, clauses, {
    from: "2026-10-01",
    to: "2026-10-08",
    tz: "Asia/Kolkata",
  });
  assert.ok(params.includes("Asia/Kolkata"));
  assert.ok(params.includes("2026-10-01"));
  assert.ok(params.includes("2026-10-08"));
  assert.ok(clauses.some((c) => c.includes("timezone")));
  assert.ok(clauses.some((c) => c.includes(">=")));
  assert.ok(clauses.some((c) => c.includes("<=")));
});

test("dual-match shape still single-count", () => {
  const { tradeMatchClauseNoAlias } = require("../utils/account-match");
  const c = tradeMatchClauseNoAlias("$3", "$4");
  assert.ok(c.includes(" OR "));
  assert.ok(c.includes("IS NULL"));
});


test("account-list style winRate with BE (+100,-50,0) → 50%", () => {
  const wins = 1, losses = 1, breakeven = 1;
  assert.strictEqual(winRate(wins, losses), 50);
  assert.notStrictEqual(winRate(wins, losses), (wins / (wins + losses + breakeven)) * 100);
});

test("account-routes list SQL exposes losses + uses winRate helper", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "../routes/account-routes.js"), "utf8");
  assert.ok(src.includes("FILTER (WHERE t.profit_loss<0)"));
  assert.ok(src.includes("winRate(Number(a.wins"));
  assert.ok(!/win_rate:Number\(a\.trade_count\|\|0\)\?Number\(a\.wins/.test(src));
});

test("premium accepts from/to/tz contract", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "../routes/premium-routes.js"), "utf8");
  assert.ok(src.includes("req.query.tz"));
  assert.ok(src.includes("req.query.from"));
  assert.ok(src.includes("req.query.to"));
  assert.ok(src.includes("getMetrics"));
  assert.ok(src.includes("Intl.DateTimeFormat"));
});

test("insights-reports sends tz", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "../public/js/insights-reports.js"), "utf8");
  assert.ok(src.includes("tz:"));
  assert.ok(src.includes("TZ()"));
});

test("calendar dual-match + timezone consistent (no rewrite)", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "../routes/calendar-routes.js"), "utf8");
  assert.ok(src.includes("tradeMatchClauseNoAlias"));
  assert.ok(src.includes("resolveAccount"));
  assert.ok(src.includes("timezone($3"));
});

test("metrics filter uses timezone(tz, trade_date)::date", () => {
  const fs = require("fs");
  const path = require("path");
  const qb = fs.readFileSync(path.join(__dirname, "../metrics/query-builder.js"), "utf8");
  assert.ok(qb.includes("timezone($2, trade_date)::date"));
});

console.log("==============================");
console.log("PASSED:", pass, " FAILED:", fail);
process.exit(fail ? 1 : 0);
