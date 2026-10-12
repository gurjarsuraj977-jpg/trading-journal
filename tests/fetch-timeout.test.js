/**
 * K1 / DEF-001 — fetchWithTimeout must use global fetch (non-recursive).
 * Run: node tests/fetch-timeout.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(
        () => {
          console.log("PASS  " + name);
          pass++;
        },
        (e) => {
          console.log("FAIL  " + name + "  ->  " + e.message);
          fail++;
        }
      );
    }
    console.log("PASS  " + name);
    pass++;
  } catch (e) {
    console.log("FAIL  " + name + "  ->  " + e.message);
    fail++;
  }
}

const root = path.join(__dirname, "..");
const twelveSrc = fs.readFileSync(path.join(root, "market-data/twelve-data.js"), "utf8");
const tlSrc = fs.readFileSync(path.join(root, "tradelocker/tradelocker-client.js"), "utf8");
const aiSrc = fs.readFileSync(path.join(root, "routes/ai-coach-routes.js"), "utf8");

function extractHelper(src) {
  const marker = "async function fetchWithTimeout";
  const start = src.indexOf(marker);
  assert.ok(start >= 0, "fetchWithTimeout present");
  // Extract until the blank line after the function's closing brace following finally
  const slice = src.slice(start, start + 1200);
  const m = slice.match(/async function fetchWithTimeout[\s\S]*?\n\}/);
  assert.ok(m, "could extract helper");
  return m[0];
}

const twelveFn = extractHelper(twelveSrc);
const tlFn = extractHelper(tlSrc);

test("twelve-data: no recursive call to fetchWithTimeout", () => {
  assert.ok(!/return await fetchWithTimeout\(/.test(twelveFn));
  assert.ok(/globalThis\.fetch/.test(twelveFn));
  assert.ok(/nativeFetch/.test(twelveFn));
});

test("tradelocker: no recursive call to fetchWithTimeout", () => {
  assert.ok(!/return await fetchWithTimeout\(/.test(tlFn));
  assert.ok(/globalThis\.fetch/.test(tlFn));
});

test("ai-coach: OpenAI fetch uses AbortController timeout", () => {
  assert.ok(/AbortController/.test(aiSrc));
  assert.ok(/signal:\s*aiController\.signal/.test(aiSrc));
  assert.ok(/clearTimeout\(aiTimer\)/.test(aiSrc));
});

function makeRunner(fnSrc) {
  return async function run(mockFetch, url, opts, ms) {
    const sandbox = {
      globalThis: { fetch: mockFetch },
      setTimeout,
      clearTimeout,
      AbortController,
      Error,
      Math,
      Number,
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(fnSrc + "\nthis.__f = fetchWithTimeout;", sandbox);
    return sandbox.__f(url, opts, ms);
  };
}

const runTwelve = makeRunner(twelveFn);
const runTl = makeRunner(tlFn);

(async () => {
  await test("runtime success: native fetch invoked once", async () => {
    let calls = 0;
    const mock = async (url, opts) => {
      calls++;
      assert.ok(opts && opts.signal instanceof AbortSignal);
      return { ok: true, status: 200 };
    };
    const res = await runTwelve(mock, "https://example.test/a", { method: "GET" }, 5000);
    assert.strictEqual(calls, 1);
    assert.strictEqual(res.status, 200);
  });

  await test("runtime failure: provider error propagates", async () => {
    const mock = async () => {
      throw new Error("upstream 503");
    };
    let err;
    try {
      await runTwelve(mock, "https://example.test/a", {}, 5000);
    } catch (e) {
      err = e;
    }
    assert.ok(err && /upstream 503/.test(err.message));
  });

  await test("runtime timeout: AbortError becomes timed-out message", async () => {
    const mock = async (url, opts) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true }), 30000);
        opts.signal.addEventListener("abort", () => {
          clearTimeout(t);
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    let err;
    try {
      await runTwelve(mock, "https://example.test/a", {}, 40);
    } catch (e) {
      err = e;
    }
    assert.ok(err && /timed out/i.test(err.message));
  });

  await test("runtime TradeLocker: non-recursive success", async () => {
    let calls = 0;
    const mock = async () => {
      calls++;
      return { ok: true };
    };
    await runTl(mock, "https://example.test/tl", {}, 5000);
    assert.strictEqual(calls, 1);
  });

  // Wait a tick for any lingering
  await new Promise((r) => setTimeout(r, 10));
  console.log(`\nFetch timeout K1: ${pass} PASS, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
