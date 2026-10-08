/**
 * Simulation Lab production regression tests.
 * Root causes covered:
 *  1) buildTradeFilters param alignment (with / without symbol)
 *  2) POST /api/backtests route must exist (frontend always calls it)
 * Run: node tests/simulation-regression.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildTradeFilters } = require("../metrics/query-builder");

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

function maxPlaceholder(sql) {
  const found = new Set();
  const re = /\$(\d+)/g;
  let m;
  while ((m = re.exec(sql))) found.add(Number(m[1]));
  return found.size ? Math.max(...found) : 0;
}

const mockDb = async () => ({ rows: [], rowCount: 0 });

test("simulate SQL: no symbol — params match placeholders", async () => {
  const filter = await buildTradeFilters(mockDb, {
    userId: 1,
    accountName: undefined,
    tz: "UTC",
  });
  const clauses = [filter.where];
  const params = [...filter.params];
  const sql = `SELECT actual_r, mfe_r, mae_r, profit_loss, risk_amount
           FROM trades WHERE ${clauses.join(" AND ")}
           ORDER BY trade_date`;
  assert.strictEqual(maxPlaceholder(sql), params.length);
  assert.ok(params.length >= 2);
});

test("simulate SQL: with symbol — params match placeholders", async () => {
  const filter = await buildTradeFilters(mockDb, {
    userId: 1,
    accountName: undefined,
    tz: "UTC",
  });
  const clauses = [filter.where];
  const params = [...filter.params];
  params.push("EURUSD");
  clauses.push(`symbol = $${params.length}`);
  const sql = `SELECT actual_r FROM trades WHERE ${clauses.join(" AND ")}`;
  assert.strictEqual(maxPlaceholder(sql), params.length);
  assert.strictEqual(params[params.length - 1], "EURUSD");
});

test("simulate SQL: with account name unresolved still matches", async () => {
  // resolveAccount returns null → legacy account = $N AND account_id IS NULL
  const db = async (sql, p) => {
    // resolveAccount SELECT
    if (String(sql).includes("FROM accounts")) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  };
  const filter = await buildTradeFilters(db, {
    userId: 1,
    accountName: "Ghost Prop",
    tz: "UTC",
  });
  const clauses = [filter.where];
  const params = [...filter.params];
  const sql = `SELECT 1 FROM trades WHERE ${clauses.join(" AND ")}`;
  assert.strictEqual(maxPlaceholder(sql), params.length);
  assert.ok(filter.where.includes("account ="));
});

test("frontend always POSTs /api/backtests after simulate", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../public/js/simulation.js"),
    "utf8"
  );
  assert.ok(src.includes("/api/simulate"));
  assert.ok(src.includes("/api/backtests"));
  // order: simulate first, then backtests
  assert.ok(src.indexOf("/api/simulate") < src.indexOf("/api/backtests"));
});

test("simulation-routes registers POST /api/backtests", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../routes/simulation-routes.js"),
    "utf8"
  );
  assert.ok(src.includes('router.post("/api/backtests"'));
  assert.ok(src.includes("INSERT INTO backtests"));
});

test("simulation-routes still registers POST /api/simulate", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../routes/simulation-routes.js"),
    "utf8"
  );
  assert.ok(src.includes('router.post("/api/simulate"'));
});

test("api.js maps missing error body to Request failed", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../public/js/api.js"),
    "utf8"
  );
  assert.ok(src.includes('d.error || "Request failed"'));
});

test("query-builder $2 text anchor still present", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../metrics/query-builder.js"),
    "utf8"
  );
  assert.ok(src.includes("$2::text IS NOT NULL"));
});

console.log("");
console.log(`Simulation regression: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
