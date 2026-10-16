/**
 * Phase 1 - /api/premium breakdown statistics (needs TEST_DATABASE_URL).
 * Runs the REAL routes/premium-routes.js handler against a real PostgreSQL
 * database. Expected numbers are computed independently inside this test.
 */
const assert = require("assert");
const { createTestDatabase } = require("./helpers/test-db");
const harness = require("./helpers/route-harness");
const init = require("../db/init");

let pass = 0, fail = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });
const close = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m || ""} ${a} != ${b}`);

/* user 1 dataset: [symbol, strategy, pnl, actual_r, stop_loss, emotion, confidence] */
const D = [];
const add = (symbol, strategy, pnl, r, sl, emo, conf, account = "Main Account") =>
  D.push({ symbol, strategy, pnl, r, sl, emo, conf, account });
// EURUSD: +100(2R) +50(1R) -40(-0.8R) 0(0R) -60(-1.2R) -> winRate 50, PF 1.5, avgR 0.2, pnl 50
add("EURUSD", "Breakout", 100, 2, 1.09, "Calm", 70);
add("EURUSD", "Breakout", 50, 1, 1.09, "Calm", 70);
add("EURUSD", "Breakout", -40, -0.8, 1.09, "Calm", 70);
add("EURUSD", "Breakout", 0, 0, 1.09, "Calm", 70);
add("EURUSD", "Breakout", -60, -1.2, 1.09, "Calm", 70);
// USDJPY: no losing trades -> winRate 100, PF infinite, avgR 0.5
add("USDJPY", "Reversal", 30, 1, 150, null, 0);
add("USDJPY", "Reversal", 20, 0.5, 150, null, 0);
add("USDJPY", "Reversal", 0, 0, 150, null, 0);
// GBPUSD: no stop loss recorded -> app stores actual_r = 0 (dashboard counts it as 0R); one NULL R
add("GBPUSD", "Reversal", 10, 0, null, null, 0);
add("GBPUSD", "Reversal", 10, 0, null, null, 0);
add("GBPUSD", "Reversal", -4, null, null, null, 0);
// NZDUSD: no R values at all -> avgR must be null, not 0
add("NZDUSD", "Reversal", -1, null, 0.6, null, 0);
add("NZDUSD", "Reversal", -1, null, 0.6, null, 0);
add("NZDUSD", "Reversal", -1, null, 0.6, null, 0);
// XAUUSD: only 2 trades -> below the 3-trade threshold, not listed
add("XAUUSD", "Reversal", 5, 1, 1900, null, 0);
add("XAUUSD", "Reversal", 5, 1, 1900, null, 0);
// second account of the same user, excluded when filtering on Main Account
for (let i = 0; i < 3; i++) add("EURUSD", "Breakout", -10, -1, 1.09, "Calm", 70, "Prop");

/* independent reference calculation (plain loops, not the app's helpers) */
function ref(rows) {
  let w = 0, l = 0, be = 0, gp = 0, gl = 0, rs = 0, rn = 0, pnl = 0;
  for (const x of rows) {
    pnl += x.pnl;
    if (x.pnl > 0) { w++; gp += x.pnl; } else if (x.pnl < 0) { l++; gl += -x.pnl; } else be++;
    if (x.r !== null) { rs += x.r; rn++; }
  }
  return {
    trades: rows.length, pnl, wins: w, losses: l, breakeven: be,
    winRate: w + l ? (100 * w) / (w + l) : null,
    pf: gl > 0 ? gp / gl : null,
    pfInf: gl === 0 && gp > 0,
    avgR: rn ? rs / rn : null,
  };
}

async function setup() {
  const c = await createTestDatabase();
  await init({ db: c.db });
  harness.install(c.pool);
  await c.db("INSERT INTO users(name,email,password_hash) VALUES ('U1','u1@example.test','x'),('U2','u2@example.test','x'),('U3','u3@example.test','x')");
  await c.db("INSERT INTO accounts(user_id,name,starting_balance) VALUES (1,'Main Account',1000),(1,'Prop',1000),(2,'Main Account',1000)");
  const acc = async (u, n) => (await c.db("SELECT id FROM accounts WHERE user_id=$1 AND name=$2", [u, n])).rows[0].id;
  const ins = (u, a, x) =>
    c.db(
      `INSERT INTO trades(user_id,account,account_id,symbol,direction,entry,stop_loss,profit_loss,actual_r,risk_amount,strategy,emotion_before,confidence,trade_date)
       VALUES($1,$2,$3,$4,'BUY',1,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      [u, x.account, a, x.symbol, x.sl, x.pnl, x.r, x.sl === null ? 0 : 10, x.strategy, x.emo, x.conf]
    );
  for (const x of D) await ins(1, await acc(1, x.account), x);
  // user 2: large losses in the same symbols/strategies - must never leak into user 1's numbers
  for (let i = 0; i < 6; i++) await ins(2, await acc(2, "Main Account"), { symbol: "EURUSD", strategy: "Breakout", pnl: -999, r: -9, sl: 1, emo: "Calm", conf: 70, account: "Main Account" });
  const { createPremiumRouter } = require("../routes/premium-routes");
  const router = createPremiumRouter({ db: c.db, auth: harness.fakeAuth, fields: "id" });
  const get = (userId, query = {}) => harness.call(router, "GET", "/", { userId, query });
  return { c, get };
}

