const express = require("express");
const {
  getBehaviorBaseline,
  getBehaviorSignals,
  getBehaviorPatterns,
} = require("../behavior/service");

/**
 * Behavioral Intelligence routes.
 * Batch 2: baseline
 * Batch 3: signals + patterns
 */
function createBehaviorRouter({ db, auth }) {
  const router = express.Router();

  function parseFilterQuery(req) {
    const accountName = String(req.query.account || "").trim();
    const accountId =
      req.query.accountId != null && Number(req.query.accountId) > 0
        ? Number(req.query.accountId)
        : undefined;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || ""))
      ? String(req.query.from)
      : undefined;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || ""))
      ? String(req.query.to)
      : undefined;
    const tz = String(req.query.tz || "UTC").trim() || "UTC";
    const source = String(req.query.source || "all");
    return {
      userId: req.user.id,
      accountId,
      accountName: accountName || undefined,
      from,
      to,
      tz,
      source,
    };
  }

  router.get("/baseline", auth, async (req, res) => {
    try {
      const baseline = await getBehaviorBaseline(db, parseFilterQuery(req));
      res.json({ ok: true, baseline });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "Baseline unavailable." });
    }
  });

  router.get("/signals", auth, async (req, res) => {
    try {
      const signals = await getBehaviorSignals(db, parseFilterQuery(req));
      res.json({ ok: true, signals });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "Signals unavailable." });
    }
  });

  router.get("/patterns", auth, async (req, res) => {
    try {
      const patterns = await getBehaviorPatterns(db, parseFilterQuery(req));
      res.json({ ok: true, patterns });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: "Patterns unavailable." });
    }
  });

  return router;
}

module.exports = { createBehaviorRouter };
