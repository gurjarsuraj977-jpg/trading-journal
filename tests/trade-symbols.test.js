/**
 * Add/Edit Trade symbol + contract-size tests.
 * Run: node tests/trade-symbols.test.js   (Node >= 18, no dependencies)
 *
 * Part A exercises utils/trade-spec-resolver.js directly.
 * Part B loads the REAL server.js with the third-party modules
 * (express, pg, ...) stubbed, captures the registered route handlers
 * and calls POST/PUT/GET /api/trades with a fake database, so the
 * actual route code (symbol allow-list, source guard, SQL issued) runs.
 *
 * IMPORTANT — US100 fixtures: no real broker contract size exists in
 * this repository or sandbox. The US100 tests below use a SYNTHETIC
 * market_symbols row (contract_size 7, deliberately not a real-world
 * value) only to prove the plumbing reads the stored broker value and
 * never a hardcoded/guessed one. They do NOT verify any real broker's
 * US100 specification.
 */
const assert = require("assert");
const Module = require("module");

let passed = 0;
let failed = 0;
const pending = [];

function check(name, fn) {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(detail => {
        passed++;
        console.log(`PASS  ${name}${detail ? "  ->  " + detail : ""}`);
      })
      .catch(err => {
        failed++;
        console.log(`FAIL  ${name}  ->  ${err.message}`);
      })
  );
  // run sequentially so shared fake-db state cannot interleave
  return pending[pending.length - 1];
}

const SERIAL = [];
function test(name, fn) {
  SERIAL.push({ name, fn });
}

function section(title) {
  SERIAL.push({ header: title });
}

async function runAll() {
  for (const t of SERIAL) {
    if (t.header) {
      console.log("\n" + t.header);
      continue;
    }
    await check(t.name, t.fn);
  }
}

/* ---------------------------------------------------------------
 * Fake market_symbols data
 * ------------------------------------------------------------- */
function makeResolverDb(rows) {
  const log = [];
  const fn = async (sql, params = []) => {
    log.push({ sql, params });
    if (!/FROM market_symbols/.test(sql)) return { rows: [], rowCount: 0 };
    assert.ok(
      /broker_symbol IS NOT NULL/.test(sql),
      "market_symbols lookup must require broker provenance"
    );
    const out = rows.filter(
      r =>
        r.symbol === params[0] &&
        r.active !== false &&
        r.broker_symbol !== null &&
        r.broker_symbol !== undefined
    );
    return { rows: out, rowCount: out.length };
  };
  fn.log = log;
  return fn;
}

const US100_ROW = {
  symbol: "US100",
  active: true,
  broker_symbol: "US100",
  contract_size: "7.000000000000", // pg returns NUMERIC as string
  quote_asset: "USD"
};

const {
  validateSubmittedSymbol,
  calculateManualTrade,
  listSymbolAvailability
} = require("../utils/trade-spec-resolver");
const { calculateTrade } = require("../utils/trade-calculator");
const {
  getManualTradeSymbols,
  getSymbolSpec
} = require("../utils/symbol-specs");

const fx = { JPY: 0.0067, CAD: 0.73, CHF: 1.12 };
const getRate = async ({ fromCurrency }) => ({
  rate: fx[fromCurrency] ?? null
});

/* ===============================================================
 * PART A — resolver / calculation
 * ============================================================= */
section("=== A1. SUPPORTED SYMBOL LIST ===");

test("symbol list is the 10 canonical instruments, all with specs", () => {
  const list = getManualTradeSymbols().map(x => x.symbol);
  assert.deepStrictEqual(list, [
    "XAUUSD", "EURUSD", "GBPUSD", "USDJPY", "AUDUSD",
    "USDCAD", "USDCHF", "BTCUSD", "ETHUSD", "US100"
  ]);
  list.forEach(s => assert.strictEqual(getSymbolSpec(s).known, true));
});

section("=== A2. SYMBOL VALIDATION ===");