let ctx;
test("setup: schema + seed", async () => { ctx = await setup(); });

const byName = (arr, n) => arr.find((x) => x.name === n);

test("edge.symbols carry real win rate / profit factor / avg R (hand-checked EURUSD & USDJPY)", async () => {
  const r = await ctx.get(1, { account: "Main Account" });
  assert.strictEqual(r.status, 200);
  const eu = byName(r.body.edge.symbols, "EURUSD");
  assert.strictEqual(eu.trades, 5);
  close(eu.pnl, 50);
  close(eu.winRate, 50);          // 2 wins / (2 wins + 2 losses)
  close(eu.profitFactor, 1.5);    // 150 / 100
  close(eu.avgR, 0.2);            // (2+1-0.8+0-1.2)/5
  assert.strictEqual(eu.profitFactorInfinite, false);
  const jp = byName(r.body.edge.symbols, "USDJPY");
  close(jp.winRate, 100);
  assert.strictEqual(jp.profitFactor, null);
  assert.strictEqual(jp.profitFactorInfinite, true);
  close(jp.avgR, 0.5);
});

test("every group matches an independent calculation; nothing is a hardcoded 0", async () => {
  const r = await ctx.get(1, { account: "Main Account" });
  const main = D.filter((x) => x.account === "Main Account");
  for (const [list, key] of [[r.body.edge.symbols, "symbol"], [r.body.edge.strategies, "strategy"]]) {
    assert.ok(list.length >= 2);
    for (const g of list) {
      const e = ref(main.filter((x) => x[key] === g.name));
      assert.strictEqual(g.trades, e.trades, g.name);
      close(g.pnl, e.pnl, g.name + " pnl");
      assert.strictEqual(g.wins, e.wins); assert.strictEqual(g.losses, e.losses); assert.strictEqual(g.breakeven, e.breakeven);
      if (e.winRate === null) assert.strictEqual(g.winRate, null); else close(g.winRate, e.winRate, g.name + " winRate");
      if (e.pf === null) assert.strictEqual(g.profitFactor, null); else close(g.profitFactor, e.pf, g.name + " PF");
      assert.strictEqual(g.profitFactorInfinite, e.pfInf, g.name);
      if (e.avgR === null) assert.strictEqual(g.avgR, null, g.name + " avgR"); else close(g.avgR, e.avgR, g.name + " avgR");
    }
  }
});

test("threshold, missing-stop-loss and no-R behaviour", async () => {
  const r = await ctx.get(1, { account: "Main Account" });
  assert.strictEqual(byName(r.body.edge.symbols, "XAUUSD"), undefined, "2-trade group must stay hidden");
  const nz = byName(r.body.edge.symbols, "NZDUSD");
  assert.strictEqual(nz.avgR, null, "no R recorded is unavailable, not 0R");
  assert.strictEqual(nz.winRate, 0);
  assert.strictEqual(nz.profitFactor, 0);
  // GBPUSD (no stop loss): R values 0,0 are counted exactly like the dashboard does; NULL one is excluded
  const gb = byName(r.body.edge.symbols, "GBPUSD");
  close(gb.avgR, 0);
  close(gb.profitFactor, 5);
});

