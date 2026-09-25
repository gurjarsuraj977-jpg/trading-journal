/**
 * Phase 1 US100 verification suite (Node >= 18, no dependencies).
 * Run: node tests/us100-verification.test.js
 */
const assert = require("assert");

const {
  normalizeSymbol,
  resolveCanonicalSymbol,
  validateInstrumentSpec
} = require("../utils/instrument-spec");

const { getSymbolSpec } = require("../utils/symbol-specs");
const { calculateTrade } = require("../utils/trade-calculator");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const detail = fn();
    passed++;
    console.log(`PASS  ${name}${detail ? "  ->  " + detail : ""}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}  ->  ${err.message}`);
  }
}

/* =========================================================
 * 2. SYMBOL ALIASING
 * ========================================================= */
console.log("\n=== 2. SYMBOL ALIASING ===");

const aliasInputs = [
  "US100", "us100", "US100.cash", "NAS100", "nas100",
  "USTEC", "NASDAQ", "Nasdaq100", "Tech_100", "US100USD",
  "EURUSD", "eurusd", "XAUUSD"
];

for (const input of aliasInputs) {
  check(`alias: ${input}`, () => {
    const canon = resolveCanonicalSymbol(input);
    const spec = getSymbolSpec(input);
    return `normalized="${normalizeSymbol(input)}" canonical="${canon}" known=${spec.known} contractSize=${spec.contractSize}`;
  });
}

check("US100.cash normalizes to US100CASH which is NOT an intentional alias", () => {
  // Documented behavior: dot is stripped, so US100.cash -> US100CASH.
  // US100CASH is not in the alias table; it stays as its own canonical key.
  const canon = resolveCanonicalSymbol("US100.cash");
  assert.strictEqual(canon, "US100CASH");
  const spec = getSymbolSpec("US100.cash");
  assert.strictEqual(spec.known, false);
  assert.strictEqual(spec.contractSize, null);
  return `canonical="${canon}", known=false, contractSize=null (no guessed size)`;
});

check("US100CASH variant is NOT silently accepted (negative control)", () => {
  const spec = getSymbolSpec("US100CASH");
  assert.strictEqual(spec.known, false);
  return "unknown symbol received NO contract size";
});

check("intentional aliases all resolve to US100", () => {
  for (const a of ["US100", "NAS100", "NQ100", "USTEC", "USTECH",
                   "US100USD", "NAS100USD", "USTECUSD", "USTECHCASH",
                   "NASDAQ", "NASDAQ100", "USATECH100", "TECH100"]) {
    assert.strictEqual(resolveCanonicalSymbol(a), "US100", a);
  }
  return "13 aliases -> US100";
});

check("index placeholder US100 is known but has NO contract size", () => {
  const spec = getSymbolSpec("US100");
  assert.strictEqual(spec.known, true);
  assert.strictEqual(spec.assetClass, "index");
  assert.strictEqual(spec.contractSize, null);
  assert.strictEqual(spec.requiresBrokerContractSize, true);
  return "known=true, contractSize=null, requiresBrokerContractSize=true";
});

check("unknown symbol gets no guessed spec", () => {
  const spec = getSymbolSpec("FAKEPAIR99");
  assert.strictEqual(spec.known, false);
  assert.strictEqual(spec.contractSize, null);
  return "known=false, contractSize=null";
});

/* =========================================================
 * 3. CONTRACT SIZE SAFETY (calculator rejects bad sizes)
 * ========================================================= */
console.log("\n=== 3. CONTRACT SIZE SAFETY ===");

const baseTrade = {
  symbol: "US100",
  direction: "BUY",
  entry: 24000,
  exitPrice: 24050,
  quantity: 1,
  accountCurrency: "USD"
};

const invalidSizes = [undefined, null, 0, -1, NaN, "0", "abc", "", Infinity];

