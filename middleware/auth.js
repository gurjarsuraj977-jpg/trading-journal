const jwt = require("jsonwebtoken");

/**
 * GhostTrader auth middleware.
 *
 * Flow:
 *   JWT verify → load user from DB → token_version check → status check
 *   → attach DB-backed role/status to req.user
 *
 * Role/status in the JWT are never trusted. The database is source of truth.
 * Banned users are rejected even with a still-valid signed cookie.
 * Pending users may call /api/auth/* only; all other /api/* routes return 403.
 */
module.exports = ({ SECRET, db }) => {
  return async function auth(req, res, next) {
    const t = req.cookies.gt_token;
    if (!t) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const payload = jwt.verify(t, SECRET);
      const userId = Number(payload.id);

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(401).json({ error: "Session expired" });
      }

      const r = await db(
        `SELECT id, name, email, role, status, token_version
         FROM users
         WHERE id = $1`,
        [userId]
      );

      if (!r.rowCount) {
        return res.status(401).json({ error: "Session expired" });
      }

      const u = r.rows[0];
      const dbVersion = Number(u.token_version || 0);
      const tokenVersion = Number(payload.token_version || 0);

      if (dbVersion !== tokenVersion) {
        return res.status(401).json({ error: "Session expired" });
      }

      const role = u.role === "admin" ? "admin" : "user";
      const status = ["pending", "active", "banned"].includes(u.status)
        ? u.status
        : "active";

      if (status === "banned") {
        return res.status(403).json({
          error:
            "Your account is currently unavailable. Please contact support.",
          status: "banned",
        });
      }

      req.user = {
        id: u.id,
        name: u.name,
        email: u.email,
        role,
        status,
      };

      // Pending accounts may only use auth endpoints (me / logout).
      // This protects journal, analytics, TradeLocker, MT5, etc. without
      // modifying those route modules.
      if (status === "pending") {
        const url = String(req.originalUrl || req.url || "");
        const authOnly =
          url.startsWith("/api/auth/") || url === "/api/auth";
        if (!authOnly) {
          return res.status(403).json({
            error:
              "Your GhostTrader account is pending approval. An administrator needs to approve your account before you can access the journal.",
            status: "pending",
          });
        }
      }

      // Touch last_activity_at opportunistically (best-effort, non-blocking).
      db(
        `UPDATE users SET last_activity_at = NOW() WHERE id = $1`,
        [u.id]
      ).catch(() => {});

      next();
    } catch {
      return res.status(401).json({ error: "Session expired" });
    }
  };
};