for (const bad of ["FOO", "INVALID", "US100CASH", "NAS100", "USTEC", "NASDAQ", "US30", "XAUUSD1", ""]) {
  test(`rejects symbol ${JSON.stringify(bad)}`, () => {
    const r = validateSubmittedSymbol(bad);
    assert.strictEqual(r.ok, false);
    return r.code;
  });
}
for (const bad of [null, undefined, "   "]) {
  test(`rejects empty-ish symbol ${JSON.stringify(bad)}`, () => {
    const r = validateSubmittedSymbol(bad);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "SYMBOL_REQUIRED");
  });
}
for (const [input, canon] of [["xauusd", "XAUUSD"], [" EURUSD ", "EURUSD"], ["us100", "US100"]]) {
  test(`normalises ${JSON.stringify(input)} -> ${canon}`, () => {
    const r = validateSubmittedSymbol(input);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.symbol, canon);
  });
}

section("=== A3. EXISTING INSTRUMENTS UNCHANGED ===");

const cases = {
  XAUUSD: { entry: 2000, stopLoss: 1990, takeProfit: 2030, exitPrice: 2010 },
  EURUSD: { entry: 1.1, stopLoss: 1.095, takeProfit: 1.11, exitPrice: 1.105 },
  GBPUSD: { entry: 1.27, stopLoss: 1.265, takeProfit: 1.28, exitPrice: 1.275 },
  USDJPY: { entry: 150, stopLoss: 149.5, takeProfit: 151, exitPrice: 150.5 },
  AUDUSD: { entry: 0.66, stopLoss: 0.655, takeProfit: 0.67, exitPrice: 0.665 },
  USDCAD: { entry: 1.36, stopLoss: 1.355, takeProfit: 1.37, exitPrice: 1.365 },
  USDCHF: { entry: 0.9, stopLoss: 0.895, takeProfit: 0.91, exitPrice: 0.905 },
  BTCUSD: { entry: 60000, stopLoss: 59000, takeProfit: 63000, exitPrice: 61000 },
  ETHUSD: { entry: 3000, stopLoss: 2900, takeProfit: 3300, exitPrice: 3100 }
};

for (const [symbol, p] of Object.entries(cases)) {
  test(`${symbol}: identical to direct calculateTrade, no DB access`, async () => {
    const db = makeResolverDb([]);
    const r = await calculateManualTrade({
      db, getRate, symbol, direction: "BUY", ...p,
      quantity: 1, accountBalance: 10000, accountCurrency: "USD"
    });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(db.log.length, 0, "static instruments must not query market_symbols");
    const spec = getSymbolSpec(symbol);
    const rate =
      spec.pnlCurrency !== "USD" ? (await getRate({ fromCurrency: spec.pnlCurrency })).rate : null;
    const expected = calculateTrade({
      symbol, direction: "BUY", ...p, quantity: 1,
      accountBalance: 10000, accountCurrency: "USD", pnlConversionRate: rate
    });
    assert.deepStrictEqual(r.calculation, expected);
    assert.ok(r.calculation.riskAmount > 0);
    return `risk=${r.calculation.riskAmount} pnl=${r.calculation.profitLoss} R=${r.calculation.actualR}`;
  });
}

test("XAUUSD hand-checked: risk 1000, P&L 1000, 1R, 3R planned", async () => {
  const r = await calculateManualTrade({
    db: makeResolverDb([]), getRate, symbol: "XAUUSD", direction: "BUY",
    ...cases.XAUUSD, quantity: 1, accountBalance: 10000, accountCurrency: "USD"
  });
  assert.strictEqual(r.calculation.riskAmount, 1000);
  assert.strictEqual(r.calculation.profitLoss, 1000);
  assert.strictEqual(r.calculation.actualR, 1);
  assert.strictEqual(r.calculation.plannedRr, 3);
});

test("USDJPY with USD account still needs a conversion rate (preserved)", async () => {
  const r = await calculateManualTrade({
    db: makeResolverDb([]), getRate: async () => ({ rate: null }),
    symbol: "USDJPY", direction: "BUY", ...cases.USDJPY,
    quantity: 1, accountBalance: 10000, accountCurrency: "USD"
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "NEEDS_CONVERSION");
});

section("=== A4. QUANTITY / SIDE VALIDATION PRESERVED ===");

for (const q of [0, -1, "", "abc"]) {
  test(`quantity ${JSON.stringify(q)} rejected`, async () => {
    const n = v => (Number.isFinite(Number(v)) ? Number(v) : 1); // same as utils/number n(v,1)
    const r = await calculateManualTrade({
      db: makeResolverDb([]), getRate, symbol: "XAUUSD", direction: "BUY",
      ...cases.XAUUSD, quantity: n(q), accountBalance: 10000, accountCurrency: "USD"
    });
    if (q === "abc") {
      // n("abc",1) falls back to 1 -> valid; documents existing server behaviour
      assert.strictEqual(r.ok, true);
      return "non-numeric falls back to 1 (existing behaviour, unchanged)";
    }
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /Quantity must be greater than zero/);
  });
}