for (const cs of invalidSizes) {
  check(`contractSize=${JSON.stringify(cs) || String(cs)} rejected`, () => {
    const r = calculateTrade({ ...baseTrade, contractSize: cs });
    assert.notStrictEqual(r.calculationStatus, "READY",
      `expected rejection, got READY profitLoss=${r.profitLoss}`);
    assert.ok(r.error, "must carry explicit error");
    return `status=${r.calculationStatus} error="${r.error}"`;
  });
}

check("contractSize=1 accepted", () => {
  const r = calculateTrade({ ...baseTrade, contractSize: 1 });
  assert.strictEqual(r.calculationStatus, "READY");
  return `profitLoss=${r.profitLoss}`;
});

check("contractSize='10' (numeric string from broker) accepted", () => {
  const r = calculateTrade({ ...baseTrade, contractSize: "10" });
  assert.strictEqual(r.calculationStatus, "READY");
  assert.strictEqual(r.profitLoss, 500);
  return `profitLoss=${r.profitLoss}`;
});

check("manual US100 with NO contract size -> MISSING_CONTRACT_SIZE, not silent 0", () => {
  const r = calculateTrade(baseTrade);
  assert.strictEqual(r.calculationStatus, "MISSING_CONTRACT_SIZE");
  assert.strictEqual(r.profitLoss, 0);
  return `error="${r.error}"`;
});

for (const bad of [0, -1, NaN, "abc", Infinity]) {
  check(`US100 explicit invalid contractSize=${String(bad)} -> MISSING_CONTRACT_SIZE`, () => {
    const r = calculateTrade({ ...baseTrade, contractSize: bad });
    assert.strictEqual(r.calculationStatus, "MISSING_CONTRACT_SIZE", `got ${r.calculationStatus}`);
    assert.strictEqual(r.profitLoss, 0);
    return `error="${r.error}"`;
  });
}

check("truly unknown symbol -> UNKNOWN_INSTRUMENT", () => {
  const r = calculateTrade({ ...baseTrade, symbol: "ZZZUSD" });
  assert.strictEqual(r.calculationStatus, "UNKNOWN_INSTRUMENT");
  return `error="${r.error}"`;
});

check("unknown symbol + valid explicit contractSize -> accepted (user-declared instrument)", () => {
  // Design: the calculator never GUESSES a size for unknown symbols.
  // An explicit, positive contractSize supplied by the caller is honored.
  const r = calculateTrade({ ...baseTrade, symbol: "ZZZUSD", contractSize: 10, pnlCurrency: "USD" });
  assert.strictEqual(r.calculationStatus, "READY");
  assert.strictEqual(r.contractSize, 10);
  assert.strictEqual(r.profitLoss, 500);
  return "explicit user-supplied contractSize honored; without it -> UNKNOWN_INSTRUMENT";
});

check("unknown symbol + INVALID explicit contractSize -> UNKNOWN_INSTRUMENT", () => {
  const r = calculateTrade({ ...baseTrade, symbol: "ZZZUSD", contractSize: -5 });
  assert.strictEqual(r.calculationStatus, "UNKNOWN_INSTRUMENT");
  return `error="${r.error}"`;
});

/* =========================================================
 * 4. US100 P&L (test-supplied specs only)
 * ========================================================= */
console.log("\n=== 4. US100 P&L ===");

function expectPnl(name, params, expected) {
  check(name, () => {
    const r = calculateTrade(params);
    assert.strictEqual(r.calculationStatus, "READY", `status=${r.calculationStatus} err=${r.error}`);
    assert.strictEqual(r.profitLoss, expected, `got ${r.profitLoss}, want ${expected}`);
    return `profitLoss=${r.profitLoss} (${r.winLoss})`;
  });
}

