/**
 * Batch E — CSV import/export integrity.
 * Run: node tests/csv-integrity.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("PASS  " + name); pass++; }
  catch (e) { console.log("FAIL  " + name + "  ->  " + e.message); fail++; }
}

const root = path.join(__dirname, "..");
const fe = fs.readFileSync(path.join(root, "public/js/import-export.js"), "utf8");
const exp = fs.readFileSync(path.join(root, "routes/export-routes.js"), "utf8");
const imp = fs.readFileSync(path.join(root, "routes/import-routes.js"), "utf8");

test("export excludes screenshot_data", () => {
  assert.ok(exp.includes('!== "screenshot_data"') || exp.includes("!== 'screenshot_data'"));
});

test("export neutralizes formula injection prefixes", () => {
  assert.ok(exp.includes("csvCell"));
  assert.ok(exp.includes("[=+\\-@\\t\\r]") || exp.includes("[=+\\-@"));
});

test("export bounds row count", () => {
  assert.ok(/LIMIT\s+10000/i.test(exp));
});

test("import rejects invalid dates instead of substituting now", () => {
  assert.ok(imp.includes("Invalid trade date."));
  const idx = imp.indexOf("Number.isNaN(tradeDate.getTime())");
  assert.ok(idx > 0);
  const after = imp.slice(idx, idx + 300);
  assert.ok(after.includes("continue"));
  assert.ok(!after.includes("tradeDate = new Date()"));
});

test("parseCsv handles quoted commas and newlines at runtime", () => {
  const m = fe.match(/function parseCsv\(text\)\{[\s\S]*?\n\}/);
  assert.ok(m, "parseCsv function found");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(m[0] + "; this.parseCsv = parseCsv;", sandbox);
  const rows = sandbox.parseCsv('symbol,notes\nEURUSD,"hello, world"\nGBPUSD,"line1\nline2"\n');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].notes, "hello, world");
  assert.strictEqual(rows[1].notes, "line1\nline2");
});

test("parseCsv handles escaped quotes", () => {
  const m = fe.match(/function parseCsv\(text\)\{[\s\S]*?\n\}/);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(m[0] + "; this.parseCsv = parseCsv;", sandbox);
  const rows = sandbox.parseCsv('a,b\n"x""y",z\n');
  assert.strictEqual(rows[0].a, 'x"y');
});

console.log(`\nCSV integrity: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
