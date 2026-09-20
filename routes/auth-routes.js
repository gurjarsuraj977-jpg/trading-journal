const express = require("express");

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    status: ["pending", "active", "banned"].includes(row.status)
      ? row.status
      : "active",
  };
}

/**
 * Apply INITIAL_ADMIN_EMAIL bootstrap for a matching user (server-side only).
 */
async function maybeBootstrapAdmin(db, userRow) {
  const bootstrap = String(process.env.INITIAL_ADMIN_EMAIL || "")
    .trim()
    .toLowerCase();
  if (!bootstrap) return userRow;
  if (String(userRow.email || "").toLowerCase() !== bootstrap) return userRow;

  if (userRow.role === "admin" && userRow.status === "active") {
    return userRow;
  }

  const r = await db(
    `
    UPDATE users
    SET role = 'admin',
        status = 'active',
        approved_at = COALESCE(approved_at, NOW()),
        token_version = token_version + 1
    WHERE id = $1
    RETURNING id, name, email, role, status, token_version
    `,
    [userRow.id]
  );
  return r.rows[0] || userRow;
}

function createAuthRouter({ db, bcrypt, token, setCookie, auth }) {
  const router = express.Router();

  router.post("/register", async (req, res) => {
    try {
      const name = String(req.body.name || "").trim();
      const email = String(req.body.email || "").trim().toLowerCase();
      const pw = String(req.body.password || "");

      if (name.length < 2 || !email.includes("@") || pw.length < 6) {
        return res.status(400).json({
          error: "Name, valid email and 6+ character password required.",
        });
      }

      if ((await db("SELECT id FROM users WHERE email = $1", [email])).rowCount) {
        return res.status(409).json({ error: "Email already registered." });
      }

      // New registrations are pending until an administrator approves them.
      // Existing users keep status=active via column default.
      const hash = await bcrypt.hash(pw, 12);
      let r = await db(
        `
        INSERT INTO users (name, email, password_hash, role, status)
        VALUES ($1, $2, $3, 'user', 'pending')
        RETURNING id, name, email, role, status, token_version
        `,
        [name, email, hash]
      );

      await db(
        `INSERT INTO accounts (user_id, name) VALUES ($1, 'Main Account')`,
        [r.rows[0].id]
      );

      // Optional bootstrap: if this email matches INITIAL_ADMIN_EMAIL, promote.
      const user = await maybeBootstrapAdmin(db, r.rows[0]);

      setCookie(res, token(user));
      res.json({
        user: publicUser(user),
        message:
          user.status === "pending"
            ? "Account created. An administrator must approve access before you can use the journal."
            : undefined,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Registration failed." });
    }
  });

  router.post("/login", async (req, res) => {
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const pw = String(req.body.password || "");

      const r = await db(
        `SELECT id, name, email, password_hash, role, status, token_version
         FROM users WHERE email = $1`,
        [email]
      );

      if (!r.rowCount || !(await bcrypt.compare(pw, r.rows[0].password_hash))) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      let row = r.rows[0];

      if (row.status === "banned") {
        return res.status(403).json({
          error:
            "Your account is currently unavailable. Please contact support.",
          status: "banned",
        });
      }

      row = await maybeBootstrapAdmin(db, row);

      // Update last_login_at for successful (non-banned) authentication.
      await db(
        `UPDATE users SET last_login_at = NOW(), last_activity_at = NOW() WHERE id = $1`,
        [row.id]
      );

      // Re-read token_version in case bootstrap incremented it.
      const fresh = await db(
        `SELECT id, name, email, role, status, token_version FROM users WHERE id = $1`,
        [row.id]
      );
      const user = fresh.rows[0] || row;

      setCookie(res, token(user));
      res.json({
        user: publicUser(user),
        message:
          user.status === "pending"
            ? "Your account is pending administrator approval."
            : undefined,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Login failed." });
    }
  });

  router.post("/logout", (req, res) => {
    res.clearCookie("gt_token");
    res.json({ ok: true });
  });

  // /me uses auth middleware: returns DB-backed id/name/email/role/status.
  // Never returns password_hash or token_version.
  router.get("/me", auth, (req, res) => {
    res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        status: req.user.status,
      },
    });
  });

  return router;
}

module.exports = { createAuthRouter };
