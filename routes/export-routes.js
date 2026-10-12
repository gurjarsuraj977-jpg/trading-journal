const express = require("express");

/**
 * Batch E — CSV export integrity.
 * - Exclude screenshot blobs (unbounded memory / useless in spreadsheets)
 * - Neutralize spreadsheet formula injection on user-controlled text
 * - Properly quote all fields
 * - Bound export size
 */
function createExportRouter({ db, auth, fields }) {
  const router = express.Router();

  const exportCols = String(fields || "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c && c !== "screenshot_data");

  function csvCell(value) {
    let s = value === null || value === undefined ? "" : String(value);
    // Formula injection: leading = + - @ | tab/CR can trigger spreadsheet formulas
    if (/^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    return `"${s.replace(/"/g, '""')}"`;
  }

  router.get("/export.csv", auth, async (req, res) => {
    try {
      const r = await db(
        `SELECT ${exportCols.join(",")} FROM trades WHERE user_id=$1 ORDER BY trade_date DESC LIMIT 10000`,
        [req.user.id]
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="ghosttrader-trades.csv"'
      );
      const lines = [
        exportCols.join(","),
        ...r.rows.map((row) =>
          exportCols.map((c) => csvCell(row[c])).join(",")
        ),
      ];
      res.send(lines.join("\n"));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not export trades." });
    }
  });

  return router;
}

module.exports = { createExportRouter };
