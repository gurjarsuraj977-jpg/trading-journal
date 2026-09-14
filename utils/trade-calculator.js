const { getSymbolSpec } = require("./symbol-specs");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, decimals = 4) {
  const factor = Math.pow(10, decimals);
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
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
  contractSize,
  leverage
}) {
  const s = String(symbol || "").trim().toUpperCase();
  const d = String(direction || "").trim().toUpperCase();

  const spec = getSymbolSpec(s);

  const cs = num(contractSize, spec.contractSize);
  const lev = num(leverage, spec.defaultLeverage);

  const e = num(entry);
  const sl = stopLoss === null || stopLoss === "" ? null : num(stopLoss);
  const tp = takeProfit === null || takeProfit === "" ? null : num(takeProfit);
  const ex = exitPrice === null || exitPrice === "" ? null : num(exitPrice);
  const lots = Math.max(0, num(quantity, 1));
  const balance = Math.max(0, num(accountBalance));

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
    contractSize: cs,
    leverage: lev
  };

  if (!e || lots <= 0 || !["BUY", "SELL"].includes(d)) {
    return result;
  }

  /*
   * Position/notional value
   *
   * XAUUSD example:
   * 2500 × 100 oz × 0.10 lot = $25,000
   */
  result.positionValue = round(e * cs * lots, 2);

  /*
   * Estimated margin
   *
   * $25,000 / 100 leverage = $250
   */
  if (lev > 0) {
    result.margin = round(result.positionValue / lev, 2);
  }

  /*
   * Risk
   */
  if (sl !== null) {
    result.entrySlDistance = round(Math.abs(e - sl), 8);

    result.riskAmount = round(
      result.entrySlDistance * cs * lots,
      2
    );

    if (balance > 0) {
      result.riskPercent = round(
        (result.riskAmount / balance) * 100,
        4
      );
    }
  }

  /*
   * Potential profit from TP
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

    result.potentialProfit = round(
      rewardDistance * cs * lots,
      2
    );

    /*
     * Potential loss is the amount risked.
     */
    if (result.riskAmount > 0) {
      result.potentialLoss = round(
        -result.riskAmount,
        2
      );

      result.plannedRr = round(
        result.potentialProfit / result.riskAmount,
        4
      );
    }
  }

  /*
   * Actual P&L
   */
  if (ex !== null) {
    let priceDifference = 0;

    if (d === "BUY") {
      priceDifference = ex - e;
    } else {
      priceDifference = e - ex;
    }

    result.profitLoss = round(
      priceDifference * cs * lots,
      2
    );

    /*
     * Actual R
     */
    if (result.riskAmount > 0) {
      result.actualR = round(
        result.profitLoss / result.riskAmount,
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

  return result;
}

module.exports = {
  calculateTrade
};
