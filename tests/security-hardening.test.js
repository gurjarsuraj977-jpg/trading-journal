/**
 * Batch J — Security and reliability hardening checks.
 * Run: node tests/security-hardening.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

let pass = 0,
  fail = 0;
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

const root = path.join(__dirname, "..");
const twelve = fs.readFileSync(path.join(root, "market-data/twelve-data.js"), "utf8");
const tl = fs.readFileSync(path.join(root, "tradelocker/tradelocker-client.js"), "utf8");
const auth = fs.readFileSync(path.join(root, "routes/auth-routes.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const exp = fs.readFileSync(path.join(root, "routes/export-routes.js"), "utf8");

test("J1: twelve-data uses fetchWithTimeout", () => {
  assert.ok(/function fetchWithTimeout/.test(twelve));
  assert.ok(/AbortController/.test(twelve));
  assert.ok(/Market data provider timed out/.test(twelve));
});

test("J1: TradeLocker client uses fetchWithTimeout", () => {
  assert.ok(/function fetchWithTimeout/.test(tl));
  assert.ok(/TradeLocker request timed out/.test(tl));
});

test("J4: logout bumps token_version", () => {
  assert.ok(/token_version = token_version \+ 1/.test(auth));
  assert.ok(/clearCookie\(["']gt_token["']\)/.test(auth));
});

test("J5: registration uses BEGIN/COMMIT transaction", () => {
  assert.ok(/INSERT INTO users/.test(auth));
  assert.ok(/INSERT INTO accounts/.test(auth));
  assert.ok(/BEGIN/.test(auth));
  assert.ok(/COMMIT/.test(auth));
  assert.ok(/ROLLBACK/.test(auth));
});

test("J6: baseline security headers still present", () => {
  assert.ok(/X-Content-Type-Options/.test(server));
  assert.ok(/X-Frame-Options/.test(server));
});

test("J7: CSV formula neutralization still present (Batch E)", () => {
  assert.ok(/csvCell/.test(exp));
  assert.ok(/screenshot_data/.test(exp));
});

test("Admin bootstrap behavior unchanged", () => {
  assert.ok(/maybeBootstrapAdmin/.test(auth));
  assert.ok(/INITIAL_ADMIN_EMAIL/.test(auth));
});

console.log(`\nSecurity hardening: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
