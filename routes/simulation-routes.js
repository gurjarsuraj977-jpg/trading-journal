const express = require("express");
const { buildTradeFilters } = require("../metrics/query-builder");
const { simulateTradeOutcome } = require("../utils/simulate-outcome");

/**
 * Strategy Simulator — response-only hypotheticals from live journal MFE/MAE.
 * Does NOT write results into trades. Does NOT affect live metrics.
 *
 * See utils/simulate-outcome.js for MAE/MFE convention and dual-hit policy.
 */

function createSimulationRouter({ db, auth, n }) {
  const router = express.Router();

  router.post("/api/simulate", auth, async (req, res) => {
    try {
      const accountName = String(req.body.account || "").trim();
      const filter = await buildTradeFilters(db, {
        userId: req.user.id,
        accountName: accountName || undefined,
        tz: "UTC",
      });

      const clauses = [filter.where];
      const params = [...filter.params];
      if (req.body.symbol) {
        params.push(String(req.body.symbol).trim().toUpperCase());
        clauses.push(`symbol = $${params.length}`);
      }

      const rows = (
        await db(
          `SELECT actual_r, mfe_r, mae_r, profit_loss, risk_amount
           FROM trades WHERE ${clauses.join(" AND ")}
           ORDER BY trade_date`,
          params
        )
      ).rows;

      const target = Math.abs(n(req.body.targetR, 2));
      const stopAbs = Math.abs(n(req.body.stopR, 1));
      let pnlR = 0;
      let wins = 0;
      let losses = 0;
      let usable = 0;
      let bothHits = 0;

      for (const x of rows) {
        const outcome = simulateTradeOutcome(x, target, stopAbs);
        if (!outcome.usable) continue;
        usable++;
        if (outcome.reason === "both_conservative_stop") bothHits++;
        const rr = outcome.rr;
        wins += rr > 0 ? 1 : 0;
        losses += rr < 0 ? 1 : 0;
        pnlR += rr;
      }

      res.json({
        trades: rows.length,
        usable,
        wins,
        losses,
        targetR: target,
        stopR: -stopAbs,
        simulatedR: pnlR,
        winRate: usable ? (wins / usable) * 100 : 0,
        avgR: usable ? pnlR / usable : 0,
        bothHitsConservative: bothHits,
        note:
          "Simulation is response-only and does not alter live journal metrics. MFE/MAE are non-negative R magnitudes. When both target and stop extremes are met, the stop is assumed (conservative; intrabar order unknown).",
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Simulation failed." });
    }
  });

  /**
   * Persist a named simulation scenario.
   * Frontend (public/js/simulation.js) always POSTs here after a successful
   * /api/simulate. Missing this route caused production "Request failed"
   * (404 with no error body → api.js generic message).
   */
  router.post("/api/backtests", auth, async (req, res) => {
    try {
      const name =
        String(req.body.name || "").trim() || "Untitled scenario";
      const symbol = String(req.body.symbol || "").trim() || null;
      const targetR = Math.abs(n(req.body.targetR, 2));
      const stopR = Math.abs(n(req.body.stopR, 1));

      const r = await db(
        `INSERT INTO backtests (user_id, name, symbol, target_r, stop_r)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, symbol, target_r, stop_r, created_at`,
        [req.user.id, name, symbol, targetR, stopR]
      );

      res.status(201).json({ ok: true, backtest: r.rows[0] });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not save scenario." });
    }
  });

  return router;
}

module.exports = { createSimulationRouter, simulateTradeOutcome };
