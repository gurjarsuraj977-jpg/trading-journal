/**
 * Calendar → Journal frontend double-request regression.
 * Source-level contract tests (no browser).
 * Run: node tests/calendar-frontend-flow-regression.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

const read = (f) =>
  fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("state defines journalDate", () => {
  const s = read("public/js/state.js");
  assert.ok(/journalDate\s*:/.test(s));
});

test("calendar day click sets journalDate and does not pre-fetch trades", () => {
  const c = read("public/js/calendar.js");
  assert.ok(c.includes("state.journalDate=el.dataset.day") || c.includes("state.journalDate = el.dataset.day"));
  assert.ok(!c.includes("/api/trades?date="));
  assert.ok(c.includes("page('trades')") || c.includes('page("trades")'));
});

test("trades() applies journalDate to request query", () => {
  const t = read("public/js/trades.js");
  assert.ok(t.includes("state.journalDate"));
  assert.ok(/q\.set\(\s*['\"]date['\"]/.test(t));
  assert.ok(/q\.set\(\s*['\"]tz['\"]/.test(t));
});

test("nav to Journal clears journalDate (desktop)", () => {
  const a = read("public/app.js");
  assert.ok(a.includes("state.journalDate=null") || a.includes("state.journalDate = null"));
  assert.ok(/dataset\.p\s*===\s*['\"]trades['\"]/.test(a));
});

test("page('trades') still invokes trades()", () => {
  const a = read("public/app.js");
  assert.ok(/if\s*\(\s*p\s*===\s*['\"]trades['\"]\s*\)/.test(a));
  assert.ok(a.includes("trades()"));
});

console.log("");
console.log(`Calendar frontend flow regression: ${pass} PASS, ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
