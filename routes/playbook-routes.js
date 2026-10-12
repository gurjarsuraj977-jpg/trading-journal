const express = require("express");

/**
 * Playbooks — Batch H atomic updates and partial-field safety.
 */
function createPlaybookRouter({ db, auth, n }) {
  const router = express.Router();
  const { pool } = require("../db/pool");

  async function withTx(fn) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
      throw e;
    } finally {
      client.release();
    }
  }

  router.get("/", auth, async (req, res) => {
    try {
      const p = await db(
        "SELECT * FROM playbooks WHERE user_id=$1 ORDER BY created_at DESC",
        [req.user.id]
      );
      const r = await db(
        `SELECT r.* FROM playbook_rules r
         JOIN playbooks p ON p.id=r.playbook_id
         WHERE p.user_id=$1
         ORDER BY r.playbook_id, r.id`,
        [req.user.id]
      );
      res.json({ playbooks: p.rows, rules: r.rows });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not load playbooks." });
    }
  });

  router.post("/", auth, async (req, res) => {
    try {
      const name = String(req.body.name || "").trim();
      if (name.length < 2 || name.length > 120) {
        return res
          .status(400)
          .json({ error: "Playbook name must be 2-120 characters." });
      }
      const rules = Array.isArray(req.body.rules) ? req.body.rules : [];

      const playbook = await withTx(async (client) => {
        const p = await client.query(
          `INSERT INTO playbooks(user_id,name,description,strategy,risk_limit)
           VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [
            req.user.id,
            name,
            String(req.body.description || ""),
            String(req.body.strategy || ""),
            n(req.body.riskLimit, 1),
          ]
        );
        const pb = p.rows[0];
        for (const x of rules) {
          const label = String(x.label || "").trim();
          if (!label) continue;
          await client.query(
            `INSERT INTO playbook_rules(playbook_id,label,weight,required)
             VALUES($1,$2,$3,$4)`,
            [
              pb.id,
              label.slice(0, 200),
              Math.max(1, Math.round(n(x.weight, 1))),
              x.required !== false,
            ]
          );
        }
        return pb;
      });

      res.status(201).json({ playbook });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not create playbook." });
    }
  });

  router.put("/:id", auth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid playbook ID." });
      }

      const existing = await db(
        "SELECT * FROM playbooks WHERE id=$1 AND user_id=$2",
        [id, req.user.id]
      );
      if (!existing.rowCount) {
        return res.status(404).json({ error: "Playbook not found." });
      }
      const current = existing.rows[0];

      const name =
        req.body.name !== undefined
          ? String(req.body.name || "").trim()
          : current.name;
      if (name.length < 2 || name.length > 120) {
        return res
          .status(400)
          .json({ error: "Playbook name must be 2-120 characters." });
      }

      const description =
        req.body.description !== undefined
          ? String(req.body.description || "")
          : current.description || "";
      const strategy =
        req.body.strategy !== undefined
          ? String(req.body.strategy || "")
          : current.strategy || "";
      const riskLimit =
        req.body.riskLimit !== undefined
          ? n(req.body.riskLimit, 1)
          : current.risk_limit;
      /* H2: omit active → preserve stored state (do not force true) */
      const active =
        req.body.active !== undefined ? !!req.body.active : !!current.active;

      const playbook = await withTx(async (client) => {
        const p = await client.query(
          `UPDATE playbooks
           SET name=$1, description=$2, strategy=$3, risk_limit=$4, active=$5
           WHERE id=$6 AND user_id=$7
           RETURNING *`,
          [name, description, strategy, riskLimit, active, id, req.user.id]
        );
        if (!p.rowCount) {
          const err = new Error("Playbook not found.");
          err.status = 404;
          throw err;
        }

        if (Array.isArray(req.body.rules)) {
          await client.query("DELETE FROM playbook_rules WHERE playbook_id=$1", [
            id,
          ]);
          for (const x of req.body.rules) {
            const label = String(x.label || "").trim();
            if (!label) continue;
            await client.query(
              `INSERT INTO playbook_rules(playbook_id,label,weight,required)
               VALUES($1,$2,$3,$4)`,
              [
                id,
                label.slice(0, 200),
                Math.max(1, Math.round(n(x.weight, 1))),
                x.required !== false,
              ]
            );
          }
        }
        return p.rows[0];
      });

      res.json({ playbook });
    } catch (e) {
      if (e.status === 404) {
        return res.status(404).json({ error: "Playbook not found." });
      }
      console.error(e);
      res.status(500).json({ error: "Could not update playbook." });
    }
  });

  router.delete("/:id", auth, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid playbook ID." });
      }
      const r = await db(
        "DELETE FROM playbooks WHERE id=$1 AND user_id=$2",
        [id, req.user.id]
      );
      if (!r.rowCount) {
        return res.status(404).json({ error: "Playbook not found." });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Could not delete playbook." });
    }
  });

  return router;
}

module.exports = { createPlaybookRouter };
