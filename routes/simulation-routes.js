const express = require("express");
const { buildTradeFilters } = require("../metrics/query-builder");

/**
 * Strategy Simulator — response-only hypotheticals from live journal MFE/MAE.
 * Does NOT write results into trades. Does NOT affect live metrics.
 *
 * Also provides POST /api/backtests so Simulation Lab can persist a scenario
 * name after a successful run (table already exists in db/init.js).
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

      const target = n(req.body.targetR, 2);
      const stop = -Math.abs(n(req.body.stopR, 1));
      let pnlR = 0;
      let wins = 0;
      let losses = 0;
      let usable = 0;

      for (const x of rows) {
        const mfe = n(x.mfe_r);
        const mae = n(x.mae_r);
        if (!mfe && !mae) continue;
        usable++;
        let rr = n(x.actual_r);
        if (mfe >= target) rr = target;
        else if (mae <= stop) rr = stop;
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
        stopR: stop,
        simulatedR: pnlR,
        winRate: usable ? (wins / usable) * 100 : 0,
        avgR: usable ? pnlR / usable : 0,
        note: "Simulation is response-only and does not alter live journal metrics.",
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
      const targetR = n(req.body.targetR, 2);
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

module.exports = { createSimulationRouter };