// contractSize = 1 ($1/point)
expectPnl("cs=1 BUY 24000->24050 x1", { ...baseTrade, contractSize: 1 }, 50);
expectPnl("cs=1 SELL 24050->24000 x1", { ...baseTrade, direction: "SELL", entry: 24050, exitPrice: 24000, contractSize: 1 }, 50);
expectPnl("cs=1 BUY 24000->23950 x1 (loss)", { ...baseTrade, exitPrice: 23950, contractSize: 1 }, -50);
expectPnl("cs=1 qty 0.1", { ...baseTrade, quantity: 0.1, contractSize: 1 }, 5);
expectPnl("cs=1 qty 2", { ...baseTrade, quantity: 2, contractSize: 1 }, 100);
expectPnl("cs=1 qty 10", { ...baseTrade, quantity: 10, contractSize: 1 }, 500);

// contractSize = 10 ($10/point) — proves spec changes P&L
expectPnl("cs=10 BUY 24000->24050 x1", { ...baseTrade, contractSize: 10 }, 500);
expectPnl("cs=10 SELL 24050->24000 x1", { ...baseTrade, direction: "SELL", entry: 24050, exitPrice: 24000, contractSize: 10 }, 500);
expectPnl("cs=10 qty 0.1", { ...baseTrade, quantity: 0.1, contractSize: 10 }, 50);
expectPnl("cs=10 qty 10", { ...baseTrade, quantity: 10, contractSize: 10 }, 5000);

check("formula: pnl = (exit-entry)*cs*qty mirrors for BUY/SELL", () => {
  const cases = [[23990, 0.5, 3], [24123.45, 3.7, 2]];
  for (const [exit, qty, cs] of cases) {
    const buy = calculateTrade({ ...baseTrade, exitPrice: exit, quantity: qty, contractSize: cs });
    const expectedBuy = Math.round(((exit - 24000) * cs * qty + Number.EPSILON) * 1e4) / 1e4;
    assert.strictEqual(buy.profitLoss, expectedBuy);
    const sell = calculateTrade({ ...baseTrade, direction: "SELL", entry: exit, exitPrice: 24000, quantity: qty, contractSize: cs });
    assert.strictEqual(sell.profitLoss, expectedBuy);
  }
  return "BUY and SELL mirror correctly";
});

check("SL/TP risk math on US100 with cs=10", () => {
  const r = calculateTrade({ ...baseTrade, contractSize: 10, stopLoss: 23950, takeProfit: 24100, accountBalance: 10000 });
  assert.strictEqual(r.riskAmount, 500);
  assert.strictEqual(r.potentialProfit, 1000);
  assert.strictEqual(r.plannedRr, 2);
  assert.strictEqual(r.riskPercent, 5);
  // Existing classification boundary (unchanged): <=5% is HIGH, >5% is CRITICAL.
  assert.strictEqual(r.riskLevel, "HIGH");
  return `risk=${r.riskAmount} reward=${r.potentialProfit} rr=${r.plannedRr} level=${r.riskLevel}`;
});

/* =========================================================
 * Backwards compatibility: existing symbols unchanged
 * ========================================================= */
console.log("\n=== BACKWARDS COMPATIBILITY ===");

check("EURUSD 1 lot 1.1000->1.1050 = $500 (cs 100000)", () => {
  const r = calculateTrade({ symbol: "EURUSD", direction: "BUY", entry: 1.1, exitPrice: 1.105, quantity: 1, accountCurrency: "USD" });
  assert.strictEqual(r.calculationStatus, "READY");
  assert.strictEqual(r.profitLoss, 500);
  return `profitLoss=${r.profitLoss}`;
});

check("XAUUSD 1 lot 2400->2410 = $1000 (cs 100)", () => {
  const r = calculateTrade({ symbol: "XAUUSD", direction: "BUY", entry: 2400, exitPrice: 2410, quantity: 1, accountCurrency: "USD" });
  assert.strictEqual(r.profitLoss, 1000);
  return `profitLoss=${r.profitLoss}`;
});

check("USDJPY still needs conversion for USD account", () => {
  const r = calculateTrade({ symbol: "USDJPY", direction: "BUY", entry: 150, exitPrice: 151, quantity: 1, accountCurrency: "USD" });
  assert.strictEqual(r.calculationStatus, "NEEDS_CONVERSION");
  assert.strictEqual(r.needsCurrencyConversion, true);
  return `status=${r.calculationStatus}`;
});

