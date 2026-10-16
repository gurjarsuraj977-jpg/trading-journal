/**
 * Phase 1 - getBehaviorSummary(): decision + implementation.
 * Decision: it was an exported stub that always threw "not implemented yet" and
 * has no callers. It is now a thin composition of the existing baseline +
 * signals + patterns services (no duplicated logic). DB part needs TEST_DATABASE_URL;
 * the pure part always runs.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const svc = require("../behavior/service");

let pass = 0, fail = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

test("exported, no longer a throwing stub, and nobody imports it by a different shape", () => {
  assert.strictEqual(typeof svc.getBehaviorSummary, "function");
  const src = fs.readFileSync(path.join(__dirname, "..", "behavior", "service.js"), "utf8");
  assert.ok(!/not implemented/i.test(src));
  const callers = ["server.js", ...fs.readdirSync(path.join(__dirname, "..", "routes")).map((f) => "routes/" + f)]
    .filter((f) => /getBehaviorSummary/.test(fs.readFileSync(path.join(__dirname, "..", f), "utf8")));
  assert.deepStrictEqual(callers, [], "no route/server code depends on it: " + callers);
});

test("invalid userId is rejected like the other behavior services", async () => {
  await assert.rejects(() => svc.getBehaviorSummary(async () => ({ rows: [] }), {}), /userId is required/);
  await assert.rejects(() => svc.getBehaviorSummary(async () => ({ rows: [] }), { userId: "abc" }), /userId is required/);
});

(async () => {
  let c;
  if (process.env.TEST_DATABASE_URL) {
    const { createTestDatabase } = require("./helpers/test-db");
    const init = require("../db/init");
    test("DB: empty journal -> sampleSize 0, empty signals, no patterns", async () => {
      c = await createTestDatabase();
      await init({ db: c.db });
      await c.db("INSERT INTO users(name,email,password_hash) VALUES ('A','a@example.test','x'),('B','b@example.test','x')");
      const s = await svc.getBehaviorSummary(c.db, { userId: 1 });
      assert.strictEqual(s.sampleSize, 0);
      assert.deepStrictEqual(s.signals, svc.emptySignals());
      assert.deepStrictEqual(s.patterns, []);
      assert.strictEqual(s.baseline.sampleSize, 0);
    });
    test("DB: with trades it equals baseline + signals + patterns from the existing services, scoped to the user", async () => {
      await c.db(`INSERT INTO trades(user_id,account,symbol,direction,entry,profit_loss,actual_r,risk_percent,strategy,session,confidence,trade_date)
                  SELECT 1,'Main Account',CASE WHEN g%2=0 THEN 'EURUSD' ELSE 'XAUUSD' END,'BUY',1,
                         CASE WHEN g%3=0 THEN -50 ELSE 40 END, CASE WHEN g%3=0 THEN -1 ELSE 0.8 END, 1,
                         CASE WHEN g%2=0 THEN 'A' ELSE 'B' END,'London',60,NOW() - (g || ' hours')::interval
                  FROM generate_series(1,40) g`);
      await c.db("INSERT INTO trades(user_id,account,symbol,direction,entry,profit_loss,actual_r) SELECT 2,'Main Account','EURUSD','BUY',1,-999,-9 FROM generate_series(1,25)");
      const s = await svc.getBehaviorSummary(c.db, { userId: 1 });
      assert.strictEqual(s.sampleSize, 40, "user 2's trades must not be counted");
      assert.deepStrictEqual(s.baseline, await svc.getBehaviorBaseline(c.db, { userId: 1 }));
      assert.deepStrictEqual(s.signals, await svc.getBehaviorSignals(c.db, { userId: 1 }));
      assert.deepStrictEqual(s.patterns, await svc.getBehaviorPatterns(c.db, { userId: 1 }));
      assert.deepStrictEqual(s.patterns, svc.derivePatterns(s.signals));
      assert.ok(s.signals.segments.length > 0);
    });
  } else {
    console.log("SKIP  database part of getBehaviorSummary tests (TEST_DATABASE_URL is not set)");
  }
  for (const t of pending) {
    try { await t.fn(); console.log("PASS  " + t.name); pass++; }
    catch (e) { console.log("FAIL  " + t.name + "  ->  " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")); fail++; }
  }
  if (c) await c.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
