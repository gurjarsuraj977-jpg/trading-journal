/**
 * Batch B — Authentication rate limiting (S-03).
 * Source-level deterministic tests. Run:
 *   node tests/auth-rate-limit.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

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
const authSrc = fs.readFileSync(path.join(root, "routes/auth-routes.js"), "utf8");
const serverSrc = fs.readFileSync(path.join(root, "server.js"), "utf8");

test("clientKey does not prefer leftmost X-Forwarded-For", () => {
  // Must not use headers["x-forwarded-for"] as the primary key source
  const fn = authSrc.slice(
    authSrc.indexOf("function clientKey"),
    authSrc.indexOf("function rateLimitAuth")
  );
  assert.ok(/req\.ip/.test(fn), "uses req.ip");
  assert.ok(/remoteAddress/.test(fn), "falls back to socket");
  assert.ok(
    !/x-forwarded-for/.test(fn),
    "must not read x-forwarded-for directly (spoofable)"
  );
});

test("rateLimitAuth is applied only to login and register", () => {
  assert.ok(
    /router\.post\(\s*["']\/register["']\s*,\s*rateLimitAuth/.test(authSrc)
  );
  assert.ok(
    /router\.post\(\s*["']\/login["']\s*,\s*rateLimitAuth/.test(authSrc)
  );
  // Must NOT be a global router.use(rateLimitAuth)
  assert.ok(
    !/router\.use\(\s*rateLimitAuth\s*\)/.test(authSrc),
    "must not rate-limit entire auth router"
  );
});

test("/me and /logout are not rate-limited", () => {
  const me = authSrc.match(/router\.get\(\s*["']\/me["'][\s\S]*?\)/);
  const logout = authSrc.match(/router\.post\(\s*["']\/logout["'][\s\S]*?\{/);
  assert.ok(me);
  assert.ok(logout);
  assert.ok(!/rateLimitAuth/.test(me[0]));
  assert.ok(!/rateLimitAuth/.test(logout[0]));
});

test("server configures trust proxy only from TRUST_PROXY env", () => {
  assert.ok(/TRUST_PROXY/.test(serverSrc));
  assert.ok(/trust proxy/.test(serverSrc));
  // Must not blindly trust all proxies
  assert.ok(!/trust proxy["']\s*,\s*true/.test(serverSrc));
});

test("admin bootstrap behavior is unchanged in auth-routes", () => {
  assert.ok(/maybeBootstrapAdmin/.test(authSrc));
  assert.ok(/INITIAL_ADMIN_EMAIL/.test(authSrc));
  assert.ok(/role = 'admin'/.test(authSrc));
});

/* Runtime unit test of clientKey + rateLimitAuth via vm extraction */
test("runtime: spoofed X-Forwarded-For does not change key", () => {
  // Extract and eval the rate-limit helpers in isolation
  const start = authSrc.indexOf("const authAttempts");
  const end = authSrc.indexOf("function createAuthRouter");
  const snippet = authSrc.slice(start, end);
  const sandbox = {
    Map,
    Date,
    String,
    console,
    module: { exports: {} },
    exports: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    snippet +
      "; this.__clientKey = clientKey; this.__rateLimitAuth = rateLimitAuth; this.__AUTH_MAX = AUTH_MAX;",
    sandbox
  );
  const clientKey = sandbox.__clientKey;
  const a = clientKey({
    ip: "10.0.0.5",
    headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.5" },
    socket: { remoteAddress: "10.0.0.5" },
  });
  const b = clientKey({
    ip: "10.0.0.5",
    headers: { "x-forwarded-for": "9.9.9.9" },
    socket: { remoteAddress: "10.0.0.5" },
  });
  assert.strictEqual(a, b, "spoofed XFF must not change key when req.ip fixed");
  assert.strictEqual(a, "10.0.0.5");
});

test("runtime: rate limit trips after AUTH_MAX attempts", () => {
  const start = authSrc.indexOf("const authAttempts");
  const end = authSrc.indexOf("function createAuthRouter");
  const snippet = authSrc.slice(start, end);
  const sandbox = {
    Map,
    Date,
    String,
    console,
    module: { exports: {} },
    exports: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(
    snippet +
      "; this.__rateLimitAuth = rateLimitAuth; this.__AUTH_MAX = AUTH_MAX; this.__clientKey = clientKey;",
    sandbox
  );
  const rateLimitAuth = sandbox.__rateLimitAuth;
  const AUTH_MAX = sandbox.__AUTH_MAX;
  const req = {
    ip: "203.0.113.50",
    headers: {},
    socket: { remoteAddress: "203.0.113.50" },
  };
  let limited = false;
  const res = {
    status(code) {
      assert.strictEqual(code, 429);
      return {
        json() {
          limited = true;
        },
      };
    },
  };
  let nextCount = 0;
  for (let i = 0; i < AUTH_MAX; i++) {
    rateLimitAuth(req, res, () => {
      nextCount++;
    });
  }
  assert.strictEqual(nextCount, AUTH_MAX);
  assert.strictEqual(limited, false);
  rateLimitAuth(req, res, () => {
    nextCount++;
  });
  assert.strictEqual(limited, true);
  assert.strictEqual(nextCount, AUTH_MAX);
});

console.log(`\nAuth rate limit: ${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
