const { resolveCanonicalSymbol } = require("./instrument-spec");

const SYMBOL_SPECS = {
  XAUUSD: {
    symbol: "XAUUSD",
    assetClass: "metals",
    baseCurrency: "XAU",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    contractSize: 100,
    defaultLeverage: 100,
    priceDecimals: 2,
    quantityDecimals: 2,
    known: true
  },

  EURUSD: {
    symbol: "EURUSD",
    assetClass: "forex",
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2,
    known: true
  },

  GBPUSD: {
    symbol: "GBPUSD",
    assetClass: "forex",
    baseCurrency: "GBP",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2,
    known: true
  },

  USDJPY: {
    symbol: "USDJPY",
    assetClass: "forex",
    baseCurrency: "USD",
    quoteCurrency: "JPY",
    pnlCurrency: "JPY",
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 3,
    quantityDecimals: 2,
    known: true
  },

  AUDUSD: {
    symbol: "AUDUSD",
    assetClass: "forex",
    baseCurrency: "AUD",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2,
    known: true
  },

  USDCAD: {
    symbol: "USDCAD",
    assetClass: "forex",
    baseCurrency: "USD",
    quoteCurrency: "CAD",
    pnlCurrency: "CAD",
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2,
    known: true
  },

  USDCHF: {
    symbol: "USDCHF",
    assetClass: "forex",
    baseCurrency: "USD",
    quoteCurrency: "CHF",
    pnlCurrency: "CHF",
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2,
    known: true
  },

  BTCUSD: {
    symbol: "BTCUSD",
    assetClass: "crypto",
    baseCurrency: "BTC",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    contractSize: 1,
    defaultLeverage: 100,
    priceDecimals: 2,
    quantityDecimals: 4,
    known: true
  },

  ETHUSD: {
    symbol: "ETHUSD",
    assetClass: "crypto",
    baseCurrency: "ETH",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    contractSize: 1,
    defaultLeverage: 100,
    priceDecimals: 2,
    quantityDecimals: 4,
    known: true
  }
};


/**
 * Return instrument specification.
 *
 * Aliases (NAS100, USTEC, ...) resolve to the canonical symbol first.
 * Known symbols return their configured specification.
 * Unknown symbols return an explicit unknown specification
 * instead of silently assuming contractSize = 1.
 */
function getSymbolSpec(symbol) {
  const key = resolveCanonicalSymbol(symbol);

  if (SYMBOL_SPECS[key]) {
    return SYMBOL_SPECS[key];
  }

  return {
    symbol: key,
    assetClass: "unknown",
    baseCurrency: null,
    quoteCurrency: null,
    pnlCurrency: null,
    contractSize: null,
    defaultLeverage: null,
    priceDecimals: null,
    quantityDecimals: null,
    known: false
  };
}


/**
 * Index CFD placeholder specifications.
 *
 * Deliberately have NO contract size: US100/NAS100/USTEC and other
 * index CFD specifications vary by broker (one lot may be $1, $5 or
 * $10 per index point depending on the TradeLocker/broker setup).
 *
 * The purpose is recognition + aliasing only. The actual contract
 * size must come from the broker's instrument specification
 * (TradeLocker details.lotSize) or be supplied explicitly as a
 * custom contractSize when calculating.
 */
const INDEX_PLACEHOLDERS = [
  { canonical: "US100", aliases: ["US100", "NAS100", "NQ100", "USTEC", "USTECH", "US100USD", "NAS100USD", "USTECUSD", "NASDAQ", "NASDAQ100", "TECH100"] },
  { canonical: "US30", aliases: ["US30", "WALLSTREET30", "WS30", "DJ30", "DOW30"] },
  { canonical: "US500", aliases: ["US500", "SPX500", "USA500"] },
  { canonical: "US2000", aliases: ["US2000", "RUSSELL2000"] },
  { canonical: "UK100", aliases: ["UK100", "GBPCFD"] },
  { canonical: "GER40", aliases: ["GER40", "DE40", "DAX40"] }
];

for (const index of INDEX_PLACEHOLDERS) {
  if (!SYMBOL_SPECS[index.canonical]) {
    SYMBOL_SPECS[index.canonical] = {
      symbol: index.canonical,
      assetClass: "index",
      baseCurrency: index.canonical,
      quoteCurrency: "USD",
      pnlCurrency: "USD",
      contractSize: null,
      defaultLeverage: null,
      priceDecimals: 2,
      quantityDecimals: 2,
      known: true,
      requiresBrokerContractSize: true,
      note:
        `${index.canonical} CFD contract size varies by broker. ` +
        `Use the broker's instrument specification (e.g. TradeLocker lotSize) ` +
        `or supply an explicit contractSize.`
    };
  }
}


module.exports = {
  SYMBOL_SPECS,
  getSymbolSpec,
  resolveCanonicalSymbol
};
