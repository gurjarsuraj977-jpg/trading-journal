/**
 * TEST-ONLY PostgreSQL adapter that drives the `psql` CLI. Used when the `pg`
 * npm package is not installed (e.g. a sandbox without registry access).
 * When `pg` IS installed, tests/helpers/test-db.js uses it instead.
 *
 * Each PsqlSession is one persistent psql process = one real database session,
 * so BEGIN/COMMIT/ROLLBACK, errors and SQLSTATE codes behave like node-postgres.
 * Parameters ($1, $2 ...) are inlined as escaped literals (test data only).
 * Rows come back via row_to_json, so NUMERIC values are JS numbers here
 * (node-postgres returns strings); application code wraps them in Number().
 */
const { spawn } = require("child_process");

function literal(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite numeric parameter");
    return String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function inline(sql, params) {
  if (!params || !params.length) return sql;
  return sql.replace(/\$(\d+)(?!\d)/g, (m, i) => {
    const idx = Number(i) - 1;
    if (idx >= params.length) throw new Error(`missing parameter $${i}`);
    return literal(params[idx]);
  });
}

function classify(sqlRaw) {
  const sql = sqlRaw.trim().replace(/;+\s*$/, "");
  const head = sql.slice(0, 12).toUpperCase();
  const single = !sql.includes(";");
  const wrapJson = (inner) =>
    `SELECT COALESCE(json_agg(row_to_json(q)),'[]'::json) FROM (${inner}) q`;
  if (/^(SELECT|WITH|VALUES)\b/.test(head)) return { mode: "rows", sql: wrapJson(sql) };
  if (single && /^(INSERT|UPDATE|DELETE)\b/.test(head)) {
    if (/\bRETURNING\b/i.test(sql)) {
      return { mode: "rows", sql: `WITH q AS (${sql}) SELECT COALESCE(json_agg(row_to_json(q)),'[]'::json) FROM q` };
    }
    return { mode: "count", sql: `WITH q AS (${sql} RETURNING 1) SELECT count(*) FROM q` };
  }
  return { mode: "raw", sql };
}

let seq = 0;
class PsqlSession {
  constructor(url) {
    this.queue = Promise.resolve();
    this.out = "";
    this.err = "";
    this.proc = spawn("psql", ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=0", "-d", url], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (d) => { this.out += d; this._pump(); });
    this.proc.stderr.on("data", (d) => { this.err += d; this._pump(); });
    this.proc.on("error", (e) => { this.fatal = e; this._pump(); });
    this.waiter = null;
    this.proc.stdin.write("\\set VERBOSITY verbose\nSET client_min_messages=warning;\n");
  }
  _pump() {
    if (this.waiter) this.waiter();
  }
  query(text, params) {
    const run = () =>
      new Promise((resolve, reject) => {
        let c;
        try {
          c = classify(inline(text, params));
        } catch (e) {
          return reject(e);
        }
        const id = ++seq;
        const mo = `__END_OUT_${id}__`;
        const me = `__END_ERR_${id}__`;
        this.out = "";
        this.err = "";
        this.waiter = () => {
          if (this.fatal) {
            this.waiter = null;
            return reject(this.fatal);
          }
          if (!this.out.includes(mo) || !this.err.includes(me)) return;
          this.waiter = null;
          const out = this.out.slice(0, this.out.indexOf(mo)).trim();
          const err = this.err.slice(0, this.err.indexOf(me));
          const m = err.match(/ERROR:\s+([0-9A-Z]{5}):\s*(.*)/);
          if (m) {
            const e = new Error(m[2]);
            e.code = m[1];
            return reject(e);
          }
          if (c.mode === "rows") {
            const rows = out ? JSON.parse(out) : [];
            return resolve({ rows, rowCount: rows.length });
          }
          if (c.mode === "count") return resolve({ rows: [], rowCount: Number(out) || 0 });
          resolve({ rows: [], rowCount: 0 });
        };
        this.proc.stdin.write(`${c.sql};\n\\echo ${mo}\n\\warn ${me}\n`);
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
  end() {
    try { this.proc.stdin.end("\\q\n"); } catch (_) {}
    return new Promise((r) => this.proc.on("close", r));
  }
}

/** Minimal node-postgres Pool look-alike: query(), connect() -> client, end(). */
function createPsqlPool(url) {
  const main = new PsqlSession(url);
  const clients = new Set();
  return {
    query: (t, p) => main.query(t, p),
    async connect() {
      const s = new PsqlSession(url);
      clients.add(s);
      return {
        query: (t, p) => s.query(t, p),
        release: () => { clients.delete(s); s.end(); },
      };
    },
    async end() {
      for (const s of clients) await s.end();
      await main.end();
    },
  };
}

module.exports = { createPsqlPool };
