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
 * Known symbols return their configured specification.
 * Unknown symbols return an explicit unknown specification
 * instead of silently assuming contractSize = 1.
 */
function getSymbolSpec(symbol) {
  const key = String(symbol || "")
    .trim()
    .toUpperCase();

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


module.exports = {
  SYMBOL_SPECS,
  getSymbolSpec
};
