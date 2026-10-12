/**
 * Batch D — Trade-save safety (D-01/D-02/D-03/D-04/S-05).
 * Source-level tests against server.js. Run:
 *   node tests/trade-save-safety.test.js
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

const src = fs.readFileSync(
  path.join(__dirname, "..", "server.js"),
  "utf8"
);

test("D-02: financialUnchanged gate present on PUT", () => {
  assert.ok(/financialUnchanged/.test(src));
  assert.ok(/sameNum/.test(src));
  assert.ok(/historical integrity|today's rate/i.test(src));
});

test("D-02: metadata-only path preserves stored P&L fields", () => {
  assert.ok(/profitLoss:Number\(current\.profit_loss\)/.test(src));
  assert.ok(/riskAmount:Number\(current\.risk_amount\)/.test(src));
});

test("D-02: calculateManualTrade only when financial inputs change", () => {
  // In the PUT path, calculateManualTrade appears inside the else of financialUnchanged
  const putStart = src.indexOf('app.put("/api/trades/:id"');
  const putSection = src.slice(putStart, src.indexOf('app.delete("/api/trades/:id"'));
  assert.ok(/if\(financialUnchanged\)/.test(putSection));
  assert.ok(/else\s*\{[\s\S]*calculateManualTrade/.test(putSection));
});

test("D-03: oversized screenshot rejected with 400 (POST and PUT)", () => {
  assert.ok(/Screenshot is too large/.test(src));
  assert.ok(!/slice\(0,4500000\)/.test(src) || src.split("slice(0,4500000)").length <= 1);
});

test("D-04: invalid trade date returns 400", () => {
  assert.ok(/Invalid trade date/.test(src));
  assert.ok(/Number\.isNaN\(.*\.getTime\(\)\)/.test(src));
});

test("S-05: playbook ownership checked against user_id", () => {
  assert.ok(
    /SELECT id FROM playbooks WHERE id=\$1 AND user_id=\$2/.test(src)
  );
  assert.ok(/Playbook not found or not owned/.test(src));
});

test("S-05: invalid playbook ID rejected", () => {
  assert.ok(/Invalid playbook ID/.test(src));
});

test("PUT catch maps status 400 validation errors", () => {
  assert.ok(/e\.status===400/.test(src));
});

console.log(`\nTrade-save safety: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
