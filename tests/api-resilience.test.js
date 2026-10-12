/**
 * Batch C — Database and API error resilience (R-01, R-03, R-07).
 * Source-level deterministic tests. Run:
 *   node tests/api-resilience.test.js
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
const poolSrc = fs.readFileSync(path.join(root, "db/pool.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("pool registers an error listener for idle clients", () => {
  assert.ok(/pool\.on\(\s*["']error["']/.test(poolSrc));
});

test("pool configures max and timeouts", () => {
  assert.ok(/\bmax\s*:/.test(poolSrc));
  assert.ok(/idleTimeoutMillis/.test(poolSrc));
  assert.ok(/connectionTimeoutMillis/.test(poolSrc));
});

test("API unknown routes return JSON 404 before SPA catch-all", () => {
  const api404 = serverSrc.indexOf('app.use("/api"');
  const spa = serverSrc.indexOf('app.get("/{*splat}"');
  assert.ok(api404 >= 0, "API 404 middleware present");
  assert.ok(spa >= 0, "SPA catch-all present");
  assert.ok(api404 < spa, "API 404 must run before SPA catch-all");
  assert.ok(/status\(404\)\.json/.test(serverSrc.slice(api404, spa)));
});

test("SPA catch-all still serves index.html for non-API routes", () => {
  assert.ok(/sendFile.*index\.html/.test(serverSrc));
});

test("JSON error handler covers parse failures and oversized bodies", () => {
  assert.ok(/entity\.parse\.failed|SyntaxError/.test(serverSrc));
  assert.ok(/entity\.too\.large|413/.test(serverSrc));
  assert.ok(/Invalid JSON body/.test(serverSrc));
});

test("API error responses do not expose stack traces", () => {
  const handler = serverSrc.slice(
    serverSrc.indexOf("app.use((err,req,res,next)"),
    serverSrc.indexOf('app.get("/{*splat}"')
  );
  assert.ok(handler.length > 50);
  assert.ok(!/\.stack/.test(handler));
  assert.ok(/Something went wrong/.test(handler));
});

test("pool error handler does not claim crash-proofing via empty catch", () => {
  // Listener logs; does not silently swallow without log
  assert.ok(/console\.error/.test(poolSrc));
});

console.log(`\nAPI resilience: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
