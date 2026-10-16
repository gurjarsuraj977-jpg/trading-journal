#!/usr/bin/env node
/**
 * Runs every tests/*.test.js file in its own process and prints a summary.
 *   npm test
 * Database integration tests need TEST_DATABASE_URL (see tests/helpers/test-db.js);
 * without it they report SKIP and are counted as skipped, never as passed.
 * Exit code is 1 if any file exits non-zero or reports a FAIL line.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();
let pass = 0, fail = 0, skipFiles = [], badFiles = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: "utf8", env: process.env, timeout: 300000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const p = (out.match(/^PASS/gm) || []).length;
  const fl = (out.match(/^FAIL/gm) || []).length;
  const sk = /^SKIP/m.test(out);
  pass += p; fail += fl;
  if (sk) skipFiles.push(f);
  const bad = r.status !== 0 || fl > 0;
  if (bad) { badFiles.push(f); process.stdout.write(out); }
  console.log(`${bad ? "FAIL" : sk ? "SKIP" : "ok  "}  ${f}  (pass ${p}, fail ${fl}${sk ? ", skipped" : ""})`);
}
console.log(`\n${files.length} test files, ${pass} passed, ${fail} failed, ${skipFiles.length} file(s) skipped`);
if (skipFiles.length) console.log("Skipped (no TEST_DATABASE_URL): " + skipFiles.join(", "));
process.exit(badFiles.length ? 1 : 0);
