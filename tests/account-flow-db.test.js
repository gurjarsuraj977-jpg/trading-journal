/**
 * Phase 1 - manual account flow and account/trade integrity (needs TEST_DATABASE_URL).
 * Runs the REAL routes/account-routes.js handlers. The manual flow is
 * "Add Account -> Account Name + Starting Balance" (body = {name, startingBalance}).
 */
const assert = require("assert");
const { createTestDatabase } = require("./helpers/test-db");
const harness = require("./helpers/route-harness");
const init = require("../db/init");
const { n } = require("../utils/number");

let pass = 0, fail = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });
let c, router;
const call = (m, u, userId, body, query) => harness.call(router, m, u, { userId, body, query });

test("setup", async () => {
  c = await createTestDatabase();
  await init({ db: c.db });
  harness.install(c.pool);
  await c.db("INSERT INTO users(name,email,password_hash) VALUES ('A','a@example.test','x'),('B','b@example.test','x')");
  const { createAccountRouter } = require("../routes/account-routes");
  router = createAccountRouter({ db: c.db, auth: harness.fakeAuth, n });
});

test("manual Add Account keeps the exact name and starting balance", async () => {
  const r = await call("POST", "/", 1, { name: "Prop Firm A", startingBalance: 25000.5 });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.account.name, "Prop Firm A");
  assert.strictEqual(Number(r.body.account.starting_balance), 25000.5);
  const row = (await c.db("SELECT name,starting_balance,currency,account_type,active,is_primary,user_id FROM accounts WHERE id=$1", [r.body.account.id])).rows[0];
  assert.strictEqual(row.name, "Prop Firm A");
  assert.strictEqual(Number(row.starting_balance), 25000.5);
  assert.strictEqual(row.currency, "USD");
  assert.strictEqual(row.account_type, "manual");
  assert.strictEqual(row.active, true);
  assert.strictEqual(row.user_id, 1);
  assert.strictEqual(row.is_primary, true, "first account becomes primary");
  const second = await call("POST", "/", 1, { name: "Second", startingBalance: 0 });
  assert.strictEqual(second.status, 201);
  assert.strictEqual(Number((await c.db("SELECT starting_balance FROM accounts WHERE id=$1", [second.body.account.id])).rows[0].starting_balance), 0);
  assert.strictEqual((await c.db("SELECT COUNT(*)::int c FROM accounts WHERE user_id=1 AND is_primary")).rows[0].c, 1);
});

test("Add Account validation is unchanged (duplicate / negative / bad / short name)", async () => {
  const dup = await call("POST", "/", 1, { name: "Prop Firm A", startingBalance: 1 });
  assert.strictEqual(dup.status, 400);
  assert.match(dup.body.error, /already exists/);
  assert.strictEqual((await call("POST", "/", 1, { name: "Neg", startingBalance: -5 })).status, 400);
  assert.strictEqual((await call("POST", "/", 1, { name: "Bad", startingBalance: "abc" })).status, 400);
  assert.strictEqual((await call("POST", "/", 1, { name: "x", startingBalance: 1 })).status, 400);
  assert.strictEqual((await c.db("SELECT COUNT(*)::int c FROM accounts WHERE user_id=1")).rows[0].c, 2, "failed creates must not leave rows");
  // same name for a different user is allowed
  assert.strictEqual((await call("POST", "/", 2, { name: "Prop Firm A", startingBalance: 5 })).status, 201);
});

