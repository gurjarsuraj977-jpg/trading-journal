/**
 * Calendar day → Journal list date filter regression (P0).
 * Prevents PostgreSQL 42P18 from untyped AT TIME ZONE parameters.
 * Run: node tests/calendar-day-filter-regression.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  appendJournalDayFilter,
  appendJournalDateFilters,
} = require("../metrics/query-builder");

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

function maxPh(sql) {
  const s = new Set();
  const re = /\$(\d+)/g;
  let m;
  while ((m = re.exec(sql))) s.add(Number(m[1]));
  return s.size ? Math.max(...s) : 0;
}

function build(opts) {
  const params = [1]; // userId
  const clauses = ["user_id = $1"];
  if (opts.accountId) {
    params.push(opts.accountId, opts.accountName || "Main");
    clauses.push(
      `(account_id = $${params.length - 1} OR (account_id IS NULL AND account = $${params.length}))`
    );
  }
  if (opts.source) {
    params.push(opts.source);
    clauses.push(`source = $${params.length}`);
  }
  appendJournalDayFilter(params, clauses, {
    date: opts.date,
    tz: opts.tz,
  });
  return { params, where: clauses.join(" AND ") };
}

test("date only (tz defaults to UTC)", () => {
  const { params, where } = build({ date: "2026-01-15" });
  assert.ok(where.includes("timezone($"));
  assert.ok(where.includes("::text"));
  assert.ok(where.includes("= $"));
  assert.strictEqual(maxPh(where), params.length);
  assert.strictEqual(params[params.length - 2], "UTC");
  assert.strictEqual(params[params.length - 1], "2026-01-15");
});

test("date + tz=Asia/Kolkata", () => {
  const { params, where } = build({
    date: "2026-01-15",
    tz: "Asia/Kolkata",
  });
  assert.strictEqual(maxPh(where), params.length);
  assert.strictEqual(params[params.length - 2], "Asia/Kolkata");
  assert.strictEqual(params[params.length - 1], "2026-01-15");
  assert.ok(/timezone\(\$\d+::text, trade_date\)::date = \$\d+::date/.test(where));
});

test("date + account", () => {
  const { params, where } = build({
    date: "2026-01-15",
    tz: "UTC",
    accountId: 9,
    accountName: "Prop",
  });
  assert.strictEqual(maxPh(where), params.length);
  assert.ok(where.includes("account_id"));
});

test("date + source", () => {
  const { params, where } = build({
    date: "2026-06-01",
    tz: "UTC",
    source: "manual",
  });
  assert.strictEqual(maxPh(where), params.length);
  assert.ok(where.includes("source ="));
});

test("date + account + source + tz", () => {
  const { params, where } = build({
    date: "2026-01-15",
    tz: "America/New_York",
    accountId: 3,
    accountName: "Main Account",
    source: "tradelocker",
  });
  assert.strictEqual(maxPh(where), params.length);
  assert.strictEqual(params[0], 1);
  assert.ok(params.includes("America/New_York"));
  assert.ok(params.includes("2026-01-15"));
  assert.ok(params.includes("tradelocker"));
});

test("invalid date is a no-op", () => {
  const params = [1];
  const clauses = ["user_id = $1"];
  appendJournalDayFilter(params, clauses, { date: "not-a-date", tz: "UTC" });
  assert.strictEqual(params.length, 1);
  assert.strictEqual(clauses.length, 1);
});

test("server.js no longer uses AT TIME ZONE for date filter", () => {
  const src = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.ok(src.includes("appendJournalDayFilter"));
  // The old unsafe pattern must not remain for the date= path
  assert.ok(!src.includes("trade_date AT TIME ZONE"));
});

test("appendJournalDateFilters also types tz as text", () => {
  const params = [1];
  const clauses = ["user_id = $1"];
  appendJournalDateFilters(params, clauses, {
    from: "2026-01-01",
    to: "2026-01-31",
    tz: "Asia/Kolkata",
  });
  const where = clauses.join(" AND ");
  assert.strictEqual(maxPh(where), params.length);
  assert.ok(where.includes("::text"));
});

console.log("");
console.log(`Calendar day filter regression: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
