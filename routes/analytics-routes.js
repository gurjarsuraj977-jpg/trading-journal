const express = require("express");
const {
  tradeMatchClauseNoAlias,
  resolveAccount,
} = require("../utils/account-match");

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

      /*
       * Account filter uses the same dual-match as account-routes:
       * trades.account_id = accounts.id OR (account_id IS NULL AND account = name).
       * This keeps Dashboard / Analytics / Account Command Center in agreement
       * after renames and for legacy rows — critical for future intelligence.
       */
      const v = [req.user.id, tz];
      const w = ["user_id=$1"];

      if (accountName) {
        const acc = await resolveAccount(db, req.user.id, { name: accountName });
        if (acc) {
          v.push(acc.id, acc.name);
          w.push(tradeMatchClauseNoAlias(`$${v.length - 1}`, `$${v.length}`));
        } else {
          // Unknown account name → no trades (do not fall back to free-text only)
          v.push(accountName);
          w.push(`account=$${v.length} AND account_id IS NULL`);
        }
      }

      if (from) {
        v.push(from);
        w.push(`timezone($2,trade_date)::date >= $${v.length}::date`);
      }
      if (to) {
        v.push(to);
        w.push(`timezone($2,trade_date)::date <= $${v.length}::date`);
      }

      const where = w.join(" AND ");
      const baseParams = [...v];

      const summary = await db(
        `SELECT COUNT(*)::int total,
                COUNT(*) FILTER(WHERE profit_loss>0)::int wins,
                COUNT(*) FILTER(WHERE profit_loss<0)::int losses,
                COALESCE(SUM(profit_loss),0)::numeric pnl,
                COALESCE(SUM(profit_loss) FILTER(WHERE profit_loss>0),0)::numeric gp,
                ABS(COALESCE(SUM(profit_loss) FILTER(WHERE profit_loss<0),0))::numeric gl,
                COALESCE(AVG(actual_r),0)::numeric avgr,
                COALESCE(AVG(profit_loss) FILTER(WHERE profit_loss>0),0)::numeric aw,
                COALESCE(AVG(profit_loss) FILTER(WHERE profit_loss<0),0)::numeric al,
                COALESCE(AVG(risk_percent),0)::numeric ar
         FROM trades WHERE ${where}`,
        baseParams
      );

      const s = summary.rows[0];
      const t = Number(s.total);
      const wins = Number(s.wins);
      const losses = Number(s.losses);
      const gl = Number(s.gl);
      const gp = Number(s.gp);
      const al = Math.abs(Number(s.al));
      const aw = Number(s.aw);
      const exp = t ? (wins / t) * aw - (losses / t) * al : 0;

      const profitFactorInfinite = gl === 0 && gp > 0;
      const profitFactor = gl ? gp / gl : 0;

      const balanceQuery = accountName
        ? await db(
            "SELECT COALESCE(starting_balance,0)::numeric starting_balance FROM accounts WHERE user_id=$1 AND name=$2",
            [req.user.id, accountName]
          )
        : await db(
            "SELECT COALESCE(SUM(starting_balance),0)::numeric starting_balance FROM accounts WHERE user_id=$1",
            [req.user.id]
          );
      const startingBalance = Number(
        balanceQuery.rows[0]?.starting_balance || 0
      );

      const make = (sql, extra = []) => db(sql, [...baseParams, ...extra]);
      const [sym, strat, sess, dir, days, curve] = await Promise.all([
        make(
          `SELECT symbol,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY symbol ORDER BY pnl DESC`
        ),
        make(
          `SELECT COALESCE(strategy,'Unspecified') strategy,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY strategy ORDER BY pnl DESC`
        ),
        make(
          `SELECT COALESCE(session,'Unspecified') session,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY session ORDER BY pnl DESC`
        ),
        make(
          `SELECT direction,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY direction ORDER BY direction`
        ),
        make(
          `SELECT timezone($2,trade_date)::date AS day,COALESCE(SUM(profit_loss),0)::numeric AS pnl,COUNT(*)::int AS trades FROM trades WHERE ${where} GROUP BY timezone($2,trade_date)::date ORDER BY day`
        ),
        make(
          `SELECT profit_loss,trade_date FROM trades WHERE ${where} ORDER BY trade_date,id`
        ),
      ]);

      let eq = 0,
        peak = 0,
        dd = 0,
        ws = 0,
        ls = 0,
        bw = 0,
        bl = 0;
      curve.rows.forEach((x) => {
        const p = Number(x.profit_loss);
        eq += p;
        peak = Math.max(peak, eq);
        dd = Math.min(dd, eq - peak);
        if (p > 0) {
          ws++;
          ls = 0;
          bw = Math.max(bw, ws);
        } else if (p < 0) {
          ls++;
          ws = 0;
          bl = Math.max(bl, ls);
        }
      });

      res.json({
        summary: {
          total: t,
          wins,
          losses,
          pnl: Number(s.pnl),
          startingBalance,
          currentEquity: startingBalance + Number(s.pnl),
          winRate: t ? (wins / t) * 100 : 0,
          profitFactor,
          profitFactorInfinite,
          avgWin: aw,
          avgLoss: al,
          avgR: Number(s.avgr),
          avgRisk: Number(s.ar),
          expectancy: exp,
          maxDrawdown: Math.abs(dd),
          bestWinStreak: bw,
          bestLossStreak: bl,
        },
        bySymbol: sym.rows,
        byStrategy: strat.rows,
        bySession: sess.rows,
        byDirection: dir.rows,
        byDay: days.rows,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Analytics failed." });
    }
  });

  return router;
}

module.exports = { createAnalyticsRouter };
