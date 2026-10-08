const express = require("express");
const { getMetrics } = require("../metrics/service");

function createAiCoachRouter({ db, auth }) {
  const router = express.Router();

  router.post("/coach", auth, async (req, res) => {
    try {
      const q = String(req.body.question || req.body.q || "").slice(0, 500);
      const m = await getMetrics(db, {
        userId: req.user.id,
        includeCurve: false,
        includeBreakdowns: false,
      });

      // Execution-style MFE/MAE still need a light aggregate
      const em = await db(
        `SELECT COALESCE(AVG(mfe_r),0)::numeric mfe,
                COALESCE(AVG(mae_r),0)::numeric mae,
                COALESCE(AVG(confidence),0)::numeric confidence
         FROM trades WHERE user_id = $1`,
        [req.user.id]
      );
      const e = em.rows[0] || {};

      let local = `You have ${m.tradeCount} recorded trades, ${m.pnl.toFixed(2)} net P&L, ${m.winRate.toFixed(1)}% win rate (${m.wins}W / ${m.losses}L / ${m.breakeven}BE), ${m.avgR.toFixed(2)}R average R, ${m.avgRiskPercent.toFixed(2)}% average risk, ${Number(e.confidence || 0).toFixed(0)} average confidence, ${Number(e.mfe || 0).toFixed(2)}R average MFE and ${Number(e.mae || 0).toFixed(2)}R average MAE. `;
      if (m.avgRiskPercent > 2)
        local +=
          "Your recorded risk is elevated; consider enforcing a hard risk cap. ";
      if (m.avgR < 0)
        local +=
          "Your average R is negative; prioritize setup quality and review losing clusters. ";
      if (Number(e.confidence || 0) < 50)
        local +=
          "Confidence is low on average; compare confidence bands before changing strategy. ";
      if (
        Number(e.mfe || 0) > 0 &&
        m.avgR > 0 &&
        m.avgR / Number(e.mfe) < 0.5
      )
        local +=
          "Your realized R is less than half of average MFE; review exits for premature profit-taking. ";
      if (!m.tradeCount)
        local +=
          "Start logging trades with MFE, MAE, risk, confidence and playbook fields for deeper coaching. ";

      if (process.env.OPENAI_API_KEY) {
        try {
          const r = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
              input: [
                {
                  role: "system",
                  content:
                    "You are Ghost AI, a trading-journal coach. Analyze only the supplied journal statistics. Do not give guaranteed profit claims or personalized financial instructions. Give concise process-focused observations.",
                },
                {
                  role: "user",
                  content: `Journal statistics: ${local}\nQuestion: ${q}`,
                },
              ],
            }),
          });
          const j = await r.json();
          const text = (j.output || [])
            .flatMap((x) => x.content || [])
            .map((x) => x.text || "")
            .filter(Boolean)
            .join("\n");
          if (r.ok && text) return res.json({ answer: text, mode: "openai" });
        } catch (e) {
          console.error("AI provider fallback:", e.message);
        }
      }
      res.json({
        answer: `${local}\n\nQuestion: ${q}\n\nNext action: review the Execution Lab and Edge Finder, then test one rule change at a time.`,
        mode: "local",
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Coach unavailable." });
    }
  });

  return router;
}

module.exports = { createAiCoachRouter };