test("quantity 2 accepted and scales risk", async () => {
  const r = await calculateManualTrade({
    db: makeResolverDb([]), getRate, symbol: "XAUUSD", direction: "BUY",
    ...cases.XAUUSD, quantity: 2, accountBalance: 10000, accountCurrency: "USD"
  });
  assert.strictEqual(r.calculation.riskAmount, 2000);
});

test("BUY stop above entry rejected; SELL stop below entry rejected", async () => {
  const base = { db: makeResolverDb([]), getRate, symbol: "XAUUSD", entry: 2000, quantity: 1, accountBalance: 10000, accountCurrency: "USD" };
  const a = await calculateManualTrade({ ...base, direction: "BUY", stopLoss: 2010 });
  const b = await calculateManualTrade({ ...base, direction: "SELL", stopLoss: 1990 });
  assert.strictEqual(a.ok, false);
  assert.strictEqual(b.ok, false);
});

test("entry 0 rejected", async () => {
  const r = await calculateManualTrade({ db: makeResolverDb([]), getRate, symbol: "XAUUSD", direction: "BUY", entry: 0, quantity: 1, accountBalance: 1, accountCurrency: "USD" });
  assert.strictEqual(r.ok, false);
});

section("=== A5. US100 CONTRACT SIZE (synthetic broker fixture) ===");

test("US100 BUY uses the stored broker contract size (7), never 1", async () => {
  const db = makeResolverDb([US100_ROW]);
  const r = await calculateManualTrade({
    db, getRate, symbol: "US100", direction: "BUY", entry: 20000, stopLoss: 19900,
    takeProfit: 20300, exitPrice: 20200, quantity: 2, accountBalance: 10000, accountCurrency: "USD"
  });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.contractSizeSource, "broker-market-symbols");
  assert.strictEqual(r.calculation.contractSize, 7);
  assert.strictEqual(r.calculation.riskAmount, 1400);   // 100 * 7 * 2
  assert.strictEqual(r.calculation.profitLoss, 2800);   // 200 * 7 * 2
  assert.strictEqual(r.calculation.actualR, 2);
  assert.strictEqual(r.calculation.plannedRr, 3);
});

test("US100 SELL uses the stored broker contract size", async () => {
  const r = await calculateManualTrade({
    db: makeResolverDb([US100_ROW]), getRate, symbol: "US100", direction: "SELL",
    entry: 20000, stopLoss: 20100, takeProfit: 19700, exitPrice: 19800,
    quantity: 2, accountBalance: 10000, accountCurrency: "USD"
  });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(r.calculation.riskAmount, 1400);
  assert.strictEqual(r.calculation.profitLoss, 2800);
  assert.strictEqual(r.calculation.actualR, 2);
});

test("legacy alias NAS100 resolves to the same broker row (lookup only)", async () => {
  const db = makeResolverDb([US100_ROW]);
  const r = await calculateManualTrade({
    db, getRate, symbol: "NAS100", direction: "BUY", entry: 20000, stopLoss: 19900,
    quantity: 1, accountBalance: 10000, accountCurrency: "USD"
  });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(db.log[0].params, ["US100"]);
});

