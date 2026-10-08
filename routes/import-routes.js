const express = require("express");
const { resolveAccount } = require("../utils/account-match");

/**
 * CSV / bulk ingestion pipeline.
 *
 * Design principles (intelligence readiness):
 * - Ownership: every row is bound to req.user.id
 * - Account integrity: resolve name → accounts.id; set both account
 *   and account_id so analytics and rename stay consistent.
 *   Explicit unknown account names are rejected (not remapped to Main Account).
 * - Archived accounts cannot receive new imports
 * - Historical financial values (P&L, R, risk) are PRESERVED as
 *   supplied — Risk Engine V2 is NOT invoked. Broker exports and
 *   old journals often carry authoritative closed-trade numbers;
 *   recalculating would silently rewrite history.
 * - Soft duplicate detection avoids double-import of the same row
 * - Validation is strict enough for data quality, loose enough that
 *   legitimate historical records are not rejected
 */

const MAX_ROWS = 2000;
const DIRECTIONS = new Set(["BUY", "SELL"]);

function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== "") {
      return row[k];
    }
  }
  return undefined;
}

function createImportRouter({ db, auth, n }) {
  const router = express.Router();

  router.post("/", auth, async (req, res) => {
    try {
      const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
      if (!rows.length) {
        return res.status(400).json({ error: "No CSV rows supplied." });
      }

      const slice = rows.slice(0, MAX_ROWS);
      let imported = 0;
      let skipped = 0;
      let duplicates = 0;
      const errors = [];

      const accountCache = new Map();

      for (let i = 0; i < slice.length; i++) {
        const b = slice[i];
        const rowNum = i + 1;

        try {
          const symbol = String(
            pick(b, "symbol", "Symbol", "ticker", "Ticker") || ""
          )
            .trim()
            .toUpperCase();
          const direction = String(
            pick(b, "direction", "Direction", "side", "Side") || ""
          )
            .trim()
            .toUpperCase();

          if (!symbol || symbol.length > 30) {
            skipped++;
            if (errors.length < 20) {
              errors.push({ row: rowNum, error: "Invalid or missing symbol." });
            }
            continue;
          }
          if (!DIRECTIONS.has(direction)) {
            skipped++;
            if (errors.length < 20) {
              errors.push({
                row: rowNum,
                error: "Direction must be BUY or SELL.",
              });
            }
            continue;
          }

          let acctName = String(
            pick(b, "account", "Account") || "Main Account"
          ).trim();
          if (!acctName) acctName = "Main Account";

          let account = accountCache.get(acctName);
          if (account === undefined) {
            account = await resolveAccount(db, req.user.id, { name: acctName });
            /*
             * Unknown account: reject the row. Do NOT silently reassign
             * to Main Account — that would place trades under the wrong
             * identity and corrupt multi-account intelligence.
             */
            if (!account) {
              skipped++;
              if (errors.length < 20) {
                errors.push({
                  row: rowNum,
                  error: `Unknown account: ${acctName}`,
                });
              }
              accountCache.set(acctName, null);
              continue;
            }
            accountCache.set(acctName, account);
          }
          if (!account) {
            skipped++;
            continue;
          }
          if (account.active === false) {
            skipped++;
            if (errors.length < 20) {
              errors.push({
                row: rowNum,
                error: `Account "${account.name}" is archived. Reactivate it before importing.`,
              });
            }
            continue;
          }

          const entry = n(pick(b, "entry", "Entry"));
          if (!Number.isFinite(entry) || entry <= 0) {
            skipped++;
            if (errors.length < 20) {
              errors.push({ row: rowNum, error: "Invalid entry price." });
            }
            continue;
          }

          const tradeDateRaw = pick(b, "trade_date", "tradeDate", "date", "Date");
          let tradeDate = tradeDateRaw ? new Date(tradeDateRaw) : new Date();
          if (Number.isNaN(tradeDate.getTime())) {
            tradeDate = new Date();
          }
          if (tradeDate.getTime() > Date.now() + 86400000) {
            skipped++;
            if (errors.length < 20) {
              errors.push({ row: rowNum, error: "Trade date is in the future." });
            }
            continue;
          }

          const dayStart = new Date(tradeDate);
          dayStart.setUTCHours(0, 0, 0, 0);
          const dayEnd = new Date(dayStart);
          dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

          const dup = await db(
            `SELECT id FROM trades
             WHERE user_id = $1
               AND symbol = $2
               AND direction = $3
               AND entry = $4
               AND trade_date >= $5
               AND trade_date < $6
             LIMIT 1`,
            [req.user.id, symbol, direction, entry, dayStart, dayEnd]
          );
          if (dup.rowCount) {
            duplicates++;
            continue;
          }

          const stopLoss = n(
            pick(b, "stop_loss", "stopLoss", "SL", "sl"),
            null
          );
          const takeProfit = n(
            pick(b, "take_profit", "takeProfit", "TP", "tp"),
            null
          );
          const exitPrice = n(
            pick(b, "exit_price", "exitPrice", "Exit", "exit"),
            null
          );
          const quantity = n(pick(b, "quantity", "Quantity", "qty", "Qty"), 1);
          const riskAmount = n(pick(b, "risk_amount", "riskAmount"));
          const riskPercent = n(pick(b, "risk_percent", "riskPercent"));
          const profitLoss = n(
            pick(b, "profit_loss", "profitLoss", "pnl", "PnL", "PL")
          );
          const plannedRr = n(pick(b, "planned_rr", "plannedRr", "plannedRR"));
          const actualR = n(pick(b, "actual_r", "actualR", "R"));
          const mfeR = n(pick(b, "mfe_r", "mfeR", "MFE"));
          const maeR = n(pick(b, "mae_r", "maeR", "MAE"));
          const maxFavorable = n(
            pick(b, "max_favorable_price", "maxFavorablePrice"),
            null
          );
          const maxAdverse = n(
            pick(b, "max_adverse_price", "maxAdversePrice"),
            null
          );
          const ruleScore = Math.max(
            0,
            Math.min(100, Math.round(n(pick(b, "rule_score", "ruleScore"))))
          );
          const confidence = Math.max(
            0,
            Math.min(100, Math.round(n(pick(b, "confidence", "Confidence"))))
          );
          let playbookId = pick(b, "playbook_id", "playbookId");
          playbookId =
            playbookId !== undefined && playbookId !== null && playbookId !== ""
              ? Number(playbookId)
              : null;
          if (playbookId !== null && (!Number.isInteger(playbookId) || playbookId <= 0)) {
            playbookId = null;
          }
          if (playbookId !== null) {
            const pb = await db(
              `SELECT id FROM playbooks WHERE id = $1 AND user_id = $2`,
              [playbookId, req.user.id]
            );
            if (!pb.rowCount) playbookId = null;
          }

          await db(
            `INSERT INTO trades(
              user_id, account, account_id, symbol, direction,
              entry, stop_loss, take_profit, exit_price, quantity,
              risk_amount, risk_percent, profit_loss, planned_rr, actual_r,
              mfe_r, mae_r, max_favorable_price, max_adverse_price,
              rule_score, playbook_id, strategy, session, setup,
              entry_reason, exit_reason, emotion_before, emotion_after,
              mistakes, confidence, market_condition, screenshot_data,
              notes, trade_date, source
            ) VALUES (
              $1,$2,$3,$4,$5,
              $6,$7,$8,$9,$10,
              $11,$12,$13,$14,$15,
              $16,$17,$18,$19,
              $20,$21,$22,$23,$24,
              $25,$26,$27,$28,
              $29,$30,$31,$32,
              $33,$34,'csv'
            )`,
            [
              req.user.id,
              account.name,
              account.id,
              symbol,
              direction,
              entry,
              stopLoss,
              takeProfit,
              exitPrice,
              quantity,
              riskAmount,
              riskPercent,
              profitLoss,
              plannedRr,
              actualR,
              mfeR,
              maeR,
              maxFavorable,
              maxAdverse,
              ruleScore,
              playbookId,
              String(pick(b, "strategy", "Strategy") || "").slice(0, 100),
              String(pick(b, "session", "Session") || "").slice(0, 40),
              String(pick(b, "setup", "Setup") || "").slice(0, 120),
              String(pick(b, "entry_reason", "entryReason") || ""),
              String(pick(b, "exit_reason", "exitReason") || ""),
              String(pick(b, "emotion_before", "emotionBefore") || "").slice(0, 50),
              String(pick(b, "emotion_after", "emotionAfter") || "").slice(0, 50),
              String(pick(b, "mistakes", "Mistakes") || ""),
              confidence,
              String(pick(b, "market_condition", "marketCondition") || "").slice(0, 80),
              String(pick(b, "screenshot_data", "screenshotData") || "").slice(0, 4500000),
              String(pick(b, "notes", "Notes") || ""),
              tradeDate,
            ]
          );
          imported++;
        } catch (rowErr) {
          skipped++;
          if (errors.length < 20) {
            errors.push({
              row: rowNum,
              error: rowErr.message || "Row insert failed.",
            });
          }
        }
      }

      res.json({
        imported,
        skipped,
        duplicates,
        received: rows.length,
        processed: slice.length,
        truncated: rows.length > MAX_ROWS,
        errors,
        note:
          "Historical P&L, R, and risk values from CSV are preserved as supplied. Risk Engine V2 is not applied to imports.",
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "CSV import failed." });
    }
  });

  return router;
}

module.exports = { createImportRouter };
