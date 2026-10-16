/**
 * Phase 1 - database initialisation safety (needs TEST_DATABASE_URL).
 *   TEST_DATABASE_URL=postgres://.../ghosttrader_test node tests/db-init.test.js
 * Covers: clean-database init, idempotent re-run, and an in-place upgrade of a
 * representative legacy (pre-accounts-v2) schema that already holds user data.
 */
const assert = require("assert");
const { createTestDatabase } = require("./helpers/test-db");
const init = require("../db/init");

let pass = 0, fail = 0;
const pending = [];
const test = (name, fn) => pending.push({ name, fn });

const LEGACY_SCHEMA = `
CREATE TABLE users(id SERIAL PRIMARY KEY,name VARCHAR(80) NOT NULL,email VARCHAR(255) UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE accounts(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,name VARCHAR(100) NOT NULL,starting_balance NUMERIC(20,2) DEFAULT 0,currency VARCHAR(10) DEFAULT 'USD',created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(user_id,name));
CREATE TABLE trades(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,account VARCHAR(100) DEFAULT 'Main Account',symbol VARCHAR(30) NOT NULL,direction VARCHAR(10) NOT NULL CHECK(direction IN('BUY','SELL')),entry NUMERIC(20,8) NOT NULL,stop_loss NUMERIC(20,8),take_profit NUMERIC(20,8),exit_price NUMERIC(20,8),quantity NUMERIC(20,8) DEFAULT 1,risk_amount NUMERIC(20,2) DEFAULT 0,profit_loss NUMERIC(20,2) DEFAULT 0,strategy VARCHAR(100),session VARCHAR(40),notes TEXT,trade_date TIMESTAMPTZ DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW());
INSERT INTO users(id,name,email,password_hash) VALUES (1,'A','a@example.test','x'),(2,'B','b@example.test','x'),(3,'C','c@example.test','x');
SELECT setval('users_id_seq',3);
INSERT INTO accounts(user_id,name,starting_balance,currency) VALUES (1,'Main Account',10000,'USD'),(1,'Prop',50000.50,'EUR'),(2,'FTMO 100k',100000,'USD');
INSERT INTO trades(user_id,account,symbol,direction,entry,exit_price,profit_loss,risk_amount,notes) VALUES
 (1,'Main Account','EURUSD','BUY',1.1,1.11,100.25,50,'n1'),
 (1,'Main Account','EURUSD','SELL',1.1,1.12,-200,50,'n2'),
 (1,'Prop','XAUUSD','BUY',2000,2010,300.10,100,'n3'),
 (1,'Deleted Old Account','GBPUSD','BUY',1.3,1.31,-5,10,'orphan-name'),
 (2,'FTMO 100k','EURUSD','BUY',1.1,1.1,0,0,'be');`;

const snapshot = async (db, withLink = true) => ({
  trades: (await db(`SELECT id,user_id,account,${withLink ? "account_id," : ""}symbol,direction,entry,profit_loss,risk_amount,notes FROM trades ORDER BY id`)).rows,
  accounts: (await db("SELECT id,user_id,name,starting_balance,currency FROM accounts ORDER BY id")).rows,
  users: (await db(`SELECT id,name,email${withLink ? ",role,status" : ""} FROM users ORDER BY id`)).rows,
});

let T;