/* =========================================================
 * 6. TRADELOCKER SPEC VALIDATION (validateInstrumentSpec)
 * ========================================================= */
console.log("\n=== 6. TRADELOCKER SPEC VALIDATION ===");

function expectReject(name, raw, reasonMustContain) {
  check(name, () => {
    const v = validateInstrumentSpec(raw);
    assert.strictEqual(v.valid, false, "should be rejected");
    assert.ok(v.error.includes("Invalid TradeLocker instrument specification"));
    assert.ok(v.diagnostics.invalidReason);
    if (reasonMustContain) {
      assert.ok(
        v.error.toLowerCase().includes(reasonMustContain.toLowerCase()) ||
        v.diagnostics.invalidReason.toLowerCase().includes(reasonMustContain.toLowerCase()),
        `expected reason containing "${reasonMustContain}", got "${v.diagnostics.invalidReason}"`
      );
    }
    return `invalidReason="${v.diagnostics.invalidReason}" error="${v.error.replace(/\n/g, " | ")}"`;
  });
}

expectReject("lotSize missing", { instrumentId: "123", name: "US100" }, "missing");
expectReject("lotSize undefined", { instrumentId: "123", name: "US100", lotSize: undefined }, "missing");
expectReject("lotSize null", { instrumentId: "123", name: "US100", lotSize: null }, "missing");
expectReject("lotSize empty string", { instrumentId: "123", name: "US100", lotSize: "" }, "missing");
expectReject("lotSize 0", { instrumentId: "123", name: "US100", lotSize: 0 }, "less than or equal to zero");
expectReject("lotSize '0'", { instrumentId: "123", name: "US100", lotSize: "0" }, "less than or equal to zero");
expectReject("lotSize -1", { instrumentId: "123", name: "US100", lotSize: -1 }, "less than or equal to zero");
expectReject("lotSize NaN", { instrumentId: "123", name: "US100", lotSize: NaN }, "not a finite number");
expectReject("lotSize 'abc'", { instrumentId: "123", name: "US100", lotSize: "abc" }, "not a finite number");

check("valid US100 spec accepted, broker values preserved", () => {
  const v = validateInstrumentSpec({
    instrumentId: "551",
    name: "US100",
    lotSize: "10",
    lotStep: 0.01,
    minLot: 0.01,
    maxLot: 100,
    tickSize: [{ tickSize: 0.01 }],
    quotingCurrency: "usd"
  });
  assert.strictEqual(v.valid, true, v.error);
  assert.strictEqual(v.spec.lotSize, 10);
  assert.strictEqual(v.spec.symbol, "US100");
  assert.strictEqual(v.spec.tickSize, 0.01);
  assert.strictEqual(v.spec.quotingCurrency, "USD");
  return JSON.stringify(v.spec);
});

check("valid spec feeds calculator identically to manual path", () => {
  const v = validateInstrumentSpec({ instrumentId: "551", name: "US100", lotSize: 10, quotingCurrency: "USD" });
  const r = calculateTrade({
    symbol: v.spec.symbol, direction: "BUY", entry: 24000, exitPrice: 24050,
    quantity: 1, contractSize: v.spec.lotSize, accountCurrency: "USD"
  });
  assert.strictEqual(r.profitLoss, 500);
  return "broker lotSize 10 -> same $500 as manual cs=10";
});

check("diagnostic includes instrumentId + exact lotSize value", () => {
  const v = validateInstrumentSpec({ instrumentId: "9001", name: "NAS100", lotSize: 0 });
  assert.ok(v.error.includes("9001"));
  assert.ok(v.error.includes("lotSize: 0"));
  assert.strictEqual(v.diagnostics.symbol, "US100"); // canonicalized in diagnostics
  return "instrumentId and lotSize present in error text";
});

console.log(`\n==============================\nPASSED: ${passed}  FAILED: ${failed}\n==============================`);
process.exit(failed > 0 ? 1 : 0);
