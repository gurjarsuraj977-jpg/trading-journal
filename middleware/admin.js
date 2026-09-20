/**
 * requireAdmin — GhostTrader Admin Control Center.
 *
 * Must run AFTER the auth middleware. Enforces:
 *   authenticated user AND role === 'admin' AND status === 'active'
 *
 * Frontend hiding is not security. Every /api/admin/* route uses this.
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (req.user.role !== "admin" || req.user.status !== "active") {
    return res.status(403).json({ error: "Administrator access required." });
  }

  next();
}

module.exports = { requireAdmin };