test("breakdown totals reconcile with the summary (same service, same filters)", async () => {
  const r = await ctx.get(1, { account: "Main Account" });
  const main = D.filter((x) => x.account === "Main Account");
  const all = ref(main);
  const s = r.body.summary;
  assert.strictEqual(s.tradeCount, all.trades);
  close(s.pnl, all.pnl);
  close(s.winRate, all.winRate);
  close(s.profitFactor, all.pf);
  close(s.avgR, all.avgR);
  const sym = ref(main.filter((x) => x.symbol === "EURUSD"));
  const all5 = r.body.edge.symbols.reduce((a, g) => a + g.trades, 0);
  assert.strictEqual(all5, main.length - 2, "all groups except the hidden 2-trade XAUUSD");
  assert.ok(sym.trades === 5);
});

test("user data boundary and account filter", async () => {
  const u1 = await ctx.get(1, {});
  const eu1 = byName(u1.body.edge.symbols, "EURUSD");
  assert.strictEqual(eu1.trades, 8, "5 Main + 3 Prop for user 1 only (user 2's 6 trades excluded)");
  close(eu1.pnl, 20);
  const u2 = await ctx.get(2, {});
  const eu2 = byName(u2.body.edge.symbols, "EURUSD");
  assert.strictEqual(eu2.trades, 6);
  close(eu2.pnl, -5994);
  assert.strictEqual(eu2.profitFactor, 0);
  assert.strictEqual(eu2.winRate, 0);
  const u3 = await ctx.get(3, {});
  assert.deepStrictEqual(u3.body.edge.symbols, []);
  assert.strictEqual(u3.body.summary.tradeCount, 0);
});

test("psychology and weekly stats are real; unavailable is null, not 0", async () => {
  const r = await ctx.get(1, { account: "Main Account" });
  const calm = byName(r.body.psychology.emotions, "Calm");
  assert.strictEqual(calm.trades, 5);
  close(calm.winRate, 50); close(calm.profitFactor, 1.5); close(calm.avgR, 0.2);
  const band = r.body.psychology.confidence.find((b) => b.label === "61-80");
  close(band.winRate, 50); close(band.profitFactor, 1.5); close(band.avgR, 0.2);
  const main = D.filter((x) => x.account === "Main Account");
  const e = ref(main);
  assert.strictEqual(r.body.weekly.current.trades, main.length);
  close(r.body.weekly.current.winRate, e.winRate);
  close(r.body.weekly.current.avgR, e.avgR);
  assert.strictEqual(r.body.weekly.previous.trades, 0);
  assert.strictEqual(r.body.weekly.previous.winRate, null);
  assert.strictEqual(r.body.weekly.previous.avgR, null);
  const u3 = await ctx.get(3, {});
  assert.deepStrictEqual(u3.body.psychology.emotions, []);
  assert.ok(!JSON.stringify(r.body).match(/NaN|Infinity/));
});

test("journals over 2000 trades: process/weekly data uses the MOST RECENT 2000 trades", async () => {
  await ctx.c.db("INSERT INTO accounts(user_id,name) VALUES (3,'Big')");
  const aid = (await ctx.c.db("SELECT id FROM accounts WHERE user_id=3")).rows[0].id;
  await ctx.c.db(
    `INSERT INTO trades(user_id,account,account_id,symbol,direction,entry,profit_loss,actual_r,trade_date)
     SELECT 3,'Big',$1,'EURUSD','BUY',1,-1,-1,TIMESTAMPTZ '2020-01-01' + (g || ' minutes')::interval FROM generate_series(1,2000) g`,
    [aid]
  );
  await ctx.c.db(
    `INSERT INTO trades(user_id,account,account_id,symbol,direction,entry,profit_loss,actual_r,trade_date)
     SELECT 3,'Big',$1,'EURUSD','BUY',1,1,1,NOW() FROM generate_series(1,5) g`,
    [aid]
  );
  const r = await ctx.get(3, {});
  assert.strictEqual(r.body.summary.tradeCount, 2005);
  assert.strictEqual(r.body.weekly.current.trades, 5, "this week's 5 trades were dropped before the fix");
  close(r.body.weekly.current.winRate, 100);
});

(async () => {
  for (const t of pending) {
    try { await t.fn(); console.log("PASS  " + t.name); pass++; }
    catch (e) { console.log("FAIL  " + t.name + "  ->  " + (e.stack || e.message).split("\n").slice(0, 4).join(" | ")); fail++; }
  }
  if (ctx) await ctx.c.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
