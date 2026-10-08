const express = require("express");
const { getMetrics } = require("../metrics/service");
const { buildTradeFilters } = require("../metrics/query-builder");

/**
 * Reports / Insights — summary metrics via Unified Metrics Service.
 * Process flags and coach text still need individual trade rows for
 * rule-based review; those use a capped projection (not full recalculation
 * of win rate / PF / expectancy).
 */
function createPremiumRouter({ db, auth, fields }) {
  const router = express.Router();

  router.get("/", auth, async (req, res) => {
    try {
      const accountName = String(req.query.account || "").trim();
      const range = String(req.query.range || "all");
      const tz = String(req.query.tz || "UTC").trim() || "UTC";

      /*
       * Unified Metrics date contract:
       *   from/to = inclusive local calendar dates in tz
       * Prefer explicit from/to when provided; otherwise derive from
       * range using the same local-calendar idea (not server-local wall clock).
       */
      let from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || ""))
        ? String(req.query.from)
        : "";
      let to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || ""))
        ? String(req.query.to)
        : "";

      if (!from && range !== "all") {
        // Derive "from" as YYYY-MM-DD in the requested timezone via
        // Intl parts (not Date#toISOString UTC).
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date());
        const y = Number(parts.find((p) => p.type === "year").value);
        const mo = Number(parts.find((p) => p.type === "month").value);
        const da = Number(parts.find((p) => p.type === "day").value);
        let fy = y, fm = mo, fd = 1;
        if (range === "month") {
          /* first day of current local month */
        } else if (range === "3m") {
          fm -= 2;
          while (fm < 1) { fm += 12; fy -= 1; }
        } else if (range === "6m") {
          fm -= 5;
          while (fm < 1) { fm += 12; fy -= 1; }
        } else {
          /* year */
          fy -= 1;
          fm = mo;
          fd = da;
        }
        from = `${fy}-${String(fm).padStart(2, "0")}-${String(fd).padStart(2, "0")}`;
      }

      const m = await getMetrics(db, {
        userId: req.user.id,
        accountName: accountName || undefined,
        from: from || undefined,
        to: to || undefined,
        tz,
        includeBreakdowns: true,
        includeCurve: true,
      });

      const edge = (arr) =>
        (arr || [])
          .filter((x) => Number(x.trades) >= 3)
          .map((x) => ({
            name: x.name,
            trades: Number(x.trades),
            pnl: Number(x.pnl),
            winRate: 0,
            profitFactor: 0,
            avgR: 0,
          }))
          .sort((a, b) => b.pnl - a.pnl);

      const b = m.breakdowns || {};
      const symbols = edge(b.bySymbol);
      const strategies = edge(b.byStrategy);
      const setups = edge(b.bySetup);
      const sessions = edge(b.bySession);

      // Process flags need individual rows — capped projection only
      const filter = await buildTradeFilters(db, {
        userId: req.user.id,
        accountName: accountName || undefined,
        from: from || undefined,
        to: to || undefined,
        tz,
      });
      const rowR = await db(
        `SELECT id, symbol, profit_loss, trade_date, risk_percent,
                stop_loss, take_profit, confidence, mistakes, actual_r,
                emotion_before, emotion_after, market_condition
         FROM trades WHERE ${filter.where}
         ORDER BY trade_date ASC, id ASC
         LIMIT 2000`,
        filter.params
      );
      const rows = rowR.rows.map((x) => ({
        id: x.id,
        symbol: x.symbol,
        pnl: Number(x.profit_loss || 0),
        r: Number(x.actual_r || 0),
        risk: Number(x.risk_percent || 0),
        conf: Number(x.confidence || 0),
        trade_date: x.trade_date,
        stop_loss: x.stop_loss,
        take_profit: x.take_profit,
        mistakes: x.mistakes,
        emotion_before: x.emotion_before,
        emotion_after: x.emotion_after,
        market_condition: x.market_condition,
      }));

      const avgRisk = m.avgRiskPercent;
      const riskOutliers = avgRisk
        ? rows.filter((x) => x.risk > avgRisk * 1.5).length
        : 0;

      const processFlags = rows
        .map((x) => ({
          id: x.id,
          symbol: x.symbol,
          pnl: x.pnl,
          date: x.trade_date,
          reasons: [
            x.risk > avgRisk * 1.5 && avgRisk > 0
              ? "Risk above your average"
              : null,
            !x.stop_loss ? "No stop loss recorded" : null,
            !x.take_profit ? "No take profit recorded" : null,
            x.conf > 0 && x.conf < 40 ? "Low confidence" : null,
            x.mistakes ? "Mistake logged" : null,
          ].filter(Boolean),
        }))
        .filter((x) => x.reasons.length);

      const coach = [];
      if (m.tradeCount) {
        const best = [...symbols, ...strategies, ...setups]
          .filter((x) => x.trades >= 5)
          .sort((a, b) => b.pnl - a.pnl)[0];
        const worst = [...symbols, ...strategies, ...setups]
          .filter((x) => x.trades >= 5)
          .sort((a, b) => a.pnl - b.pnl)[0];
        if (best)
          coach.push({
            type: "EDGE",
            title: `Strongest edge: ${best.name}`,
            body: `${best.trades} trades · ${best.pnl.toFixed(2)} P&L.`,
          });
        if (worst && worst.pnl < 0)
          coach.push({
            type: "LEAK",
            title: `Biggest performance leak is ${worst.name}`,
            body: `${worst.trades} trades · ${worst.pnl.toFixed(2)} P&L.`,
          });
        if (riskOutliers)
          coach.push({
            type: "RISK",
            title: `${riskOutliers} trades were risk outliers`,
            body: `They used more than 1.5× your average recorded risk.`,
          });
        if (m.bestLossStreak >= 3)
          coach.push({
            type: "DISCIPLINE",
            title: `Your worst losing streak is ${m.bestLossStreak}`,
            body: `Consider a hard daily stop after consecutive losses.`,
          });
        if (processFlags.length)
          coach.push({
            type: "PROCESS",
            title: `${processFlags.length} trades have process flags`,
            body: `Review missing protection, low confidence, and mistakes.`,
          });
      }

      const now = new Date();
      const monday = new Date(now);
      const day = monday.getDay();
      const diff = (day + 6) % 7;
      monday.setDate(monday.getDate() - diff);
      monday.setHours(0, 0, 0, 0);
      const weekRows = rows.filter((x) => new Date(x.trade_date) >= monday);
      const prevStart = new Date(monday);
      prevStart.setDate(prevStart.getDate() - 7);
      const prevRows = rows.filter((x) => {
        const d = new Date(x.trade_date);
        return d >= prevStart && d < monday;
      });
      const stats = (a) => {
        const pnl = a.reduce((z, x) => z + x.pnl, 0);
        const wins = a.filter((x) => x.pnl > 0).length;
        const losses = a.filter((x) => x.pnl < 0).length;
        return {
          trades: a.length,
          pnl,
          winRate:
            wins + losses ? (wins / (wins + losses)) * 100 : 0,
          avgR: a.length ? a.reduce((z, x) => z + x.r, 0) / a.length : 0,
        };
      };

      const emotions = (() => {
        const map = new Map();
        for (const x of rows) {
          const k = String(x.emotion_before || x.emotion_after || "Unspecified");
          if (!map.has(k)) map.set(k, []);
          map.get(k).push(x);
        }
        return [...map].map(([name, a]) => ({
          name,
          trades: a.length,
          pnl: a.reduce((z, x) => z + x.pnl, 0),
          winRate: (() => {
            const w = a.filter((x) => x.pnl > 0).length;
            const l = a.filter((x) => x.pnl < 0).length;
            return w + l ? (w / (w + l)) * 100 : 0;
          })(),
        })).sort((a, b) => b.trades - a.trades);
      })();

      const confidence = [
        { label: "0-20", min: 0, max: 20 },
        { label: "21-40", min: 21, max: 40 },
        { label: "41-60", min: 41, max: 60 },
        { label: "61-80", min: 61, max: 80 },
        { label: "81-100", min: 81, max: 100 },
      ]
        .map((g) => {
          const a = rows.filter((x) => x.conf >= g.min && x.conf <= g.max);
          const w = a.filter((x) => x.pnl > 0).length;
          const l = a.filter((x) => x.pnl < 0).length;
          return {
            ...g,
            trades: a.length,
            pnl: a.reduce((z, x) => z + x.pnl, 0),
            winRate: w + l ? (w / (w + l)) * 100 : 0,
            avgR: a.length ? a.reduce((z, x) => z + x.r, 0) / a.length : 0,
          };
        })
        .filter((x) => x.trades);

      const markets = edge(
        (() => {
          const map = new Map();
          for (const x of rows) {
            const k = String(x.market_condition || "Unspecified");
            if (!map.has(k)) map.set(k, { name: k, trades: 0, pnl: 0 });
            const o = map.get(k);
            o.trades++;
            o.pnl += x.pnl;
          }
          return [...map.values()];
        })()
      );

      res.json({
        edge: { symbols, strategies, setups, sessions, markets },
        psychology: { emotions, confidence },
        risk: {
          avgRisk: m.avgRiskPercent,
          maxDrawdown: m.maxDrawdown,
          riskOutliers,
          bestLossStreak: m.bestLossStreak,
          bestWinStreak: m.bestWinStreak,
        },
        summary: {
          tradeCount: m.tradeCount,
          wins: m.wins,
          losses: m.losses,
          breakeven: m.breakeven,
          winRate: m.winRate,
          pnl: m.pnl,
          expectancy: m.expectancy,
          profitFactor: m.profitFactor,
          profitFactorInfinite: m.profitFactorInfinite,
          avgR: m.avgR,
        },
        processFlags: processFlags.slice(-30).reverse(),
        coach,
        weekly: { current: stats(weekRows), previous: stats(prevRows) },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Premium analytics failed." });
    }
  });

  return router;
}

module.exports = { createPremiumRouter };
