const express = require("express");

const {
  normalizeSymbol,
  normalizeTimeframe,
  insertCandles,
  getCandles,
  getLatestCandle,
  getDataRange
} = require("./market-data");

function createMarketDataRouter({ db, auth }) {
  const router = express.Router();

  // ============================================================
  // GET /api/market-data/symbols
  // ============================================================

  router.get("/symbols", auth, async (req, res) => {
    try {
      const result = await db(`
        SELECT
          id,
          symbol,
          display_name,
          asset_class,
          base_asset,
          quote_asset,
          exchange,
          broker_symbol,
          price_decimals,
          quantity_decimals,
          tick_size,
          contract_size,
          active
        FROM market_symbols
        WHERE active = TRUE
        ORDER BY symbol
      `);

      res.json({
        symbols: result.rows
      });
    } catch (error) {
      console.error("Market symbols error:", error);

      res.status(500).json({
        error: "Could not load market symbols."
      });
    }
  });

  // ============================================================
  // GET /api/market-data/timeframes
  // ============================================================

  router.get("/timeframes", auth, async (req, res) => {
    try {
      const result = await db(`
        SELECT
          id,
          code,
          seconds,
          display_name
        FROM market_timeframes
        ORDER BY seconds
      `);

      res.json({
        timeframes: result.rows
      });
    } catch (error) {
      console.error("Market timeframe error:", error);

      res.status(500).json({
        error: "Could not load timeframes."
      });
    }
  });

  // ============================================================
  // GET /api/market-data/candles
  // ============================================================

  router.get("/candles", auth, async (req, res) => {
    try {
      const symbol = normalizeSymbol(req.query.symbol);
      const timeframe = normalizeTimeframe(
        req.query.timeframe
      );

      if (!symbol) {
        return res.status(400).json({
          error: "Symbol is required."
        });
      }

      const candles = await getCandles(db, {
        symbol,
        timeframe,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit
      });

      res.json({
        symbol,
        timeframe,
        candles
      });
    } catch (error) {
      console.error("Market candles error:", error);

      res.status(400).json({
        error:
          error.message ||
          "Could not load candles."
      });
    }
  });

  // ============================================================
  // GET /api/market-data/latest
  // ============================================================

  router.get("/latest", auth, async (req, res) => {
    try {
      const symbol = normalizeSymbol(req.query.symbol);

      const timeframe = normalizeTimeframe(
        req.query.timeframe
      );

      if (!symbol) {
        return res.status(400).json({
          error: "Symbol is required."
        });
      }

      const candle = await getLatestCandle(
        db,
        symbol,
        timeframe
      );

      res.json({
        candle
      });
    } catch (error) {
      console.error("Latest candle error:", error);

      res.status(400).json({
        error:
          error.message ||
          "Could not load latest candle."
      });
    }
  });

  // ============================================================
  // GET /api/market-data/range
  // ============================================================

  router.get("/range", auth, async (req, res) => {
    try {
      const symbol = normalizeSymbol(req.query.symbol);

      const timeframe = normalizeTimeframe(
        req.query.timeframe
      );

      if (!symbol) {
        return res.status(400).json({
          error: "Symbol is required."
        });
      }

      const range = await getDataRange(
        db,
        symbol,
        timeframe
      );

      res.json({
        symbol,
        timeframe,
        range
      });
    } catch (error) {
      console.error("Market range error:", error);

      res.status(400).json({
        error:
          error.message ||
          "Could not load market range."
      });
    }
  });

  // ============================================================
  // POST /api/market-data/candles/import
  // ============================================================
  router.get("/summary", auth, async (req, res) => {
    try {
      const result = await db(`
        SELECT
          mc.symbol,
          mc.timeframe,
          COUNT(*)::INTEGER AS candle_count,
          MIN(mc.candle_time) AS first_candle,
          MAX(mc.candle_time) AS last_candle,
          MIN(mc.open) AS lowest_open,
          MAX(mc.high) AS highest_high,
          MAX(mc.created_at) AS last_imported_at,
          COUNT(DISTINCT mc.source)::INTEGER AS source_count
        FROM market_candles mc
        GROUP BY mc.symbol, mc.timeframe
        ORDER BY mc.symbol, mc.timeframe
      `);

      res.json({
        ok: true,
        summary: result.rows
      });
    } catch (error) {
      console.error("Market data summary error:", error);

      res.status(500).json({
        ok: false,
        error: "Could not load market data summary."
      });
    }
  });

  router.post(
    "/candles/import",
    auth,
    async (req, res) => {
      try {
        const candles = req.body?.candles;

        if (!Array.isArray(candles)) {
          return res.status(400).json({
            error: "candles must be an array."
          });
        }

        if (candles.length === 0) {
          return res.status(400).json({
            error: "No candles supplied."
          });
        }

        if (candles.length > 50000) {
          return res.status(400).json({
            error:
              "Maximum 50,000 candles per import."
          });
        }

        const result = await insertCandles(
          db,
          candles
        );

        res.status(201).json({
          ok: true,
          ...result
        });
      } catch (error) {
        console.error(
          "Market candle import error:",
          error
        );

        res.status(400).json({
          error:
            error.message ||
            "Could not import candles."
        });
      }
    }
  );

  return router;
}

module.exports = {
  createMarketDataRouter
};