test("clean database: init creates the full schema and is idempotent", async () => {
  const c = await createTestDatabase();
  try {
    await init({ db: c.db });
    const tables = (await c.db("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map((r) => r.table_name);
    for (const t of ["users","accounts","trades","playbooks","playbook_rules","missed_trades","tradelocker_connections","mt5_connections","admin_audit_log","market_symbols","market_candles"]) {
      assert.ok(tables.includes(t), "missing table " + t);
    }
    const cons = (await c.db("SELECT conname FROM pg_constraint")).rows.map((r) => r.conname);
    for (const k of ["fk_trades_account_id","fk_trades_playbook_id","accounts_type_check","users_role_check","users_status_check"]) {
      assert.ok(cons.includes(k), "missing constraint " + k);
    }
    const before = (await c.db("SELECT (SELECT COUNT(*) FROM market_symbols) s,(SELECT COUNT(*) FROM market_timeframes) t")).rows[0];
    await init({ db: c.db });
    const after = (await c.db("SELECT (SELECT COUNT(*) FROM market_symbols) s,(SELECT COUNT(*) FROM market_timeframes) t")).rows[0];
    assert.deepStrictEqual(after, before);
  } finally { await c.close(); }
});

test("legacy upgrade: no user, account or trade data is lost or altered", async () => {
  const c = await createTestDatabase();
  try {
    await c.db(LEGACY_SCHEMA);
    const before = await snapshot(c.db, false);
    await init({ db: c.db });
    const after = await snapshot(c.db);

    assert.strictEqual(after.users.length, 3);
    assert.ok(after.users.every((u) => u.role === "user" && u.status === "active"), "existing users must stay active (not locked out)");
    assert.strictEqual(after.trades.length, before.trades.length);
    for (const b of before.trades) {
      const a = after.trades.find((t) => t.id === b.id);
      for (const k of ["user_id","account","symbol","direction","profit_loss","risk_amount","notes"]) {
        assert.strictEqual(String(a[k]), String(b[k]), `trade ${b.id}.${k} changed`);
      }
    }
    for (const b of before.accounts) {
      const a = after.accounts.find((x) => x.id === b.id);
      assert.strictEqual(a.name, b.name);
      assert.strictEqual(Number(a.starting_balance), Number(b.starting_balance));
      assert.strictEqual(a.currency, b.currency);
    }
    const id = (u, n) => after.accounts.find((a) => a.user_id === u && a.name === n).id;
    const link = (note) => after.trades.find((t) => t.notes === note).account_id;
    assert.strictEqual(link("n1"), id(1, "Main Account"));
    assert.strictEqual(link("n3"), id(1, "Prop"));
    assert.strictEqual(link("be"), id(2, "FTMO 100k"));
    assert.strictEqual(link("orphan-name"), null, "unmatched trade must stay NULL, never guessed");
    /* exactly one primary account per user that has accounts */
    const prim = (await c.db("SELECT user_id,COUNT(*)::int c FROM accounts WHERE is_primary GROUP BY user_id")).rows;
    assert.ok(prim.every((r) => r.c === 1));
    assert.strictEqual((await c.db("SELECT COUNT(*)::int c FROM accounts WHERE user_id=1 AND account_type='manual'")).rows[0].c, 2);
  } finally { await c.close(); }
});

test("legacy upgrade: running init again changes nothing (idempotent)", async () => {
  const c = await createTestDatabase();
  try {
    await c.db(LEGACY_SCHEMA);
    await init({ db: c.db });
    const once = await snapshot(c.db);
    await init({ db: c.db });
    await init({ db: c.db });
    assert.deepStrictEqual(await snapshot(c.db), once);
  } finally { await c.close(); }
});

test("boot does not resurrect 'Main Account' for a user who renamed it; user with no accounts still gets one", async () => {
  const c = await createTestDatabase();
  try {
    await c.db(LEGACY_SCHEMA);
    await init({ db: c.db });
    await init({ db: c.db });
    const u2 = (await c.db("SELECT name FROM accounts WHERE user_id=2 ORDER BY id")).rows.map((r) => r.name);
    assert.deepStrictEqual(u2, ["FTMO 100k"], "phantom account created for user 2: " + u2);
    const u3 = (await c.db("SELECT name FROM accounts WHERE user_id=3")).rows.map((r) => r.name);
    assert.deepStrictEqual(u3, ["Main Account"], "legacy user with zero accounts should get a Main Account");
  } finally { await c.close(); }
});

(async () => {
  for (const t of pending) {
    try { await t.fn(); console.log("PASS  " + t.name); pass++; }
    catch (e) { console.log("FAIL  " + t.name + "  ->  " + e.message); fail++; }
  }
  console.log(`\n${pass} passed, ${fail} failed (driver: ${T || "psql/pg"})`);
  process.exit(fail ? 1 : 0);
})();
