const VALID_TIMEFRAMES = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d"
]);

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, "");
}

function normalizeTimeframe(value) {
  const timeframe = String(value || "")
    .trim()
    .toLowerCase();

  if (!VALID_TIMEFRAMES.has(timeframe)) {
    throw new Error("Unsupported timeframe.");
  }

  return timeframe;
}

function normalizeCandle(input) {
  const candleTime = new Date(
    input.candle_time || input.timestamp
  );

  if (Number.isNaN(candleTime.getTime())) {
    throw new Error("Invalid candle timestamp.");
  }

  const open = Number(input.open);
  const high = Number(input.high);
  const low = Number(input.low);
  const close = Number(input.close);

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close)
  ) {
    throw new Error("Invalid OHLC values.");
  }

  if (
    high < low ||
    high < open ||
    high < close ||
    low > open ||
    low > close
  ) {
    throw new Error("Invalid OHLC relationship.");
  }

  let volume = null;

  if (
    input.volume !== undefined &&
    input.volume !== null &&
    input.volume !== ""
  ) {
    volume = Number(input.volume);

    if (!Number.isFinite(volume) || volume < 0) {
      throw new Error("Invalid volume.");
    }
  }

  let tickVolume = null;

  if (
    input.tick_volume !== undefined &&
    input.tick_volume !== null &&
    input.tick_volume !== ""
  ) {
    tickVolume = Number(input.tick_volume);

    if (!Number.isInteger(tickVolume) || tickVolume < 0) {
      throw new Error("Invalid tick volume.");
    }
  }

  let spread = null;

  if (
    input.spread !== undefined &&
    input.spread !== null &&
    input.spread !== ""
  ) {
    spread = Number(input.spread);

    if (!Number.isFinite(spread) || spread < 0) {
      throw new Error("Invalid spread.");
    }
  }

  return {
    symbol: normalizeSymbol(input.symbol),
    timeframe: normalizeTimeframe(input.timeframe),
    candleTime,
    open,
    high,
    low,
    close,
    volume,
    tickVolume,
    spread,
    source: String(input.source || "unknown")
      .trim()
      .slice(0, 80)
  };
}

async function insertCandles(db, candles) {
  if (!Array.isArray(candles)) {
    throw new Error("Candles must be an array.");
  }

  let inserted = 0;
  let skipped = 0;

  for (const raw of candles) {
    try {
      const candle = normalizeCandle(raw);

      if (!candle.symbol) {
        throw new Error("Missing symbol.");
      }

      const result = await db(
        `
        INSERT INTO market_candles (
          symbol,
          timeframe,
          candle_time,
          open,
          high,
          low,
          close,
          volume,
          tick_volume,
          spread,
          source
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
        )
        ON CONFLICT (
          symbol,
          timeframe,
          candle_time
        )
        DO NOTHING
        `,
        [
          candle.symbol,
          candle.timeframe,
          candle.candleTime,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
          candle.tickVolume,
          candle.spread,
          candle.source
        ]
      );

      if (result.rowCount > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (error) {
      skipped++;
    }
  }

  return {
    received: candles.length,
    inserted,
    skipped
  };
}

async function getCandles(db, options = {}) {
  const symbol = normalizeSymbol(options.symbol);
  const timeframe = normalizeTimeframe(options.timeframe);

  if (!symbol) {
    throw new Error("Symbol is required.");
  }

  const values = [symbol, timeframe];

  let where = `
    symbol = $1
    AND timeframe = $2
  `;

  if (options.from) {
    const from = new Date(options.from);

    if (Number.isNaN(from.getTime())) {
      throw new Error("Invalid from date.");
    }

    values.push(from);
    where += ` AND candle_time >= $${values.length}`;
  }

  if (options.to) {
    const to = new Date(options.to);

    if (Number.isNaN(to.getTime())) {
      throw new Error("Invalid to date.");
    }

    values.push(to);
    where += ` AND candle_time <= $${values.length}`;
  }

  let limit = Number(options.limit || 5000);

  if (!Number.isFinite(limit)) {
    limit = 5000;
  }

  limit = Math.max(
    1,
    Math.min(50000, Math.floor(limit))
  );

  values.push(limit);

  const result = await db(
    `
    SELECT
      id,
      symbol,
      timeframe,
      candle_time,
      open,
      high,
      low,
      close,
      volume,
      tick_volume,
      spread,
      source
    FROM market_candles
    WHERE ${where}
    ORDER BY candle_time ASC
    LIMIT $${values.length}
    `,
    values
  );

  return result.rows;
}

async function getLatestCandle(
  db,
  symbol,
  timeframe
) {
  symbol = normalizeSymbol(symbol);
  timeframe = normalizeTimeframe(timeframe);

  const result = await db(
    `
    SELECT
      id,
      symbol,
      timeframe,
      candle_time,
      open,
      high,
      low,
      close,
      volume,
      tick_volume,
      spread,
      source
    FROM market_candles
    WHERE symbol = $1
      AND timeframe = $2
    ORDER BY candle_time DESC
    LIMIT 1
    `,
    [symbol, timeframe]
  );

  return result.rows[0] || null;
}

async function getDataRange(
  db,
  symbol,
  timeframe
) {
  symbol = normalizeSymbol(symbol);
  timeframe = normalizeTimeframe(timeframe);

  const result = await db(
    `
    SELECT
      MIN(candle_time) AS first_candle,
      MAX(candle_time) AS last_candle,
      COUNT(*)::int AS candles
    FROM market_candles
    WHERE symbol = $1
      AND timeframe = $2
    `,
    [symbol, timeframe]
  );

  return result.rows[0];
}

module.exports = {
  VALID_TIMEFRAMES,
  normalizeSymbol,
  normalizeTimeframe,
  normalizeCandle,
  insertCandles,
  getCandles,
  getLatestCandle,
  getDataRange
};
