const { getSymbolSpec } = require("./symbol-specs");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 4) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  const factor = Math.pow(10, decimals);

  return Math.round((n + Number.EPSILON) * factor) / factor;
}

function normalizeDirection(direction) {
  return String(direction || "")
    .trim()
    .toUpperCase();
}

function validPrice(value) {
  return value !== null &&
    value !== "" &&
    Number.isFinite(Number(value));
}
function resolveConversionRate({
  pnlCurrency,
  accountCurrency,
  pnlConversionRate
}) {
  const pnl = String(pnlCurrency || "")
    .trim()
    .toUpperCase();

  const account = String(accountCurrency || "")
    .trim()
    .toUpperCase();

  if (!pnl || !account) {
    return {
      rate: null,
      required: true,
      valid: false
    };
  }

  // Same currency: no conversion required.
  if (pnl === account) {
    return {
      rate: 1,
      required: false,
      valid: true
    };
  }

  // Different currencies require an externally supplied rate.
  const supplied = Number(pnlConversionRate);

  if (Number.isFinite(supplied) && supplied > 0) {
    return {
      rate: supplied,
      required: true,
      valid: true
    };
  }

  return {
    rate: null,
    required: true,
    valid: false
  };
}
function calculateTrade({
  symbol,
  direction,
  entry,
  stopLoss,
  takeProfit,
  exitPrice,
  quantity,
  accountBalance = 0,
  accountCurrency = "USD",

  /*
   * Optional custom instrument values.
   * These allow future broker/database specifications
   * without breaking the current calculator.
   */
  contractSize,
  leverage,
  pnlCurrency,

  /*
   * Currency conversion:
   *
   * Example:
   * USD account + USDJPY trade
   * P&L is generated in JPY.
   *
   * pnlConversionRate should convert:
   * 1 unit of pnlCurrency -> accountCurrency
   *
   * Example:
   * JPY -> USD
   * 1 JPY = 0.00667 USD
   */
  pnlConversionRate
}) {
  const s = String(symbol || "")
    .trim()
    .toUpperCase();

  const d = normalizeDirection(direction);

  const spec = getSymbolSpec(s);

  const isKnownSymbol = spec.known === true;

  /*
   * Custom values override the instrument specification.
   * This keeps compatibility with existing callers.
   */
  const customContractSize = finiteOrNull(contractSize);
  const customLeverage = finiteOrNull(leverage);

  const cs = customContractSize !== null
    ? customContractSize
    : finiteOrNull(spec.contractSize);

  const lev = customLeverage !== null
    ? customLeverage
    : finiteOrNull(spec.defaultLeverage);

  const e = finiteOrNull(entry);

  const sl = validPrice(stopLoss)
    ? finiteOrNull(stopLoss)
    : null;

  const tp = validPrice(takeProfit)
    ? finiteOrNull(takeProfit)
    : null;

  const ex = validPrice(exitPrice)
    ? finiteOrNull(exitPrice)
    : null;

  const lots = Math.max(0, num(quantity, 1));
  const balance = Math.max(0, num(accountBalance));

  const accCurrency = String(accountCurrency || "USD")
    .trim()
    .toUpperCase();

  const tradePnlCurrency = String(
    pnlCurrency ||
    spec.pnlCurrency ||
    spec.quoteCurrency ||
    ""
  )
    .trim()
    .toUpperCase();

  const suppliedConversionRate =
    finiteOrNull(pnlConversionRate);

  /*
   * Currency conversion factor:
   *
   * Same currency = 1
   *
   * Different currencies require an explicit
   * conversion rate. We never guess one.
   */
const conversion = resolveConversionRate({
  pnlCurrency: tradePnlCurrency,
  accountCurrency: accCurrency,
  pnlConversionRate: suppliedConversionRate
});

const conversionRate = conversion.rate;

  const result = {
    riskAmount: 0,
    riskPercent: 0,
    profitLoss: 0,
    potentialProfit: 0,
    potentialLoss: 0,
    plannedRr: 0,
    actualR: 0,
    positionValue: 0,
    margin: 0,
    entrySlDistance: 0,
    entryTpDistance: 0,
    winLoss: "OPEN",

    /*
     * Existing fields preserved.
     */
    contractSize: cs,
    leverage: lev,

    /*
     * V2 metadata.
     */
    symbol: s,
    direction: d,
    knownSymbol: isKnownSymbol,
    assetClass: spec.assetClass || "unknown",
    baseCurrency: spec.baseCurrency || null,
    quoteCurrency: spec.quoteCurrency || null,
    pnlCurrency: tradePnlCurrency || null,
    accountCurrency: accCurrency,
    conversionRate,
    needsCurrencyConversion: false,
    calculationStatus: "READY",
    error: null
  };

  /*
   * ---------------------------------------------------------
   * BASIC VALIDATION
   * ---------------------------------------------------------
   */

  if (!s) {
    result.calculationStatus = "INVALID";
    result.error = "Symbol is required.";
    return result;
  }

  if (!["BUY", "SELL"].includes(d)) {
    result.calculationStatus = "INVALID";
    result.error = "Direction must be BUY or SELL.";
    return result;
  }

  if (e === null || e <= 0) {
    result.calculationStatus = "INVALID";
    result.error = "Entry price must be greater than zero.";
    return result;
  }

  if (lots <= 0) {
    result.calculationStatus = "INVALID";
    result.error = "Quantity must be greater than zero.";
    return result;
  }

  /*
   * Unknown instruments are no longer silently guessed.
   *
   * A custom contract size + custom P&L currency can be
   * supplied later for broker-specific instruments.
   */
  if (!isKnownSymbol && cs === null) {
    result.calculationStatus = "UNKNOWN_INSTRUMENT";
    result.error =
      `Unknown instrument "${s}". ` +
      `A valid contract size is required.`;

    return result;
  }

  if (cs === null || cs <= 0) {
    result.calculationStatus = "INVALID";
    result.error =
      "Contract size must be greater than zero.";

    return result;
  }

  /*
   * ---------------------------------------------------------
   * SL VALIDATION
   * ---------------------------------------------------------
   *
   * BUY:
   * SL must be below entry.
   *
   * SELL:
   * SL must be above entry.
   */

  if (sl !== null) {
    if (sl <= 0) {
      result.calculationStatus = "INVALID";
      result.error =
        "Stop loss price must be greater than zero.";

      return result;
    }

    if (d === "BUY" && sl >= e) {
      result.calculationStatus = "INVALID";
      result.error =
        "For a BUY trade, stop loss must be below entry.";

      return result;
    }

    if (d === "SELL" && sl <= e) {
      result.calculationStatus = "INVALID";
      result.error =
        "For a SELL trade, stop loss must be above entry.";

      return result;
    }
  }

  /*
   * ---------------------------------------------------------
   * TP VALIDATION
   * ---------------------------------------------------------
   *
   * BUY:
   * TP must be above entry.
   *
   * SELL:
   * TP must be below entry.
   */

  if (tp !== null) {
    if (tp <= 0) {
      result.calculationStatus = "INVALID";
      result.error =
        "Take profit price must be greater than zero.";

      return result;
    }

    if (d === "BUY" && tp <= e) {
      result.calculationStatus = "INVALID";
      result.error =
        "For a BUY trade, take profit must be above entry.";

      return result;
    }

    if (d === "SELL" && tp >= e) {
      result.calculationStatus = "INVALID";
      result.error =
        "For a SELL trade, take profit must be below entry.";

      return result;
    }
  }

  /*
   * ---------------------------------------------------------
   * EXIT VALIDATION
   * ---------------------------------------------------------
   */

  if (ex !== null && ex <= 0) {
    result.calculationStatus = "INVALID";
    result.error =
      "Exit price must be greater than zero.";

    return result;
  }

  /*
   * ---------------------------------------------------------
   * CURRENCY CONVERSION
   * ---------------------------------------------------------
   */

if (conversion.required && !conversion.valid) {
    result.needsCurrencyConversion = true;

    if (
      conversionRate === null ||
      conversionRate <= 0
    ) {
      result.calculationStatus = "NEEDS_CONVERSION";
      result.error =
        `P&L is calculated in ${tradePnlCurrency}, ` +
        `but the account is in ${accCurrency}. ` +
        `A valid currency conversion rate is required.`;

      /*
       * Do not invent a conversion rate.
       *
       * We can still provide distances and raw
       * instrument values, but monetary account
       * calculations must not be fabricated.
       */
    }
  }

  /*
   * ---------------------------------------------------------
   * POSITION VALUE
   * ---------------------------------------------------------
   *
   * Raw notional:
   *
   * entry × contractSize × quantity
   *
   * For USD-quoted instruments this is already
   * naturally expressed in USD.
   *
   * For non-USD P&L currencies, conversion is
   * applied when available.
   */

  const rawPositionValue =
    e * cs * lots;

  if (
    conversionRate !== null &&
    tradePnlCurrency &&
    tradePnlCurrency !== accCurrency
  ) {
    result.positionValue = round(
      rawPositionValue * conversionRate,
      2
    );
  } else if (
    tradePnlCurrency === accCurrency
  ) {
    result.positionValue = round(
      rawPositionValue,
      2
    );
  } else {
    /*
     * Unknown currency relationship:
     * don't pretend this is account-currency value.
     */
    result.positionValue = 0;
  }

  /*
   * ---------------------------------------------------------
   * MARGIN
   * ---------------------------------------------------------
   */

  if (
    lev !== null &&
    lev > 0 &&
    result.positionValue > 0
  ) {
    result.margin = round(
      result.positionValue / lev,
      2
    );
  }

  /*
   * ---------------------------------------------------------
   * STOP LOSS / RISK
   * ---------------------------------------------------------
   */

  if (sl !== null) {
    result.entrySlDistance = round(
      Math.abs(e - sl),
      8
    );

    const rawRisk =
      result.entrySlDistance *
      cs *
      lots;

    if (
      conversionRate !== null &&
      tradePnlCurrency &&
      tradePnlCurrency !== accCurrency
    ) {
      result.riskAmount = round(
        rawRisk * conversionRate,
        2
      );
    } else if (
      tradePnlCurrency === accCurrency
    ) {
      result.riskAmount = round(
        rawRisk,
        2
      );
    } else {
      result.riskAmount = 0;
    }

    if (
      balance > 0 &&
      result.riskAmount > 0
    ) {
      result.riskPercent = round(
        (result.riskAmount / balance) * 100,
        4
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * TAKE PROFIT / POTENTIAL REWARD
   * ---------------------------------------------------------
   */

  if (tp !== null) {
    result.entryTpDistance = round(
      Math.abs(tp - e),
      8
    );

    let rewardDistance = 0;

    if (d === "BUY") {
      rewardDistance = tp - e;
    } else {
      rewardDistance = e - tp;
    }

    const rawReward =
      rewardDistance *
      cs *
      lots;

    if (
      conversionRate !== null &&
      tradePnlCurrency &&
      tradePnlCurrency !== accCurrency
    ) {
      result.potentialProfit = round(
        rawReward * conversionRate,
        2
      );
    } else if (
      tradePnlCurrency === accCurrency
    ) {
      result.potentialProfit = round(
        rawReward,
        2
      );
    } else {
      result.potentialProfit = 0;
    }

    /*
     * Potential loss and planned R:R are only
     * meaningful when monetary risk is known.
     */
    if (result.riskAmount > 0) {
      result.potentialLoss = round(
        -result.riskAmount,
        2
      );

      result.plannedRr = round(
        result.potentialProfit /
        result.riskAmount,
        4
      );
    }
  }

  /*
   * ---------------------------------------------------------
   * ACTUAL P&L
   * ---------------------------------------------------------
   */

  if (ex !== null) {
    let priceDifference = 0;

    if (d === "BUY") {
      priceDifference = ex - e;
    } else {
      priceDifference = e - ex;
    }

    const rawProfitLoss =
      priceDifference *
      cs *
      lots;

    if (
      conversionRate !== null &&
      tradePnlCurrency &&
      tradePnlCurrency !== accCurrency
    ) {
      result.profitLoss = round(
        rawProfitLoss * conversionRate,
        2
      );
    } else if (
      tradePnlCurrency === accCurrency
    ) {
      result.profitLoss = round(
        rawProfitLoss,
        2
      );
    } else {
      result.profitLoss = 0;
    }

    /*
     * Actual R only makes sense when risk is known.
     */
    if (result.riskAmount > 0) {
      result.actualR = round(
        result.profitLoss /
        result.riskAmount,
        4
      );
    }

    if (result.profitLoss > 0) {
      result.winLoss = "WIN";
    } else if (result.profitLoss < 0) {
      result.winLoss = "LOSS";
    } else {
      result.winLoss = "BREAKEVEN";
    }
  }

  /*
   * If conversion is missing, calculations involving
   * account-currency money are intentionally incomplete.
   */
  if (
    result.calculationStatus === "NEEDS_CONVERSION"
  ) {
    /*
     * Preserve distances, but do not expose fabricated
     * monetary values.
     */
    result.riskAmount = 0;
    result.riskPercent = 0;
    result.profitLoss = 0;
    result.potentialProfit = 0;
    result.potentialLoss = 0;
    result.plannedRr = 0;
    result.actualR = 0;
    result.positionValue = 0;
    result.margin = 0;
  }

  return result;
}

module.exports = {
  calculateTrade
};
