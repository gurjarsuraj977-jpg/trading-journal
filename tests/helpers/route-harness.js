/**
 * Runs the REAL route modules without an HTTP server or the express package:
 * `express` is replaced by a tiny Router recorder and `../db/pool` by the test
 * pool, then handlers are invoked directly with a fake req/res.
 * Authentication is injected by the test (fake `auth` middleware), so ownership
 * checks are exercised with different req.user ids.
 */
const Module = require("module");
const path = require("path");

let testPool = null;
let installed = false;

function Router() {
  const routes = [];
  const r = { routes };
  for (const m of ["get", "post", "put", "delete", "patch"]) {
    r[m] = (p, ...hs) => { routes.push({ method: m.toUpperCase(), path: p, hs }); return r; };
  }
  r.use = () => r;
  return r;
}

function install(pool) {
  testPool = pool;
  if (installed) return;
  installed = true;
  const origLoad = Module._load;
  const poolFile = path.resolve(__dirname, "..", "..", "db", "pool.js");
  Module._load = function (request, parent, isMain) {
    if (request === "express") {
      const fn = () => ({});
      fn.Router = Router;
      return fn;
    }
    if (request === "../db/pool" || request === "./db/pool") {
      try {
        if (path.resolve(path.dirname(parent.filename), request) + ".js" === poolFile) {
          return { pool: testPool, db: (t, p = []) => testPool.query(t, p) };
        }
      } catch (_) {}
    }
    return origLoad.apply(this, arguments);
  };
}

function matchPath(pattern, url) {
  const names = [];
  const re = new RegExp("^" + pattern.replace(/:([A-Za-z]+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "/?$");
  const m = url.match(re);
  if (!m) return null;
  const params = {};
  names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
  return params;
}

/** Fake auth middleware: sets req.user from the request the test builds. */
const fakeAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "Not authenticated" }));

async function call(router, method, url, { userId, query = {}, body = {} } = {}) {
  for (const r of router.routes) {
    if (r.method !== method) continue;
    const params = matchPath(r.path, url);
    if (!params) continue;
    const req = { params, query, body, user: userId ? { id: userId } : undefined, originalUrl: url, cookies: {} };
    return await new Promise((resolve, reject) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(b) { resolve({ status: this.statusCode, body: b }); return this; },
      };
      let i = 0;
      const next = async (err) => {
        if (err) return reject(err);
        const h = r.hs[i++];
        if (!h) return resolve({ status: res.statusCode, body: undefined });
        try { await h(req, res, next); } catch (e) { reject(e); }
      };
      next();
    });
  }
  throw new Error(`no route ${method} ${url}`);
}

module.exports = { install, call, fakeAuth };
