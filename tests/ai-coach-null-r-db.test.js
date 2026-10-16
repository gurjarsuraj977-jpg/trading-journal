/**
 * Phase 1 - AI coach must not crash when average R is unavailable (needs TEST_DATABASE_URL).
 * getMetrics().avgR is null when there is no R sample (e.g. a user with no
 * trades); the coach used to call null.toFixed() -> HTTP 500 "Coach unavailable."
 */
const assert = require("assert");
const { createTestDatabase } = require("./helpers/test-db");
const harness = require("./helpers/route-harness");
const init = require("../db/init");

delete process.env.OPENAI_API_KEY; // never reach an external provider from tests
let pass = 0, fail = 0, c, router;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });
const ask = (userId) => harness.call(router, "POST", "/coach", { userId, body: { question: "How am I doing?" } });

test("setup", async () => {
  c = await createTestDatabase();
  await init({ db: c.db });
  harness.install(c.pool);
  await c.db("INSERT INTO users(name,email,password_hash) VALUES ('A','a@example.test','x'),('B','b@example.test','x'),('C','c@example.test','x')");
  await c.db("INSERT INTO trades(user_id,account,symbol,direction,entry,profit_loss,actual_r) VALUES (2,'Main Account','EURUSD','BUY',1,100,2),(2,'Main Account','EURUSD','BUY',1,-50,-1)");
  await c.db("INSERT INTO trades(user_id,account,symbol,direction,entry,profit_loss,actual_r) VALUES (3,'Main Account','EURUSD','BUY',1,-50,NULL)");
  router = require("../routes/ai-coach-routes").createAiCoachRouter({ db: c.db, auth: harness.fakeAuth });
});
test("user with no trades gets a normal answer, not a 500", async () => {
  const r = await ask(1);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.mode, "local");
  assert.match(r.body.answer, /0 recorded trades/);
  assert.match(r.body.answer, /average R unavailable/);
  assert.doesNotMatch(r.body.answer, /NaN|undefined|null/);
});
test("user whose trades have no R values gets a normal answer", async () => {
  const r = await ask(3);
  assert.strictEqual(r.status, 200);
  assert.match(r.body.answer, /average R unavailable/);
});
test("user with R values still sees the numeric average R (0.50R)", async () => {
  const r = await ask(2);
  assert.strictEqual(r.status, 200);
  assert.match(r.body.answer, /2 recorded trades/);
  assert.match(r.body.answer, /0\.50R average R/);
});

(async () => {
  for (const t of pending) {
    try { await t.fn(); console.log("PASS  " + t.name); pass++; }
    catch (e) { console.log("FAIL  " + t.name + "  ->  " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")); fail++; }
  }
  if (c) await c.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
