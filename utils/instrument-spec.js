/**
 * Shared instrument specification helpers.
 *
 * Single source of truth for:
 *  - canonical symbol / alias resolution (US100, NAS100, USTEC, ...)
 *  - strict validation of broker-provided specifications (TradeLocker)
 *  - preserving the broker's raw specification fields
 *
 * Used by:
 *  - utils/symbol-specs.js        (static/manual specifications)
 *  - tradelocker/tradelocker-routes.js (broker-provided specifications)
 */

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[\s._\-\/]+/g, "");
}

/*
 * Broker naming varies widely for the same underlying index.
 * Map aliases to one canonical symbol so journals, market_symbols
 * rows and calculations all agree on the same key.
 *
 * NOTE: canonicalization is about NAMING only. It never implies a
 * contract size — those remain broker-specific.
 */
const SYMBOL_ALIASES = {
  // US Tech 100 index CFD
  US100: "US100",
  NAS100: "US100",
  NQ100: "US100",
  USTEC: "US100",
  USTECH: "US100",
  US100USD: "US100",
  NAS100USD: "US100",
  USTECUSD: "US100",
  USTECHCASH: "US100",
  NASDAQ: "US100",
  NASDAQ100: "US100",
  USATECH100: "US100",
  TECH100: "US100",

  // Other common index CFD aliases (naming only)
  US30: "US30",
  WALLSTREET30: "US30",
  WS30: "US30",
  DJ30: "US30",
  DOW30: "US30",
  US500: "US500",
  SPX500: "US500",
  USA500: "US500",
  US2000: "US2000",
  RUSSELL2000: "US2000",
  UK100: "UK100",
  UK100GILTEE: "UK100",
  GBPCFD: "UK100",
  GER40: "GER40",
  DE40: "GER40",
  DAX40: "GER40",
  XAUUSD: "XAUUSD"
};

function resolveCanonicalSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);

  if (!normalized) {
    return "";
  }

  return SYMBOL_ALIASES[normalized] || normalized;
}

function isValidPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function positiveNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractTickSize(raw) {
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];

    return numberOrNull(
      first && typeof first === "object"
        ? first.tickSize
        : first
    );
  }

  return numberOrNull(raw);
}

/**
 * Validate a broker instrument specification (e.g. TradeLocker details).
 *
 * A missing or non-positive lotSize is REJECTED here — it must never be
 * coerced into 0 and silently used in a P&L calculation.
 *
 * Returns:
 *  { valid: true,  spec }                       broker values preserved
 *  { valid: false, error, diagnostics }         exact instrument diagnostic
 */
function validateInstrumentSpec(rawSpec) {
  const spec = rawSpec || {};

  const instrumentId =
    spec.instrumentId !== undefined &&
    spec.instrumentId !== null
      ? String(spec.instrumentId)
      : null;

  const name = String(spec.name || "").trim();

  const parsedLotSize = Number(spec.lotSize);
  const hasLotSizeField =
    spec.lotSize !== undefined &&
    spec.lotSize !== null &&
    String(spec.lotSize).trim() !== "";

  const invalidReason = !hasLotSizeField
    ? "missing"
    : !Number.isFinite(parsedLotSize)
      ? "not a finite number"
      : parsedLotSize <= 0
        ? "less than or equal to zero"
        : null;

  if (invalidReason) {
    const error =
      `Invalid TradeLocker instrument specification: ` +
      `${name || "(unnamed)"}` +
      `\ninstrumentId: ${instrumentId ?? "unknown"}` +
      `\nlotSize: ${hasLotSizeField ? String(spec.lotSize) : "missing"}` +
      ` (${invalidReason}).` +
      `\nA positive contract size (lotSize) is required before this ` +
      `instrument can be imported.`;

    console.error("[TradeLocker Instrument Spec Invalid]:", error);

    return {
      valid: false,
      error,
      diagnostics: {
        instrumentId,
        name: name || null,
        symbol: name ? resolveCanonicalSymbol(name) : null,
        rawLotSize:
          hasLotSizeField ? spec.lotSize : null,
        invalidReason
      }
    };
  }

  return {
    valid: true,
    spec: {
      instrumentId,
      name: name || instrumentId,
      symbol: name ? resolveCanonicalSymbol(name) : null,
      lotSize: parsedLotSize,
      lotStep: positiveNumberOrNull(spec.lotStep),
      minLot: positiveNumberOrNull(spec.minLot),
      maxLot: positiveNumberOrNull(spec.maxLot),
      tickSize: extractTickSize(spec.tickSize),
      quotingCurrency:
        String(spec.quotingCurrency || "")
          .trim()
          .toUpperCase() || null
    }
  };
}

module.exports = {
  normalizeSymbol,
  resolveCanonicalSymbol,
  isValidPositiveNumber,
  positiveNumberOrNull,
  numberOrNull,
  extractTickSize,
  validateInstrumentSpec,
  SYMBOL_ALIASES
};
