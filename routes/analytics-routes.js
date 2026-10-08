const express = require("express");
const { getMetrics, toAnalyticsSummary } = require("../metrics/service");

function createAnalyticsRouter({ db, auth }) {
  const router = express.Router();

  router.get("/", auth, async (req, res) => {
    try {
      const tz = String(req.query.tz || "UTC");
      const accountName = String(req.query.account || "").trim();
      const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || ""))
        ? String(req.query.from)
        : "";
      const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || ""))
        ? String(req.query.to)
        : "";
      const source = String(req.query.source || "all");

      const m = await getMetrics(db, {
        userId: req.user.id,
        accountName: accountName || undefined,
        from: from || undefined,
        to: to || undefined,
        tz,
        source,
        includeBreakdowns: true,
        includeCurve: true,
      });

      const summary = toAnalyticsSummary(m);
      const b = m.breakdowns || {};

      res.json({
        summary,
        bySymbol: (b.bySymbol || []).map((r) => ({
          symbol: r.name,
          trades: r.trades,
          pnl: Number(r.pnl),
        })),
        byStrategy: (b.byStrategy || []).map((r) => ({
          strategy: r.name,
          trades: r.trades,
          pnl: Number(r.pnl),
        })),
        bySession: (b.bySession || []).map((r) => ({
          session: r.name,
          trades: r.trades,
          pnl: Number(r.pnl),
        })),
        byDirection: (b.byDirection || []).map((r) => ({
          direction: r.name,
          trades: r.trades,
          pnl: Number(r.pnl),
        })),
        byDay: (b.byDay || []).map((r) => ({
          day: r.day,
          pnl: Number(r.pnl),
          trades: r.trades,
        })),
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Analytics failed." });
    }
  });

  return router;
}

module.exports = { createAnalyticsRouter };
