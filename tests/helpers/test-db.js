/**
 * Isolated PostgreSQL databases for integration tests.
 *
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ghosttrader_test npm test
 *
 * Safety rules (enforced, not advisory):
 *   - TEST_DATABASE_URL must be set; otherwise DB tests SKIP (loudly).
 *   - The database name in it must contain "test".
 *   - It must differ from DATABASE_URL (production is never touched).
 *   - Every test run CREATEs its own throw-away database (<name>_<random>) and
 *     DROPs only that database afterwards. Nothing else is ever dropped.
 * The role needs CREATEDB. Uses `pg` if installed, else the psql adapter.
 */
const { spawnSync } = require("child_process");

function skip(reason) {
  console.log("SKIP  " + reason);
  console.log("\nSkipped: database integration tests need TEST_DATABASE_URL (see tests/helpers/test-db.js).");
  process.exit(0);
}

function adminPsql(url, sql) {
  const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", url, "-c", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("psql admin command failed: " + (r.stderr || r.error));
}

async function createTestDatabase() {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) skip("TEST_DATABASE_URL is not set");
  const u = new URL(base);
  const baseName = decodeURIComponent(u.pathname.replace(/^\//, ""));
  if (!/test/i.test(baseName)) {
    throw new Error(`Refusing to run: TEST_DATABASE_URL database "${baseName}" must contain "test".`);
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === base) {
    throw new Error("Refusing to run: TEST_DATABASE_URL equals DATABASE_URL.");
  }
  const name = `${baseName}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("unsafe database name: " + name);
  adminPsql(base, `CREATE DATABASE ${name}`);
  const u2 = new URL(base);
  u2.pathname = "/" + name;
  const url = u2.toString();

  let pool, driver;
  try {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: url });
    driver = "pg";
  } catch (_) {
    pool = require("./psql-session").createPsqlPool(url);
    driver = "psql";
  }
  const db = (t, p = []) => pool.query(t, p);
  return {
    db,
    pool,
    url,
    driver,
    name,
    async close() {
      try { await pool.end(); } catch (_) {}
      adminPsql(base, `DROP DATABASE IF EXISTS ${name}`);
    },
  };
}

module.exports = { createTestDatabase };
