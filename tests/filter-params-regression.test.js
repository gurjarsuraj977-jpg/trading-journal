/**
 * Production regression: buildTradeFilters placeholder/param alignment.
 * Root cause of Render 08P01 / 42P18 on Execution, Simulation, Metrics.
 * Run: node tests/filter-params-regression.test.js
 */
const assert = require("assert");
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

/** Count $N placeholders in SQL (unique highest index). */
function placeholderCount(sql) {
  const found = new Set();
  const re = /\$(\d+)/g;
  let m;
  while ((m = re.exec(sql))) found.add(Number(m[1]));
  if (!found.size) return 0;
  return Math.max(...found);
}

function countMatches(sql) {
  const re = /\$(\d+)/g;
  let n = 0;
  while (re.exec(sql)) n++;
  return n;
}

// Mock db — resolveAccount not hit when no account opts
const mockDb = async () => ({ rows: [], rowCount: 0 });

async function check(label, opts) {
  const f = await buildTradeFilters(mockDb, { userId: 1, ...opts });
  const maxPh = placeholderCount(f.where);
  assert.strictEqual(
    f.params.length,
    maxPh,
    `${label}: params(${f.params.length}) != max placeholder $${maxPh}; where=${f.where}; params=${JSON.stringify(f.params)}`
  );
  // $1 is always userId
  assert.strictEqual(f.params[0], 1);
  // $2 is always tz (text)
  assert.strictEqual(typeof f.params[1], "string");
  // Explicit type anchor present
  assert.ok(
    f.where.includes("$2::text"),
    `${label}: missing $2::text type anchor`
  );
  return f;
}

test("no filters: params match placeholders", async () => {
  await check("none", {});
});

test("tz only", async () => {
  await check("tz", { tz: "Asia/Kolkata" });
});

test("from only", async () => {
  const f = await check("from", { from: "2024-01-01", tz: "UTC" });
  assert.ok(f.where.includes("timezone($2, trade_date)"));
});

test("to only", async () => {
  await check("to", { to: "2024-12-31" });
});

test("from + to", async () => {
  await check("from+to", { from: "2024-01-01", to: "2024-06-30", tz: "America/New_York" });
});

test("source only", async () => {
  const f = await check("source", { source: "manual" });
  assert.ok(f.where.includes("source ="));
});

test("all date+source filters", async () => {
  await check("all", {
    from: "2024-01-01",
    to: "2024-12-31",
    tz: "Asia/Kolkata",
    source: "tradelocker",
  });
});

test("execution-style call (accountName omitted, no dates)", async () => {
  // Mirrors routes/execution-routes.js
  const f = await buildTradeFilters(mockDb, {
    userId: 42,
    accountName: undefined,
    tz: "UTC",
  });
  assert.strictEqual(placeholderCount(f.where), f.params.length);
  assert.strictEqual(f.params.length, 2); // userId + tz only
  assert.ok(f.where.includes("user_id = $1"));
  assert.ok(f.where.includes("$2::text"));
});

test("simulation-style call", async () => {
  const f = await buildTradeFilters(mockDb, {
    userId: 7,
    accountName: undefined,
    tz: "UTC",
  });
  assert.strictEqual(placeholderCount(f.where), f.params.length);
});

test("AI-style getMetrics opts (userId only)", async () => {
  const f = await buildTradeFilters(mockDb, { userId: 99 });
  assert.strictEqual(f.params.length, 2);
  assert.strictEqual(placeholderCount(f.where), 2);
});

test("rejects missing userId", async () => {
  let threw = false;
  try {
    await buildTradeFilters(mockDb, {});
  } catch (e) {
    threw = /userId/i.test(e.message);
  }
  assert.ok(threw);
});

console.log("");
console.log(`Filter params regression: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
