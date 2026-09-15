const TWELVE_DATA_BASE_URL = "https://api.twelvedata.com/time_series";

const INTERVAL_MAP = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day"
};

const SYMBOL_MAP = {
  XAUUSD: "XAU/USD",
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  AUDUSD: "AUD/USD",
  USDCAD: "USD/CAD",
  USDCHF: "USD/CHF",
  BTCUSD: "BTC/USD",
  ETHUSD: "ETH/USD"
};

function getApiKey() {
  const key = process.env.TWELVE_DATA_API_KEY;

  if (!key) {
    throw new Error("TWELVE_DATA_API_KEY is not configured.");
  }

  return key;
}

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, "");
}

function normalizeTimeframe(timeframe) {
  const value = String(timeframe || "").trim().toLowerCase();

  if (!INTERVAL_MAP[value]) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }

  return value;
}

function providerSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);

  return SYMBOL_MAP[normalized] || normalized;
}

function parseCandle(value, symbol, timeframe) {
  if (!value || !value.datetime) {
    return null;
  }

  const open = Number(value.open);
  const high = Number(value.high);
  const low = Number(value.low);
  const close = Number(value.close);

  if (![open, high, low, close].every(Number.isFinite)) {
    return null;
  }

  if (
    high < low ||
    high < open ||
    high < close ||
    low > open ||
    low > close
  ) {
    return null;
  }

  const timestamp = new Date(value.datetime);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  const volume =
    value.volume !== undefined &&
    value.volume !== null &&
    value.volume !== ""
      ? Number(value.volume)
      : null;

  return {
    symbol,
    timeframe,
    candle_time: timestamp.toISOString(),
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : null,
    tick_volume: null,
    spread: null,
    source: "twelve_data"
  };
}

async function fetchTimeSeries({
  symbol,
  timeframe,
  startDate,
  endDate,
  outputSize = 5000
}) {
  const apiKey = getApiKey();

  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedTimeframe = normalizeTimeframe(timeframe);

  const params = new URLSearchParams({
    symbol: providerSymbol(normalizedSymbol),
    interval: INTERVAL_MAP[normalizedTimeframe],
    apikey: apiKey,
    timezone: "UTC",
    outputsize: String(
      Math.min(Math.max(Number(outputSize) || 5000, 1), 5000)
    )
  });

  if (startDate) {
    params.set("start_date", startDate);
  }

  if (endDate) {
    params.set("end_date", endDate);
  }

  const response = await fetch(
    `${TWELVE_DATA_BASE_URL}?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "GhostTrader/8.2"
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Twelve Data returned invalid JSON. HTTP ${response.status}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.code ||
        `Twelve Data HTTP ${response.status}`
    );
  }

  if (data.status === "error") {
    throw new Error(
      data.message ||
        data.code ||
        "Twelve Data returned an API error."
    );
  }

  if (!Array.isArray(data.values)) {
    throw new Error(
      "Twelve Data returned no candle values."
    );
  }

  const candles = data.values
    .map(value =>
      parseCandle(
        value,
        normalizedSymbol,
        normalizedTimeframe
      )
    )
    .filter(Boolean)
    .reverse();

  return {
    symbol: normalizedSymbol,
    timeframe: normalizedTimeframe,
    provider_symbol: providerSymbol(normalizedSymbol),
    candles,
    meta: data.meta || null
  };
}

async function fetchLatestCandles({
  symbol,
  timeframe,
  limit = 5000
}) {
  return fetchTimeSeries({
    symbol,
    timeframe,
    outputSize: limit
  });
}
async function fetchLatestPrice(symbol) {
  const apiKey = getApiKey();

  const normalizedSymbol = normalizeSymbol(symbol);

  if (!normalizedSymbol) {
    throw new Error("Symbol is required.");
  }

  const params = new URLSearchParams({
    symbol: providerSymbol(normalizedSymbol),
    apikey: apiKey
  });

  const response = await fetch(
    `https://api.twelvedata.com/price?${params.toString()}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "GhostTrader/8.2"
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Twelve Data returned invalid JSON. HTTP ${response.status}`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.code ||
      `Twelve Data HTTP ${response.status}`
    );
  }

  if (data.status === "error") {
    throw new Error(
      data.message ||
      data.code ||
      "Twelve Data returned an API error."
    );
  }

  const price = Number(data.price);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(
      `Twelve Data returned an invalid price for ${normalizedSymbol}.`
    );
  }

  return {
    symbol: normalizedSymbol,
    provider_symbol: providerSymbol(normalizedSymbol),
    price
  };
}
module.exports = {
  fetchTimeSeries,
  fetchLatestCandles,
  fetchLatestPrice,
  normalizeSymbol,
  normalizeTimeframe,
  providerSymbol,
  INTERVAL_MAP,
  SYMBOL_MAP
};
