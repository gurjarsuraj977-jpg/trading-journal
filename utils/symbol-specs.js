const SYMBOL_SPECS = {
  XAUUSD: {
    contractSize: 100,
    defaultLeverage: 100,
    priceDecimals: 2,
    quantityDecimals: 2
  },

  EURUSD: {
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2
  },

  GBPUSD: {
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2
  },

  USDJPY: {
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 3,
    quantityDecimals: 2
  },

  AUDUSD: {
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2
  },

  USDCAD: {
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2
  },

  USDCHF: {
    contractSize: 100000,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2
  },

  BTCUSD: {
    contractSize: 1,
    defaultLeverage: 100,
    priceDecimals: 2,
    quantityDecimals: 4
  },

  ETHUSD: {
    contractSize: 1,
    defaultLeverage: 100,
    priceDecimals: 2,
    quantityDecimals: 4
  }
};

function getSymbolSpec(symbol) {
  const key = String(symbol || "").trim().toUpperCase();

  return SYMBOL_SPECS[key] || {
    contractSize: 1,
    defaultLeverage: 100,
    priceDecimals: 5,
    quantityDecimals: 2
  };
}

module.exports = {
  SYMBOL_SPECS,
  getSymbolSpec
};
