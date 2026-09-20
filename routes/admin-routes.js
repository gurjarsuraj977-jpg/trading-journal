const express = require("express");
const { requireAdmin } = require("../middleware/admin");

const SAFE_SORT = {
  created_at: "u.created_at",
  name: "u.name",
  email: "u.email",
  last_login_at: "u.last_login_at",
  status: "u.status",
  role: "u.role",
};

function clientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    return xf.split(",")[0].trim().slice(0, 64);
  }
  return String(req.ip || req.socket?.remoteAddress || "").slice(0, 64) || null;
}

async function writeAudit(db, {
  adminUserId,
  targetUserId = null,
  action,
  reason = null,
  metadata = null,
  ip = null,
}) {
  await db(
    `INSERT INTO admin_audit_log
      (admin_user_id, target_user_id, action, reason, metadata, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      adminUserId,
      targetUserId,
      action,
      reason,
      metadata ? JSON.stringify(metadata) : null,
      ip,
    ]
  );
}

async function countActiveAdmins(db) {
  const r = await db(
    `SELECT COUNT(*)::int AS c
     FROM users
     WHERE role = 'admin' AND status = 'active'`
  );
  return Number(r.rows[0]?.c || 0);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
    last_activity_at: row.last_activity_at || null,
    approved_at: row.approved_at || null,
    approved_by: row.approved_by || null,
    banned_at: row.banned_at || null,
    banned_by: row.banned_by || null,
    ban_reason: row.ban_reason || null,
    account_count: Number(row.account_count || 0),
    trade_count: Number(row.trade_count || 0),
  };
}

function createAdminRouter({ db, auth }) {
  const router = express.Router();
  router.use(auth, requireAdmin);

  // ── Stats ──────────────────────────────────────────────────────────────
  router.get("/stats", async (req, res) => {
    try {
      const [totals, recent] = await Promise.all([
        db(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'banned')::int AS banned,
            COUNT(*) FILTER (WHERE role = 'admin' AND status = 'active')::int AS admins,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS new_today,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_week,
            COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS new_month
          FROM users
        `),
        db(`
          SELECT id, name, email, role, status, created_at
          FROM users
          ORDER BY created_at DESC
          LIMIT 8
        `),
      ]);

      const recentActions = await db(`
        SELECT a.id, a.action, a.reason, a.created_at, a.target_user_id,
               admin_u.name AS admin_name,
               target_u.name AS target_name,
               target_u.email AS target_email
        FROM admin_audit_log a
        LEFT JOIN users admin_u ON admin_u.id = a.admin_user_id
        LEFT JOIN users target_u ON target_u.id = a.target_user_id
        ORDER BY a.created_at DESC
        LIMIT 10
      `);

      res.json({
        stats: totals.rows[0],
        recentRegistrations: recent.rows,
        recentActions: recentActions.rows,
      });
    } catch (e) {
      console.error("Admin stats error:", e);
      res.status(500).json({ error: "Could not load admin stats." });
    }
  });

  // ── User list ──────────────────────────────────────────────────────────
  router.get("/users", async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const status = String(req.query.status || "").trim();
      const role = String(req.query.role || "").trim();
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const offset = (page - 1) * limit;
      const sortKey = String(req.query.sort || "created_at").trim();
      const sortCol = SAFE_SORT[sortKey] || SAFE_SORT.created_at;
      const sortDir = String(req.query.dir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

      const params = [];
      const where = [];

      if (q) {
        params.push("%" + q + "%");
        where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
      }
      if (["pending", "active", "banned"].includes(status)) {
        params.push(status);
        where.push(`u.status = $${params.length}`);
      }
      if (["user", "admin"].includes(role)) {
        params.push(role);
        where.push(`u.role = $${params.length}`);
      }

      const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

      const countR = await db(
        `SELECT COUNT(*)::int AS total FROM users u ${whereSql}`,
        params
      );
      const total = Number(countR.rows[0]?.total || 0);

      const listParams = params.concat([limit, offset]);
      const listR = await db(
        `
        SELECT
          u.id, u.name, u.email, u.role, u.status,
          u.created_at, u.last_login_at, u.last_activity_at,
          u.approved_at, u.approved_by, u.banned_at, u.banned_by, u.ban_reason,
          (SELECT COUNT(*)::int FROM accounts a WHERE a.user_id = u.id) AS account_count,
          (SELECT COUNT(*)::int FROM trades t WHERE t.user_id = u.id) AS trade_count
        FROM users u
        ${whereSql}
        ORDER BY ${sortCol} ${sortDir} NULLS LAST, u.id DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
        `,
        listParams
      );

      res.json({
        users: listR.rows.map(publicUser),
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (e) {
      console.error("Admin users list error:", e);
      res.status(500).json({ error: "Could not load users." });
    }
  });

  // ── User detail ────────────────────────────────────────────────────────
  router.get("/users/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid user id." });
      }

      const r = await db(
        `
        SELECT
          u.id, u.name, u.email, u.role, u.status,
          u.created_at, u.last_login_at, u.last_activity_at,
          u.approved_at, u.approved_by, u.banned_at, u.banned_by, u.ban_reason,
          (SELECT COUNT(*)::int FROM accounts a WHERE a.user_id = u.id) AS account_count,
          (SELECT COUNT(*)::int FROM trades t WHERE t.user_id = u.id) AS trade_count
        FROM users u
        WHERE u.id = $1
        `,
        [id]
      );

      if (!r.rowCount) {
        return res.status(404).json({ error: "User not found." });
      }

      const accounts = await db(
        `SELECT id, name, currency, starting_balance, active, created_at
         FROM accounts WHERE user_id = $1 ORDER BY created_at`,
        [id]
      );

      const audit = await db(
        `SELECT id, action, reason, created_at, admin_user_id
         FROM admin_audit_log
         WHERE target_user_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [id]
      );

      res.json({
        user: publicUser(r.rows[0]),
        accounts: accounts.rows,
        recentAudit: audit.rows,
      });
    } catch (e) {
      console.error("Admin user detail error:", e);
      res.status(500).json({ error: "Could not load user." });
    }
  });

  // ── Approve ────────────────────────────────────────────────────────────
  router.post("/users/:id/approve", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid user id." });
      }

      const existing = await db(
        `SELECT id, status, role, name, email FROM users WHERE id = $1`,
        [id]
      );
      if (!existing.rowCount) {
        return res.status(404).json({ error: "User not found." });
      }
      if (existing.rows[0].status !== "pending") {
        return res.status(400).json({ error: "Only pending users can be approved." });
      }

      const r = await db(
        `
        UPDATE users
        SET status = 'active',
            approved_at = NOW(),
            approved_by = $2,
            token_version = token_version + 1
        WHERE id = $1 AND status = 'pending'
        RETURNING id, name, email, role, status, created_at, last_login_at,
                  last_activity_at, approved_at, approved_by, banned_at, banned_by, ban_reason
        `,
        [id, req.user.id]
      );

      if (!r.rowCount) {
        return res.status(400).json({ error: "Could not approve user." });
      }

      await writeAudit(db, {
        adminUserId: req.user.id,
        targetUserId: id,
        action: "USER_APPROVED",
        ip: clientIp(req),
        metadata: { email: existing.rows[0].email },
      });

      res.json({ user: publicUser(r.rows[0]) });
    } catch (e) {
      console.error("Admin approve error:", e);
      res.status(500).json({ error: "Could not approve user." });
    }
  });

  // ── Ban ────────────────────────────────────────────────────────────────
  router.post("/users/:id/ban", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid user id." });
      }
      if (id === req.user.id) {
        return res.status(400).json({ error: "You cannot ban your own account." });
      }

      const reason = String(req.body?.reason || "").trim().slice(0, 500) || null;

      const existing = await db(
        `SELECT id, status, role, name, email FROM users WHERE id = $1`,
        [id]
      );
      if (!existing.rowCount) {
        return res.status(404).json({ error: "User not found." });
      }
      if (existing.rows[0].status === "banned") {
        return res.status(400).json({ error: "User is already banned." });
      }

      // Last-admin protection
      if (
        existing.rows[0].role === "admin" &&
        existing.rows[0].status === "active"
      ) {
        const admins = await countActiveAdmins(db);
        if (admins <= 1) {
          return res.status(400).json({
            error: "Cannot ban the last active administrator.",
          });
        }
      }

      const r = await db(
        `
        UPDATE users
        SET status = 'banned',
            banned_at = NOW(),
            banned_by = $2,
            ban_reason = $3,
            token_version = token_version + 1
        WHERE id = $1
        RETURNING id, name, email, role, status, created_at, last_login_at,
                  last_activity_at, approved_at, approved_by, banned_at, banned_by, ban_reason
        `,
        [id, req.user.id, reason]
      );

      await writeAudit(db, {
        adminUserId: req.user.id,
        targetUserId: id,
        action: "USER_BANNED",
        reason,
        ip: clientIp(req),
        metadata: { email: existing.rows[0].email },
      });

      res.json({ user: publicUser(r.rows[0]) });
    } catch (e) {
      console.error("Admin ban error:", e);
      res.status(500).json({ error: "Could not ban user." });
    }
  });

  // ── Unban ──────────────────────────────────────────────────────────────
  router.post("/users/:id/unban", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid user id." });
      }

      const existing = await db(
        `SELECT id, status, email FROM users WHERE id = $1`,
        [id]
      );
      if (!existing.rowCount) {
        return res.status(404).json({ error: "User not found." });
      }
      if (existing.rows[0].status !== "banned") {
        return res.status(400).json({ error: "User is not banned." });
      }

      const r = await db(
        `
        UPDATE users
        SET status = 'active',
            banned_at = NULL,
            banned_by = NULL,
            ban_reason = NULL,
            token_version = token_version + 1
        WHERE id = $1 AND status = 'banned'
        RETURNING id, name, email, role, status, created_at, last_login_at,
                  last_activity_at, approved_at, approved_by, banned_at, banned_by, ban_reason
        `,
        [id]
      );

      await writeAudit(db, {
        adminUserId: req.user.id,
        targetUserId: id,
        action: "USER_UNBANNED",
        ip: clientIp(req),
        metadata: { email: existing.rows[0].email },
      });

      res.json({ user: publicUser(r.rows[0]) });
    } catch (e) {
      console.error("Admin unban error:", e);
      res.status(500).json({ error: "Could not unban user." });
    }
  });

  // ── Role change ────────────────────────────────────────────────────────
  router.post("/users/:id/role", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid user id." });
      }

      const newRole = String(req.body?.role || "").trim();
      if (!["user", "admin"].includes(newRole)) {
        return res.status(400).json({ error: "Role must be 'user' or 'admin'." });
      }

      if (id === req.user.id) {
        return res.status(400).json({ error: "You cannot change your own role." });
      }

      const existing = await db(
        `SELECT id, role, status, email FROM users WHERE id = $1`,
        [id]
      );
      if (!existing.rowCount) {
        return res.status(404).json({ error: "User not found." });
      }

      const current = existing.rows[0];
      if (current.role === newRole) {
        return res.status(400).json({ error: "User already has that role." });
      }

      // Demoting an active admin — protect last admin
      if (
        current.role === "admin" &&
        newRole === "user" &&
        current.status === "active"
      ) {
        const admins = await countActiveAdmins(db);
        if (admins <= 1) {
          return res.status(400).json({
            error: "Cannot remove the last active administrator.",
          });
        }
      }

      // Promoting a banned user to admin is not allowed without unban first
      if (newRole === "admin" && current.status === "banned") {
        return res.status(400).json({
          error: "Unban the user before granting administrator access.",
        });
      }

      const r = await db(
        `
        UPDATE users
        SET role = $2,
            token_version = token_version + 1,
            status = CASE
              WHEN $2 = 'admin' AND status = 'pending' THEN 'active'
              ELSE status
            END,
            approved_at = CASE
              WHEN $2 = 'admin' AND status = 'pending' THEN COALESCE(approved_at, NOW())
              ELSE approved_at
            END,
            approved_by = CASE
              WHEN $2 = 'admin' AND status = 'pending' THEN COALESCE(approved_by, $3)
              ELSE approved_by
            END
        WHERE id = $1
        RETURNING id, name, email, role, status, created_at, last_login_at,
                  last_activity_at, approved_at, approved_by, banned_at, banned_by, ban_reason
        `,
        [id, newRole, req.user.id]
      );

      await writeAudit(db, {
        adminUserId: req.user.id,
        targetUserId: id,
        action: "ROLE_CHANGED",
        ip: clientIp(req),
        metadata: {
          email: current.email,
          from: current.role,
          to: newRole,
        },
      });

      res.json({ user: publicUser(r.rows[0]) });
    } catch (e) {
      console.error("Admin role error:", e);
      res.status(500).json({ error: "Could not change role." });
    }
  });

  // ── Delete ─────────────────────────────────────────────────────────────
  router.delete("/users/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid user id." });
      }
      if (id === req.user.id) {
        return res.status(400).json({ error: "You cannot delete your own account." });
      }

      // Require explicit confirmation from the client
      const confirmed =
        req.body?.confirm === true ||
        req.body?.confirm === "true" ||
        req.query?.confirm === "true";
      if (!confirmed) {
        return res.status(400).json({
          error: "Deletion requires explicit confirmation.",
          code: "CONFIRMATION_REQUIRED",
        });
      }

      const existing = await db(
        `SELECT id, role, status, name, email FROM users WHERE id = $1`,
        [id]
      );
      if (!existing.rowCount) {
        return res.status(404).json({ error: "User not found." });
      }

      const target = existing.rows[0];

      if (target.role === "admin" && target.status === "active") {
        const admins = await countActiveAdmins(db);
        if (admins <= 1) {
          return res.status(400).json({
            error: "Cannot delete the last active administrator.",
          });
        }
      }

      // Write audit BEFORE delete so target_user_id is still meaningful,
      // and so the row survives even after the user is gone.
      await writeAudit(db, {
        adminUserId: req.user.id,
        targetUserId: id,
        action: "USER_DELETED",
        ip: clientIp(req),
        metadata: {
          email: target.email,
          name: target.name,
          role: target.role,
          status: target.status,
        },
      });

      const del = await db(`DELETE FROM users WHERE id = $1 RETURNING id`, [id]);
      if (!del.rowCount) {
        return res.status(404).json({ error: "User not found." });
      }

      res.json({ ok: true, deletedId: id });
    } catch (e) {
      console.error("Admin delete error:", e);
      res.status(500).json({ error: "Could not delete user." });
    }
  });

  // ── Audit log ──────────────────────────────────────────────────────────
  router.get("/audit-log", async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const offset = (page - 1) * limit;
      const action = String(req.query.action || "").trim();

      const params = [];
      const where = [];
      if (action) {
        params.push(action);
        where.push(`a.action = $${params.length}`);
      }
      const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

      const countR = await db(
        `SELECT COUNT(*)::int AS total FROM admin_audit_log a ${whereSql}`,
        params
      );
      const total = Number(countR.rows[0]?.total || 0);

      const listParams = params.concat([limit, offset]);
      const listR = await db(
        `
        SELECT
          a.id, a.admin_user_id, a.target_user_id, a.action,
          a.reason, a.metadata, a.ip_address, a.created_at,
          admin_u.name AS admin_name,
          admin_u.email AS admin_email,
          target_u.name AS target_name,
          target_u.email AS target_email
        FROM admin_audit_log a
        LEFT JOIN users admin_u ON admin_u.id = a.admin_user_id
        LEFT JOIN users target_u ON target_u.id = a.target_user_id
        ${whereSql}
        ORDER BY a.created_at DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
        `,
        listParams
      );

      res.json({
        events: listR.rows,
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      });
    } catch (e) {
      console.error("Admin audit log error:", e);
      res.status(500).json({ error: "Could not load audit log." });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
