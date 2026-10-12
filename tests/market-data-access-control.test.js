/**
 * Batch A — Shared market-data access control (S-01).
 * Source-level deterministic tests. Run:
 *   node tests/market-data-access-control.test.js
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

const root = path.join(__dirname, "..");
const routesSrc = fs.readFileSync(
  path.join(root, "market-data/market-data-routes.js"),
  "utf8"
);
const providerSrc = fs.readFileSync(
  path.join(root, "market-data/market-data-provider-routes.js"),
  "utf8"
);
const adminSrc = fs.readFileSync(
  path.join(root, "middleware/admin.js"),
  "utf8"
);

test("requireAdmin middleware exports requireAdmin", () => {
  assert.ok(/function requireAdmin\s*\(/.test(adminSrc));
  assert.ok(/role !== ["']admin["']/.test(adminSrc));
  assert.ok(/status\(403\)/.test(adminSrc));
});

test("market-data-routes imports requireAdmin", () => {
  assert.ok(/require\(["']\.\.\/middleware\/admin["']\)/.test(routesSrc));
  assert.ok(/requireAdmin/.test(routesSrc));
});

test("provider-routes imports requireAdmin", () => {
  assert.ok(/require\(["']\.\.\/middleware\/admin["']\)/.test(providerSrc));
  assert.ok(/requireAdmin/.test(providerSrc));
});

test("POST /candles/import requires auth then requireAdmin", () => {
  const m = routesSrc.match(
    /router\.post\(\s*["']\/candles\/import["']\s*,([\s\S]*?)async/
  );
  assert.ok(m, "POST /candles/import present");
  const middleware = m[1];
  assert.ok(/\bauth\b/.test(middleware), "auth required");
  assert.ok(/\brequireAdmin\b/.test(middleware), "requireAdmin required");
});

test("POST /provider/sync requires auth then requireAdmin", () => {
  const m = providerSrc.match(
    /router\.post\(\s*["']\/provider\/sync["']\s*,([\s\S]*?)async/
  );
  assert.ok(m, "POST /provider/sync present");
  assert.ok(/\bauth\b/.test(m[1]));
  assert.ok(/\brequireAdmin\b/.test(m[1]));
});

test("POST /provider/history requires auth then requireAdmin", () => {
  const m = providerSrc.match(
    /router\.post\(\s*["']\/provider\/history["']\s*,([\s\S]*?)async/
  );
  assert.ok(m, "POST /provider/history present");
  assert.ok(/\bauth\b/.test(m[1]));
  assert.ok(/\brequireAdmin\b/.test(m[1]));
});

test("GET /provider/status requires auth then requireAdmin", () => {
  const m = providerSrc.match(
    /router\.get\(\s*["']\/provider\/status["']\s*,([\s\S]*?)async/
  );
  assert.ok(m, "GET /provider/status present");
  assert.ok(/\bauth\b/.test(m[1]));
  assert.ok(/\brequireAdmin\b/.test(m[1]));
});

test("read endpoints remain auth-only (no requireAdmin)", () => {
  for (const route of [
    ["/symbols", "get"],
    ["/timeframes", "get"],
    ["/candles", "get"],
    ["/latest", "get"],
    ["/range", "get"],
    ["/summary", "get"],
  ]) {
    const [p, method] = route;
    const re = new RegExp(
      `router\\.${method}\\(\\s*["']${p.replace(/\//g, "\\/")}["']\\s*,([\\s\\S]*?)async`
    );
    const m = routesSrc.match(re);
    assert.ok(m, `${method.toUpperCase()} ${p} present`);
    assert.ok(/\bauth\b/.test(m[1]), `${p} still auth-protected`);
    assert.ok(
      !/\brequireAdmin\b/.test(m[1]),
      `${p} must remain readable by non-admin authenticated users`
    );
  }
});

test("import stamps source as admin_import (client source ignored)", () => {
  assert.ok(/source:\s*["']admin_import["']/.test(routesSrc));
  // Mapping step present so client-supplied source cannot stick
  assert.ok(/\.map\(/.test(routesSrc));
  assert.ok(/stamped/.test(routesSrc));
});

test("provider still uses twelve_data source path (unchanged insertCandles)", () => {
  assert.ok(/insertCandles/.test(providerSrc));
  // Provider does not accept client source for OHLC rows
  assert.ok(!/source:\s*req\.body/.test(providerSrc));
});

console.log(`\nMarket-data access control: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