let aid, t1;
test("trades stay associated with their account (id and name), and account detail sees them", async () => {
  aid = (await c.db("SELECT id FROM accounts WHERE user_id=1 AND name='Prop Firm A'")).rows[0].id;
  for (const [pnl, d] of [[100, 1], [-40, 2], [0, 3]]) {
    await c.db("INSERT INTO trades(user_id,account,account_id,symbol,direction,entry,profit_loss,trade_date) VALUES (1,'Prop Firm A',$1,'EURUSD','BUY',1,$2,NOW() - ($3 || ' days')::interval)", [aid, pnl, d]);
  }
  t1 = (await c.db("SELECT id FROM trades WHERE user_id=1 ORDER BY id")).rows.map((r) => r.id);
  const r = await call("GET", "/" + aid, 1);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.performance.total, 3);
  assert.strictEqual(r.body.performance.wins, 1);
  assert.strictEqual(r.body.performance.losses, 1);
  assert.strictEqual(r.body.performance.breakeven, 1);
  assert.strictEqual(r.body.performance.pnl, 60);
  assert.strictEqual(r.body.performance.startingBalance, 25000.5);
  assert.strictEqual(r.body.trades.length, 3);
});

test("rename keeps every trade attached; archive/rename never move or delete trades", async () => {
  const r = await call("PUT", "/" + aid, 1, { name: "Prop Firm A (renamed)" });
  assert.strictEqual(r.status, 200);
  const rows = (await c.db("SELECT id,account,account_id FROM trades WHERE user_id=1 ORDER BY id")).rows;
  assert.deepStrictEqual(rows.map((x) => x.id), t1);
  assert.ok(rows.every((x) => x.account_id === aid && x.account === "Prop Firm A (renamed)"));
  assert.strictEqual((await call("PUT", "/" + aid, 1, { active: false })).status, 200);
  assert.strictEqual((await c.db("SELECT COUNT(*)::int c FROM trades WHERE account_id=$1", [aid])).rows[0].c, 3);
  assert.strictEqual(Number((await c.db("SELECT starting_balance FROM accounts WHERE id=$1", [aid])).rows[0].starting_balance), 25000.5);
});

test("an account with trades cannot be deleted (409) and nothing is lost", async () => {
  const r = await call("DELETE", "/" + aid, 1);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.tradeCount, 3);
  assert.strictEqual((await c.db("SELECT COUNT(*)::int c FROM accounts WHERE id=$1", [aid])).rows[0].c, 1);
  assert.strictEqual((await c.db("SELECT COUNT(*)::int c FROM trades WHERE account_id=$1", [aid])).rows[0].c, 3);
});

test("cross-user access: another user cannot read, change or delete the account", async () => {
  assert.strictEqual((await call("GET", "/" + aid, 2)).status, 404);
  assert.strictEqual((await call("PUT", "/" + aid, 2, { name: "Hijacked", startingBalance: 1 })).status, 404);
  assert.strictEqual((await call("DELETE", "/" + aid, 2)).status, 404);
  const row = (await c.db("SELECT name,starting_balance,user_id FROM accounts WHERE id=$1", [aid])).rows[0];
  assert.strictEqual(row.name, "Prop Firm A (renamed)");
  assert.strictEqual(Number(row.starting_balance), 25000.5);
  assert.strictEqual(row.user_id, 1);
  const list2 = await call("GET", "/", 2);
  assert.ok(list2.body.accounts.every((a) => a.user_id === 2));
  assert.strictEqual(list2.body.accounts.reduce((s, a) => s + a.trade_count, 0), 0);
});

test("an account without trades can be deleted by its owner only", async () => {
  const id2 = (await c.db("SELECT id FROM accounts WHERE user_id=1 AND name='Second'")).rows[0].id;
  assert.strictEqual((await call("DELETE", "/" + id2, 2)).status, 404);
  assert.strictEqual((await call("DELETE", "/" + id2, 1)).status, 200);
  assert.strictEqual((await c.db("SELECT COUNT(*)::int c FROM accounts WHERE id=$1", [id2])).rows[0].c, 0);
});

(async () => {
  for (const t of pending) {
    try { await t.fn(); console.log("PASS  " + t.name); pass++; }
    catch (e) { console.log("FAIL  " + t.name + "  ->  " + (e.stack || e.message).split("\n").slice(0, 4).join(" | ")); fail++; }
  }
  if (c) await c.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
