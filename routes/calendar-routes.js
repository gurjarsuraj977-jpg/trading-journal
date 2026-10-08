const express = require("express");
const {
  tradeMatchClauseNoAlias,
  resolveAccount,
} = require("../utils/account-match");

function createCalendarRouter({ db, auth }) {
  const router = express.Router();

  router.get("/", auth, async (req, res) => {
    try {
      const m = String(req.query.month || "");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) {
        return res.status(400).json({ error: "Invalid month." });
      }
      const tz = String(req.query.tz || "UTC");
      const accountName = String(req.query.account || "").trim();

      /*
       * Optional account filter — same dual-match as analytics/accounts
       * so calendar day totals agree with dashboard for the same account.
       * Archived accounts' historical trades still appear when selected
       * or when viewing All accounts.
       */
      const v = [req.user.id, m, tz];
      const w = [
        "user_id=$1",
        "trade_date >= timezone($3,(($2||'-01')::date::timestamp))",
        "trade_date < timezone($3,((($2||'-01')::date + INTERVAL '1 month')::timestamp))",
      ];

      if (accountName) {
        const acc = await resolveAccount(db, req.user.id, { name: accountName });
        if (acc) {
          v.push(acc.id, acc.name);
          w.push(tradeMatchClauseNoAlias(`$${v.length - 1}`, `$${v.length}`));
        } else {
          v.push(accountName);
          w.push(`account=$${v.length} AND account_id IS NULL`);
        }
      }

      const r = await db(
        `SELECT timezone($3,trade_date)::date AS day,
                COUNT(*)::int AS trades,
                COALESCE(SUM(profit_loss),0)::numeric AS pnl
         FROM trades WHERE ${w.join(" AND ")}
         GROUP BY timezone($3,trade_date)::date ORDER BY day`,
        v
      );
      res.json({ days: r.rows });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Calendar failed." });
    }
  });

  return router;
}

module.exports = { createCalendarRouter };
