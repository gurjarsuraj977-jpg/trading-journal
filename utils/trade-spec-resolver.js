/**
 * Manual trade symbol validation + contract-size resolution.
 *
 *   selected symbol
 *        -> canonical symbol (allow-list check)
 *        -> instrument specification
 *        -> verified contract size
 *        -> calculateTrade()
 *
 * Contract sizes are NEVER guessed here:
 *  - instruments with a static specification (XAUUSD, EURUSD, ...)
 *    keep using that specification exactly as before;
 *  - instruments flagged requiresBrokerContractSize (US100) only use a
 *    contract size that the TradeLocker sync stored in
 *    market_symbols.contract_size from the broker's own `lotSize`.
 *    If no such value exists the trade is rejected with
 *    MISSING_CONTRACT_SIZE.
 *
 * `db` and `getRate` are injected so this module can be tested
 * without PostgreSQL / network access.
 */

const {
  getSymbolSpec,
  isSupportedManualSymbol
} = require("./symbol-specs");
const { resolveCanonicalSymbol } = require("./instrument-spec");
const { calculateTrade } = require("./trade-calculator");

const UNSUPPORTED_SYMBOL_MESSAGE =
  "Unsupported symbol. Please select a symbol from the list.";

function missingContractSizeMessage(symbol) {
  return (
    `${symbol} cannot be calculated because its broker contract ` +
    `specification is unavailable. Please sync your TradeLocker ` +
    `account so the broker instrument data is imported, then try again.`
  );
}

/**
 * Strict validation of a symbol submitted by a client.
 *
 * Accepts only a canonical, supported symbol (case/whitespace are
 * normalised: " xauusd " -> "XAUUSD"). Aliases (NAS100, USTEC) and
 * unknown values (FOO, US100CASH) are rejected.
 */
function validateSubmittedSymbol(input) {
  const symbol = String(input === undefined || input === null ? "" : input)
    .trim()
    .toUpperCase();

  if (!symbol) {
    return { ok: false, code: "SYMBOL_REQUIRED", error: "Symbol is required." };
  }

  if (!isSupportedManualSymbol(symbol)) {
    return {
      ok: false,
      code: "UNSUPPORTED_SYMBOL",
      error: UNSUPPORTED_SYMBOL_MESSAGE
    };
  }

  return { ok: true, symbol };
}

/**
 * Look up the broker-derived contract size for a canonical symbol.
 *
 * Provenance guard: only rows written by the TradeLocker sync have a
 * broker_symbol (seed rows have NULL), so a contract size is trusted
 * only when it came with the broker's own instrument name.
 */
async function lookupBrokerContractSize(db, canonicalSymbol) {
  const r = await db(
    `SELECT contract_size, quote_asset
       FROM market_symbols
      WHERE symbol = $1
        AND active = TRUE
        AND broker_symbol IS NOT NULL
      LIMIT 1`,
    [canonicalSymbol]
  );

  if (!r || !r.rows || !r.rows.length) {
    return null;
  }

  const raw = r.rows[0].contract_size;
  const size = raw === null || raw === undefined || raw === ""
    ? NaN
    : Number(raw);

  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  const quote = String(r.rows[0].quote_asset || "")
    .trim()
    .toUpperCase();

  return { contractSize: size, quoteCurrency: quote || null };
}

/**
 * Resolve spec + verified contract size and run the calculator.
 *
 * `symbol` may be a stored legacy value (e.g. NAS100) when the caller
 * is re-saving an existing trade whose symbol is unchanged; it is
 * canonicalised for the lookup only and is never rewritten here.
 *
 * Returns:
 *   { ok:true,  calculation, contractSizeSource }
 *   { ok:false, status, code, error, calculation? }
 */
async function calculateManualTrade({
  db,
  getRate,
  symbol,
  direction,
  entry,
  stopLoss,
  takeProfit,
  exitPrice,
  quantity,
  accountBalance,
  accountCurrency
}) {
  const canonical = resolveCanonicalSymbol(symbol);
  const spec = getSymbolSpec(canonical);

  let contractSize; // undefined => calculator uses the static spec
  let pnlCurrency;  // undefined => calculator uses the static spec
  let contractSizeSource = "static-spec";

  if (spec.requiresBrokerContractSize === true) {
    const broker = await lookupBrokerContractSize(db, canonical);

    if (!broker) {
      return {
        ok: false,
        status: 400,
        code: "MISSING_CONTRACT_SIZE",
        error: missingContractSizeMessage(canonical)
      };
    }

    contractSize = broker.contractSize;
    pnlCurrency = broker.quoteCurrency || undefined;
    contractSizeSource = "broker-market-symbols";
  }

  const effectivePnlCurrency = String(
    pnlCurrency || spec.pnlCurrency || ""
  ).trim().toUpperCase();

  let pnlConversionRate = null;

  if (
    spec.known &&
    effectivePnlCurrency &&
    accountCurrency &&
    effectivePnlCurrency !== String(accountCurrency).toUpperCase()
  ) {
    const conversion = await getRate({
      fromCurrency: effectivePnlCurrency,
      toCurrency: accountCurrency
    });

    pnlConversionRate = conversion.rate;
  }

  const calculation = calculateTrade({
    symbol: canonical,
    direction,
    entry,
    stopLoss,
    takeProfit,
    exitPrice,
    quantity,
    accountBalance,
    accountCurrency,
    contractSize,
    pnlCurrency,
    pnlConversionRate
  });

  if (calculation.error) {
    return {
      ok: false,
      status: 400,
      code: calculation.calculationStatus || "INVALID",
      error: calculation.error,
      calculation
    };
  }

  return { ok: true, calculation, contractSizeSource };
}

/**
 * Supported-symbol list for the UI, annotated with availability.
 * Static instruments are always available; broker-dependent
 * instruments (US100) are available only with a verified contract size.
 */
async function listSymbolAvailability(db, symbols) {
  const out = [];

  for (const item of symbols) {
    const spec = getSymbolSpec(item.symbol);
    let available = true;

    if (spec.requiresBrokerContractSize === true) {
      available = Boolean(await lookupBrokerContractSize(db, item.symbol));
    }

    out.push({ symbol: item.symbol, label: item.label, available });
  }

  return out;
}

module.exports = {
  validateSubmittedSymbol,
  lookupBrokerContractSize,
  calculateManualTrade,
  listSymbolAvailability,
  missingContractSizeMessage,
  UNSUPPORTED_SYMBOL_MESSAGE
};
