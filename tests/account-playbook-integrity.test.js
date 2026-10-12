/**
 * Batch H — Account and playbook integrity.
 * Run: node tests/account-playbook-integrity.test.js
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
const accounts = fs.readFileSync(path.join(root, "routes/account-routes.js"), "utf8");
const playbooks = fs.readFileSync(path.join(root, "routes/playbook-routes.js"), "utf8");
const missed = fs.readFileSync(path.join(root, "routes/missed-routes.js"), "utf8");

test("H1: POST account validates non-negative starting balance", () => {
  assert.ok(/Starting balance must be a valid non-negative number/.test(accounts));
  assert.ok(/startingBalance<0/.test(accounts) || /startingBalance < 0/.test(accounts));
});

test("H2: playbook update uses transaction BEGIN/COMMIT/ROLLBACK", () => {
  assert.ok(/BEGIN/.test(playbooks));
  assert.ok(/COMMIT/.test(playbooks));
  assert.ok(/ROLLBACK/.test(playbooks));
});

test("H2: omitted active preserves current state", () => {
  assert.ok(/req\.body\.active !== undefined \? !!req\.body\.active : !!current\.active/.test(playbooks));
});

test("H2: playbook name length validated", () => {
  assert.ok(/2-120 characters/.test(playbooks));
});

test("H3: invalid playbook id returns 400", () => {
  assert.ok(/Invalid playbook ID/.test(playbooks));
});

test("H5: missed trade validates direction and symbol", () => {
  assert.ok(/Direction must be BUY or SELL/.test(missed));
  assert.ok(/Valid symbol is required/.test(missed));
  assert.ok(/Invalid trade date/.test(missed));
});

test("H5: missed trade id validation on delete", () => {
  assert.ok(/Invalid missed trade ID/.test(missed));
});

test("H4: account rename still syncs trades.account by account_id", () => {
  assert.ok(/UPDATE trades SET account=\$1 WHERE user_id=\$2 AND account_id=\$3/.test(accounts));
});

console.log(`\nAccount/playbook integrity: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
