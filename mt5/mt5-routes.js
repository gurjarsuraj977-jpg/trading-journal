const express = require("express");

function createMT5Router({ db, auth }) {
  const router = express.Router();

  // ----------------------------------------------------------
  // MT5 CONNECTION STATUS
  // ----------------------------------------------------------

  router.get("/status", auth, async (req, res) => {
    try {
      const r = await db(
        `
        SELECT
          id,
          broker,
          server,
          account_login,
          account_name,
          currency,
          status,
          last_error,
          last_connected_at
        FROM mt5_connections
        WHERE user_id = $1
        LIMIT 1
        `,
        [req.user.id]
      );

      if (!r.rowCount) {
        return res.json({
          connected: false,
          status: "not_configured"
        });
      }

      const connection = r.rows[0];

      res.json({
        connected: connection.status === "connected",
        status: connection.status,
        connection
      });

    } catch (e) {
      console.error("MT5 status error:", e);

      res.status(500).json({
        error: "Unable to check MT5 connection."
      });
    }
  });

  // ----------------------------------------------------------
  // MT5 DISCONNECT
  // ----------------------------------------------------------

  router.post("/disconnect", auth, async (req, res) => {
    try {
      await db(
        `
        UPDATE mt5_connections
        SET
          status = 'disconnected',
          last_error = NULL,
          updated_at = NOW()
        WHERE user_id = $1
        `,
        [req.user.id]
      );

      res.json({
        success: true,
        message: "MT5 disconnected."
      });

    } catch (e) {
      console.error("MT5 disconnect error:", e);

      res.status(500).json({
        error: "Unable to disconnect MT5."
      });
    }
  });

  return router;
}

module.exports = {
  createMT5Router
};
