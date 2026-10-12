const { Pool } = require("pg");

/**
 * PostgreSQL pool (Batch C / R-01).
 * Conservative defaults suitable for a single Render web instance.
 * Idle client errors must be handled so they do not become uncaught exceptions.
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL &&
    !process.env.DATABASE_URL.includes("localhost")
      ? { rejectUnauthorized: false }
      : false,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 30000,
  connectionTimeoutMillis:
    Number(process.env.PG_CONNECTION_TIMEOUT_MS) || 10000,
});

pool.on("error", (err) => {
  // Idle clients can emit errors after checkout; without a listener this
  // becomes an uncaught exception and can terminate the process.
  console.error("Unexpected idle PostgreSQL pool error:", err && err.message);
});

const db = (q, p = []) => pool.query(q, p);

module.exports = { pool, db };
