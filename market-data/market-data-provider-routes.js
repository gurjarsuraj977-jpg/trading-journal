const express = require("express");

const {
  fetchTimeSeries,
  fetchLatestCandles,
  normalizeSymbol,
  normalizeTimeframe
} = require("./twelve-data");

const {
  insertCandles
} = require("./market-data");

function createMarketDataProviderRouter({ db, auth }) {
  const router = express.Router();

  // ---------------------------------------------------------
  // PROVIDER STATUS
  // ---------------------------------------------------------
  router.get("/provider/status", auth, async (req, res) => {
    try {
      const result = await fetchLatestCandles({
        symbol: "XAUUSD",
        timeframe: "1h",
        limit: 1
      });

      res.json({
        ok: true,
        provider: "twelve_data",
        symbol: result.symbol,
        timeframe: result.timeframe,
        provider_symbol: result.provider_symbol,
        candles_available: result.candles.length
      });
    } catch (error) {
      console.error("Market provider status error:", error);

      res.status(500).json({
        ok: false,
        provider: "twelve_data",
        error: error.message || "Provider connection failed."
      });
    }
  });

  // ---------------------------------------------------------
  // LATEST DATA SYNC
  // ---------------------------------------------------------
  router.post("/provider/sync", auth, async (req, res) => {
    try {
      const symbol = normalizeSymbol(req.body?.symbol);
      const timeframe = normalizeTimeframe(req.body?.timeframe);

      const limit = Math.min(
        Math.max(Number(req.body?.limit) || 500, 1),
        5000
      );

      if (!symbol) {
        return res.status(400).json({
          error: "Symbol is required."
        });
      }

      const result = await fetchLatestCandles({
        symbol,
        timeframe,
        limit
      });

      if (!result.candles.length) {
        return res.status(404).json({
          error: "No candles were returned by the provider."
        });
      }

      const inserted = await insertCandles(
        db,
        result.candles
      );

      res.json({
        ok: true,
        provider: "twelve_data",
        symbol: result.symbol,
        timeframe: result.timeframe,
        provider_symbol: result.provider_symbol,
        received: inserted.received,
        inserted: inserted.inserted,
        skipped: inserted.skipped,
        first_candle:
          result.candles[0]?.candle_time || null,
        last_candle:
          result.candles[result.candles.length - 1]?.candle_time || null
      });
    } catch (error) {
      console.error("Market provider sync error:", error);

      res.status(400).json({
        ok: false,
        error: error.message || "Market data sync failed."
      });
    }
  });

  // ---------------------------------------------------------
  // HISTORICAL DATA IMPORT
  // ---------------------------------------------------------
  router.post("/provider/history", auth, async (req, res) => {
    try {
      const symbol = normalizeSymbol(req.body?.symbol);
      const timeframe = normalizeTimeframe(req.body?.timeframe);

      const startDate = String(
        req.body?.start_date || ""
      ).trim();

      const endDate = String(
        req.body?.end_date || ""
      ).trim();

      if (!symbol) {
        return res.status(400).json({
          error: "Symbol is required."
        });
      }

      if (!startDate || !endDate) {
        return res.status(400).json({
          error: "start_date and end_date are required."
        });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);

      if (
        Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime())
      ) {
        return res.status(400).json({
          error: "Invalid start_date or end_date."
        });
      }

      if (start >= end) {
        return res.status(400).json({
          error: "start_date must be before end_date."
        });
      }

      const result = await fetchTimeSeries({
        symbol,
        timeframe,
        startDate,
        endDate,
        outputSize: 5000
      });

      if (!result.candles.length) {
        return res.status(404).json({
          error: "No candles were returned for this date range."
        });
      }

      const inserted = await insertCandles(
        db,
        result.candles
      );

      res.json({
        ok: true,
        provider: "twelve_data",
        symbol: result.symbol,
        timeframe: result.timeframe,
        provider_symbol: result.provider_symbol,
        requested_from: start.toISOString(),
        requested_to: end.toISOString(),
        received: inserted.received,
        inserted: inserted.inserted,
        skipped: inserted.skipped,
        first_candle:
          result.candles[0]?.candle_time || null,
        last_candle:
          result.candles[result.candles.length - 1]?.candle_time || null
      });
    } catch (error) {
      console.error("Historical market data error:", error);

      res.status(400).json({
        ok: false,
        error:
          error.message ||
          "Historical market data sync failed."
      });
    }
  });

  return router;
}

module.exports = {
  createMarketDataProviderRouter
};
