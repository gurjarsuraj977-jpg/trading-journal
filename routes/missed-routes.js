const express = require("express");

/**
 * Missed trades — Batch H validation (D-21).
 */
function createMissedRouter({ db, auth, n }) {
  const router = express.Router();
  const DIRECTIONS = new Set(["BUY", "SELL"]);

  router.get("/", auth, async (req, res) => {
    try {
      const r = await db(
        `SELECT * FROM missed_trades
         WHERE user_id=$1
         ORDER BY trade_date DESC, id DESC
         LIMIT 500`,
        [req.user.id]
      );
      res.json({ missed: r.rows });
    } catch (e) {
      res.status(500).json({ error: "Could not load missed trades." });
    }
  });

  router.post("/", auth, async (req, res) => {
    try {
      const symbol = String(req.body.symbol || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9._-]/g, "");
      if (!symbol || symbol.length > 30) {
        return res.status(400).json({ error: "Valid symbol is required." });
      }

      const direction = String(req.body.direction || "")
        .trim()
        .toUpperCase();
      if (!DIRECTIONS.has(direction)) {
        return res
          .status(400)
          .json({ error: "Direction must be BUY or SELL." });
      }

      let tradeDate = new Date();
      if (req.body.tradeDate) {
        tradeDate = new Date(req.body.tradeDate);
        if (Number.isNaN(tradeDate.getTime())) {
          return res.status(400).json({ error: "Invalid trade date." });
        }
      }

      const potentialR =
        req.body.potentialR === undefined ||
        req.body.potentialR === null ||
        req.body.potentialR === ""
          ? null
          : n(req.body.potentialR, null);
      const potentialPnl =
        req.body.potentialPnl === undefined ||
        req.body.potentialPnl === null ||
        req.body.potentialPnl === ""
          ? null
          : n(req.body.potentialPnl, null);

      if (potentialR !== null && !Number.isFinite(Number(potentialR))) {
        return res.status(400).json({ error: "Invalid potential R." });
      }
      if (potentialPnl !== null && !Number.isFinite(Number(potentialPnl))) {
        return res.status(400).json({ error: "Invalid potential P&L." });
      }

      const r = await db(
        `INSERT INTO missed_trades(
           user_id, account, symbol, direction, trade_date,
           setup, reason, potential_r, potential_pnl, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          req.user.id,
          String(req.body.account || "").slice(0, 100),
          symbol,
          direction,
          tradeDate,
          String(req.body.setup || "").slice(0, 120),
          String(req.body.reason || "").slice(0, 500),
          potentialR,
          potentialPnl,
          String(req.body.notes || "").slice(0, 2000),
        ]
      );
      res.status(201).json({ missed: r.rows[0] });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not save missed trade." });
    }
  });

  router.delete("/:id", auth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid missed trade ID." });
      }
      const r = await db(
        "DELETE FROM missed_trades WHERE id=$1 AND user_id=$2",
        [id, req.user.id]
      );
      if (!r.rowCount) {
        return res.status(404).json({ error: "Missed trade not found." });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Could not delete missed trade." });
    }
  });

  return router;
}

module.exports = { createMissedRouter };