test("no market_symbols row -> MISSING_CONTRACT_SIZE", async () => {
  const r = await calculateManualTrade({
    db: makeResolverDb([]), getRate, symbol: "US100", direction: "BUY",
    entry: 20000, stopLoss: 19900, quantity: 1, accountBalance: 10000, accountCurrency: "USD"
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "MISSING_CONTRACT_SIZE");
  assert.match(r.error, /US100 cannot be calculated because its broker contract specification is unavailable/);
  assert.ok(!/SELECT|market_symbols|stack/i.test(r.error), "no internals in message");
});

for (const bad of [null, 0, "0", -5, "abc", ""]) {
  test(`stored contract_size ${JSON.stringify(bad)} -> MISSING_CONTRACT_SIZE (no default to 1)`, async () => {
    const r = await calculateManualTrade({
      db: makeResolverDb([{ ...US100_ROW, contract_size: bad }]), getRate, symbol: "US100",
      direction: "BUY", entry: 20000, stopLoss: 19900, quantity: 1, accountBalance: 10000, accountCurrency: "USD"
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "MISSING_CONTRACT_SIZE");
  });
}

test("row without broker provenance (broker_symbol NULL) is not trusted", async () => {
  const r = await calculateManualTrade({
    db: makeResolverDb([{ ...US100_ROW, broker_symbol: null }]), getRate, symbol: "US100",
    direction: "BUY", entry: 20000, stopLoss: 19900, quantity: 1, accountBalance: 10000, accountCurrency: "USD"
  });
  assert.strictEqual(r.code, "MISSING_CONTRACT_SIZE");
});

test("inactive market_symbols row is not used", async () => {
  const r = await calculateManualTrade({
    db: makeResolverDb([{ ...US100_ROW, active: false }]), getRate, symbol: "US100",
    direction: "BUY", entry: 20000, stopLoss: 19900, quantity: 1, accountBalance: 10000, accountCurrency: "USD"
  });
  assert.strictEqual(r.code, "MISSING_CONTRACT_SIZE");
});

test("caller-supplied contractSize is ignored (cannot be forced into the calculation)", async () => {
  const r = await calculateManualTrade({
    db: makeResolverDb([]), getRate, symbol: "US100", direction: "BUY",
    entry: 20000, stopLoss: 19900, quantity: 1, accountBalance: 10000, accountCurrency: "USD",
    contractSize: 1
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "MISSING_CONTRACT_SIZE");
});

test("availability: US100 unavailable without broker row, available with it", async () => {
  const none = await listSymbolAvailability(makeResolverDb([]), getManualTradeSymbols());
  const some = await listSymbolAvailability(makeResolverDb([US100_ROW]), getManualTradeSymbols());
  assert.strictEqual(none.find(x => x.symbol === "US100").available, false);
  assert.strictEqual(some.find(x => x.symbol === "US100").available, true);
  assert.ok(none.filter(x => x.symbol !== "US100").every(x => x.available));
});

/* ===============================================================
 * PART B — real server.js route handlers with stubbed modules
 * ============================================================= */
const routes = {};
const dbState = {
  handler: async () => ({ rows: [], rowCount: 0 })
};

function recorder() {
  const r = {};
  for (const m of ["get", "post", "put", "delete", "patch", "use"]) {
    r[m] = (...args) => {
      if (typeof args[0] === "string" && m !== "use") {
        routes[`${m.toUpperCase()} ${args[0]}`] = args[args.length - 1];
      }
      return r;
    };
  }
  return r;
}

const expressStub = () => {
  const app = recorder();
  app.listen = () => {};
  return app;
};
expressStub.json = () => (req, res, next) => next && next();
expressStub.static = () => (req, res, next) => next && next();
expressStub.Router = () => recorder();

const stubs = {
  express: expressStub,
  "cookie-parser": () => (req, res, next) => next && next(),
  bcryptjs: {},
  jsonwebtoken: { sign: () => "t", verify: () => ({}) },
  dotenv: { config: () => {} },
  pg: { Pool: class { query(q, p) { return dbState.handler(q, p); } } }
};

/* Deterministic FX (the real implementation calls Twelve Data over the
   network, unavailable here). Patched before server.js destructures it. */
const twelveData = require("../market-data/twelve-data");
twelveData.getCurrencyConversionRate = async ({ fromCurrency }) => ({
  rate: fx[fromCurrency] ?? null
});

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return origLoad.call(this, request, ...rest);
};

const realLog = console.log;
console.error = () => {};
console.warn = () => {};
require("../server.js");
Module._load = origLoad;

function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = c => { r.statusCode = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}

const ACCOUNT = { id: 5, starting_balance: "10000", currency: "USD", active: true };

function makeTradeDb({ trades = {}, marketRows = [], account = ACCOUNT } = {}) {
  const log = [];
  const fn = async (sql, params = []) => {
    log.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    if (/FROM market_symbols/.test(sql)) {
      const out = marketRows.filter(r => r.symbol === params[0] && r.active !== false && r.broker_symbol);
      return { rows: out, rowCount: out.length };
    }
    if (/FROM accounts/.test(sql)) return { rows: [account], rowCount: 1 };
    if (/FROM trades/.test(sql)) {
      const t = trades[params[0]];
      return t && params[1] === 1 ? { rows: [t], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/INSERT INTO trades/.test(sql)) return { rows: [{ id: 99, symbol: params[3] }], rowCount: 1 };
    if (/UPDATE trades/.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  fn.log = log;
  fn.writes = () => log.filter(l => /^(INSERT INTO trades|UPDATE trades)/.test(l.sql));
  return fn;
}

async function call(method, path, { body = {}, params = {} } = {}) {
  const handler = routes[`${method} ${path}`];
  assert.ok(handler, `route ${method} ${path} registered`);
  const r = res();
  const prevErr = console.error;
  console.error = () => {};
  try {
    await handler({ user: { id: 1 }, body, params, query: {} }, r);
  } finally {
    console.error = prevErr;
  }
  return r;
}

const goodTrade = (extra = {}) => ({
  account: "Main", symbol: "XAUUSD", direction: "BUY", entry: 2000,
  stopLoss: 1990, takeProfit: 2030, exitPrice: 2010, quantity: 1,
  // client-supplied financials must be ignored:
  riskAmount: 999999, profitLoss: 999999, actualR: 99, plannedRr: 99, riskPercent: 99,
  ...extra
});

section("=== B1. POST /api/trades (real route handler) ===");

for (const s of ["XAUUSD", "EURUSD", "GBPUSD", "AUDUSD", "BTCUSD", "ETHUSD"]) {
  test(`POST ${s} -> 201, one INSERT, canonical symbol stored`, async () => {
    const db = makeTradeDb();
    dbState.handler = db;
    const p = cases[s];
    const r = await call("POST", "/api/trades", { body: goodTrade({ symbol: s, ...p }) });
    assert.strictEqual(r.statusCode, 201, JSON.stringify(r.body));
    assert.strictEqual(db.writes().length, 1);
    const ins = db.writes()[0];
    assert.strictEqual(ins.params[3], s);
    return `risk=${ins.params[10]} pnl=${ins.params[13]}`;
  });
}

for (const s of ["USDJPY", "USDCAD", "USDCHF"]) {
  test(`POST ${s} (non-USD quote, USD account, stubbed FX) -> 201 with converted risk`, async () => {
    const db = makeTradeDb();
    dbState.handler = db;
    const r = await call("POST", "/api/trades", { body: goodTrade({ symbol: s, ...cases[s] }) });
    assert.strictEqual(r.statusCode, 201, JSON.stringify(r.body));
    assert.strictEqual(db.writes().length, 1);
    assert.strictEqual(db.writes()[0].params[3], s);
    return `risk=${db.writes()[0].params[10]}`;
  });
}

test("client-supplied risk / P&L / R are ignored (server value stored)", async () => {
  const db = makeTradeDb();
  dbState.handler = db;
  const r = await call("POST", "/api/trades", { body: goodTrade() });
  assert.strictEqual(r.statusCode, 201);
  const ins = db.writes()[0];
  assert.strictEqual(ins.params[10], 1000); // risk_amount
  assert.strictEqual(ins.params[13], 1000); // profit_loss
  assert.strictEqual(ins.params[15], 1);    // actual_r
});

for (const bad of ["FOO", "INVALID", "US100CASH", "NAS100", "USTEC", ""]) {
  test(`POST rejects symbol ${JSON.stringify(bad)} -> 400, no DB write`, async () => {
    const db = makeTradeDb();
    dbState.handler = db;
    const r = await call("POST", "/api/trades", { body: goodTrade({ symbol: bad }) });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(db.writes().length, 0);
    return r.body.error;
  });
}

test("POST missing symbol key -> 400, no DB write", async () => {
  const db = makeTradeDb();
  dbState.handler = db;
  const b = goodTrade();
  delete b.symbol;
  const r = await call("POST", "/api/trades", { body: b });
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(db.writes().length, 0);
});

for (const q of [0, -3, ""]) {
  test(`POST quantity ${JSON.stringify(q)} -> 400, no DB write`, async () => {
    const db = makeTradeDb();
    dbState.handler = db;
    const r = await call("POST", "/api/trades", { body: goodTrade({ quantity: q }) });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(db.writes().length, 0);
  });
}

test("POST invalid direction -> 400, no DB write", async () => {
  const db = makeTradeDb();
  dbState.handler = db;
  const r = await call("POST", "/api/trades", { body: goodTrade({ direction: "HOLD" }) });
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(db.writes().length, 0);
});

test("POST archived account -> 400, no DB write (preserved)", async () => {
  const db = makeTradeDb({ account: { ...ACCOUNT, active: false } });
  dbState.handler = db;
  const r = await call("POST", "/api/trades", { body: goodTrade() });
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(db.writes().length, 0);
});

test("POST US100 BUY with synthetic broker row -> 201, stored with canonical symbol", async () => {
  const db = makeTradeDb({ marketRows: [US100_ROW] });
  dbState.handler = db;
  const r = await call("POST", "/api/trades", {
    body: goodTrade({ symbol: "US100", entry: 20000, stopLoss: 19900, takeProfit: 20300, exitPrice: 20200, quantity: 2 })
  });
  assert.strictEqual(r.statusCode, 201, JSON.stringify(r.body));
  const ins = db.writes()[0];
  assert.strictEqual(ins.params[3], "US100");
  assert.strictEqual(ins.params[10], 1400);
  assert.strictEqual(ins.params[13], 2800);
});

test("POST US100 SELL with synthetic broker row -> 201", async () => {
  const db = makeTradeDb({ marketRows: [US100_ROW] });
  dbState.handler = db;
  const r = await call("POST", "/api/trades", {
    body: goodTrade({ symbol: "US100", direction: "SELL", entry: 20000, stopLoss: 20100, takeProfit: 19700, exitPrice: 19800, quantity: 2 })
  });
  assert.strictEqual(r.statusCode, 201, JSON.stringify(r.body));
  assert.strictEqual(db.writes()[0].params[13], 2800);
});

test("POST US100 without broker spec -> 400 MISSING_CONTRACT_SIZE, no DB write", async () => {
  const db = makeTradeDb();
  dbState.handler = db;
  const r = await call("POST", "/api/trades", {
    body: goodTrade({ symbol: "US100", entry: 20000, stopLoss: 19900, takeProfit: 20300, exitPrice: 20200 })
  });
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(r.body.code, "MISSING_CONTRACT_SIZE");
  assert.match(r.body.error, /broker contract specification is unavailable/);
  assert.strictEqual(db.writes().length, 0);
});

test("POST US100 with body contractSize:1 still rejected when broker spec missing", async () => {
  const db = makeTradeDb();
  dbState.handler = db;
  const r = await call("POST", "/api/trades", {
    body: goodTrade({ symbol: "US100", entry: 20000, stopLoss: 19900, contractSize: 1, contract_size: 1 })
  });
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(db.writes().length, 0);
});

section("=== B2. GET /api/trade-symbols ===");

test("symbols endpoint returns 10 symbols, US100 flagged by broker availability", async () => {
  dbState.handler = makeTradeDb();
  let r = await call("GET", "/api/trade-symbols");
  assert.strictEqual(r.body.symbols.length, 10);
  assert.strictEqual(r.body.symbols.find(x => x.symbol === "US100").available, false);
  dbState.handler = makeTradeDb({ marketRows: [US100_ROW] });
  r = await call("GET", "/api/trade-symbols");
  assert.strictEqual(r.body.symbols.find(x => x.symbol === "US100").available, true);
});

section("=== B3. PUT /api/trades/:id (real route handler) ===");

const manualTrade = (over = {}) => ({
  id: 1, user_id: 1, source: "manual", account: "Main", account_id: 5,
  symbol: "XAUUSD", direction: "BUY", entry: "2000", stop_loss: "1990",
  take_profit: "2030", exit_price: "2010", quantity: "1",
  risk_amount: "1000", profit_loss: "1000", actual_r: "1",
  mfe_r: "0", mae_r: "0", max_favorable_price: null, max_adverse_price: null,
  rule_score: 0, playbook_id: null, strategy: "", session: "", setup: "",
  entry_reason: "", exit_reason: "", emotion_before: "", emotion_after: "",
  mistakes: "", confidence: 0, market_condition: "", screenshot_data: "",
  notes: "", trade_date: new Date("2026-01-01T10:00:00Z"), ...over
});

const tlTrade = (over = {}) => manualTrade({
  id: 2, source: "tradelocker", symbol: "US100", direction: "BUY",
  entry: "20000", stop_loss: null, take_profit: null, exit_price: "20200",
  quantity: "3", risk_amount: "0", profit_loss: "1234.56", actual_r: "0",
  ...over
});

test("PUT manual XAUUSD edit -> recalculated and UPDATEd", async () => {
  const db = makeTradeDb({ trades: { 1: manualTrade() } });
  dbState.handler = db;
  const r = await call("PUT", "/api/trades/:id", { params: { id: "1" }, body: { ...goodTrade(), exitPrice: 2020 } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const up = db.writes()[0];
  assert.match(up.sql, /symbol=\$3/);
  assert.strictEqual(up.params[2], "XAUUSD");
  assert.strictEqual(up.params[12], 2000); // profit_loss = 20 * 100
});

test("PUT manual US100 (existing) edit with synthetic broker row -> recalculated", async () => {
  const db = makeTradeDb({
    trades: { 1: manualTrade({ symbol: "US100", entry: "20000", stop_loss: "19900", take_profit: null, exit_price: "20100", quantity: "1" }) },
    marketRows: [US100_ROW]
  });
  dbState.handler = db;
  const r = await call("PUT", "/api/trades/:id", {
    params: { id: "1" },
    body: { symbol: "US100", direction: "BUY", entry: 20000, stopLoss: 19900, takeProfit: "", exitPrice: 20200, quantity: 1 }
  });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const up = db.writes()[0];
  assert.strictEqual(up.params[2], "US100");
  assert.strictEqual(up.params[12], 1400); // 200 * 7
});

test("PUT manual US100 with no broker spec -> 400 MISSING_CONTRACT_SIZE, no UPDATE", async () => {
  const db = makeTradeDb({ trades: { 1: manualTrade({ symbol: "US100", entry: "20000", stop_loss: "19900" }) } });
  dbState.handler = db;
  const r = await call("PUT", "/api/trades/:id", { params: { id: "1" }, body: { symbol: "US100", exitPrice: 20200 } });
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(r.body.code, "MISSING_CONTRACT_SIZE");
  assert.strictEqual(db.writes().length, 0);
});

test("PUT manual: changing symbol to an unsupported value -> 400, no UPDATE", async () => {
  for (const bad of ["FOO", "US100CASH", "NAS100"]) {
    const db = makeTradeDb({ trades: { 1: manualTrade() } });
    dbState.handler = db;
    const r = await call("PUT", "/api/trades/:id", { params: { id: "1" }, body: { ...goodTrade(), symbol: bad } });
    assert.strictEqual(r.statusCode, 400, bad);
    assert.strictEqual(db.writes().length, 0, bad);
  }
});

test("PUT manual: symbol omitted keeps stored symbol", async () => {
  const db = makeTradeDb({ trades: { 1: manualTrade() } });
  dbState.handler = db;
  const b = goodTrade();
  delete b.symbol;
  const r = await call("PUT", "/api/trades/:id", { params: { id: "1" }, body: b });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(db.writes()[0].params[2], "XAUUSD");
});

test("PUT manual: legacy stored alias NAS100 unchanged stays editable and is NOT rewritten", async () => {
  const db = makeTradeDb({
    trades: { 1: manualTrade({ symbol: "NAS100", entry: "20000", stop_loss: "19900", exit_price: "20100", quantity: "1" }) },
    marketRows: [US100_ROW]
  });
  dbState.handler = db;
  const r = await call("PUT", "/api/trades/:id", {
    params: { id: "1" },
    body: { symbol: "NAS100", direction: "BUY", entry: 20000, stopLoss: 19900, takeProfit: "", exitPrice: 20100, quantity: 1 }
  });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(db.writes()[0].params[2], "NAS100");
  assert.strictEqual(db.writes()[0].params[12], 700);
});

test("PUT manual: quantity 0 -> 400, no UPDATE", async () => {
  const db = makeTradeDb({ trades: { 1: manualTrade() } });
  dbState.handler = db;
  const r = await call("PUT", "/api/trades/:id", { params: { id: "1" }, body: { ...goodTrade(), quantity: 0 } });
  assert.strictEqual(r.statusCode, 400);
  assert.strictEqual(db.writes().length, 0);
});

test("PUT other user's / unknown trade -> 404, no UPDATE", async () => {
  const db = makeTradeDb({ trades: { 1: manualTrade() } });
  dbState.handler = db;
  const r = await call("PUT", "/api/trades/:id", { params: { id: "77" }, body: goodTrade() });
  assert.strictEqual(r.statusCode, 404);
  assert.strictEqual(db.writes().length, 0);
});

const BROKER_COLUMNS = [
  "symbol=", "direction=", "entry=", "stop_loss=", "take_profit=", "exit_price=",
  "quantity=", "risk_amount=", "risk_percent=", "risk_level=", "profit_loss=",
  "planned_rr=", "actual_r=", "trade_date=", "account=", "account_id="
];

function assertBrokerValuesUntouched(db) {
  const writes = db.writes();
  assert.strictEqual(writes.length, 1);
  const sql = writes[0].sql;
  assert.match(sql, /^UPDATE trades/);
  for (const col of BROKER_COLUMNS) {
    assert.ok(!sql.includes(col), `UPDATE must not touch ${col}`);
  }
}

test("PUT TradeLocker US100 (no local broker spec) -> 200, journal-only UPDATE, P&L untouched", async () => {
  const db = makeTradeDb({ trades: { 2: tlTrade() } }); // NO market_symbols row
  dbState.handler = db;
  const r = await call("PUT", "/api/trades/:id", {
    params: { id: "2" },
    body: { symbol: "FOO", direction: "SELL", entry: 1, quantity: 99, exitPrice: 1, profitLoss: 5, notes: "journal edit", strategy: "ORB" }
  });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.brokerDerivedPreserved, true);
  assertBrokerValuesUntouched(db);
  const p = db.writes()[0].params;
  assert.ok(p.includes("journal edit"));
  assert.ok(p.includes("ORB"));
  assert.ok(!p.includes(99) && !p.includes("FOO") && !p.includes(5));
});

test("PUT TradeLocker normal instrument (EURUSD) -> broker values preserved, not recalculated", async () => {
  const db = makeTradeDb({ trades: { 2: tlTrade({ symbol: "EURUSD", entry: "1.1", exit_price: "1.105", quantity: "2", profit_loss: "987.65" }) } });
  dbState.handler = db;
  const r = await call("PUT", "/api/trades/:id", { params: { id: "2" }, body: { ...goodTrade({ symbol: "EURUSD", entry: 1.1, exitPrice: 1.2 }), notes: "x" } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assertBrokerValuesUntouched(db);
});

test("PUT TradeLocker trade with legacy broker symbol name (e.g. EURUSD.r) still editable", async () => {
  const db = makeTradeDb({ trades: { 2: tlTrade({ symbol: "EURUSD.r" }) } });
  dbState.handler = db;
  const r = await call("PUT", "/api/trades/:id", { params: { id: "2" }, body: { notes: "ok" } });
  assert.strictEqual(r.statusCode, 200);
  assertBrokerValuesUntouched(db);
});

test("PUT TradeLocker: other user's trade -> 404", async () => {
  const db = makeTradeDb({ trades: { 2: tlTrade() } });
  dbState.handler = db;
  const handler = routes["PUT /api/trades/:id"];
  const r = res();
  await handler({ user: { id: 2 }, body: {}, params: { id: "2" } }, r);
  assert.strictEqual(r.statusCode, 404);
  assert.strictEqual(db.writes().length, 0);
});

test("PUT 500 does not leak internal error text", async () => {
  dbState.handler = async () => { throw new Error("relation \"trades\" secret SQL detail"); };
  const r = await call("PUT", "/api/trades/:id", { params: { id: "1" }, body: goodTrade() });
  assert.strictEqual(r.statusCode, 500);
  assert.ok(!/secret|relation|SQL/i.test(JSON.stringify(r.body)));
});

section("=== B4. GET /api/trades/:id exposes source for the edit form ===");

test("GET trade selects source and stays user-scoped", async () => {
  const db = makeTradeDb({ trades: { 2: tlTrade() } });
  dbState.handler = db;
  const r = await call("GET", "/api/trades/:id", { params: { id: "2" } });
  assert.strictEqual(r.statusCode, 200);
  const q = db.log.find(l => /FROM trades/.test(l.sql));
  assert.match(q.sql, /,source FROM trades WHERE id=\$1 AND user_id=\$2/);
});

/* --------------------------------------------------------------- */
(async () => {
  // restore console.log for output (server.js startup noise suppressed above)
  console.log = realLog;
  await runAll();
  console.log("\n==============================");
  console.log(`PASSED: ${passed}  FAILED: ${failed}`);
  console.log("==============================");
  process.exit(failed ? 1 : 0);
})();
