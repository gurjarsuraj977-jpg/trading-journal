require("dotenv").config();

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-change-me";

if (!process.env.DATABASE_URL) {
  console.warn("WARNING: DATABASE_URL is not set.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

async function db(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

async function initDb() {
  await db(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      account VARCHAR(100) NOT NULL DEFAULT 'Main Account',
      symbol VARCHAR(30) NOT NULL,
      direction VARCHAR(10) NOT NULL CHECK (direction IN ('BUY','SELL')),
      entry NUMERIC(20,8) NOT NULL,
      stop_loss NUMERIC(20,8),
      take_profit NUMERIC(20,8),
      exit_price NUMERIC(20,8),
      quantity NUMERIC(20,8) NOT NULL DEFAULT 1,
      risk_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
      profit_loss NUMERIC(20,2) NOT NULL DEFAULT 0,
      strategy VARCHAR(100),
      session VARCHAR(40),
      notes TEXT,
      trade_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS trades_user_date_idx
      ON trades(user_id, trade_date DESC);
  `);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const token = req.cookies.gt_token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired" });
  }
}

function cleanNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (name.length < 2) return res.status(400).json({ error: "Name must be at least 2 characters." });
    if (!email.includes("@")) return res.status(400).json({ error: "Enter a valid email." });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

    const existing = await db("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rowCount) return res.status(409).json({ error: "An account with that email already exists." });

    const hash = await bcrypt.hash(password, 12);
    const result = await db(
      "INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",
      [name, email, hash]
    );

    const user = result.rows[0];
    res.cookie("gt_token", signToken(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const result = await db("SELECT * FROM users WHERE email=$1", [email]);
    if (!result.rowCount) return res.status(401).json({ error: "Invalid email or password." });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password." });

    const safeUser = { id: user.id, name: user.name, email: user.email };
    res.cookie("gt_token", signToken(safeUser), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.json({ user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("gt_token");
  res.json({ ok: true });
});

app.get("/api/auth/me", auth, async (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/dashboard", auth, async (req, res) => {
  try {
    const stats = await db(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE profit_loss > 0)::int AS wins,
        COUNT(*) FILTER (WHERE profit_loss < 0)::int AS losses,
        COALESCE(SUM(profit_loss),0)::numeric AS pnl,
        COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss > 0),0)::numeric AS avg_win,
        COALESCE(AVG(profit_loss) FILTER (WHERE profit_loss < 0),0)::numeric AS avg_loss,
        COALESCE(SUM(profit_loss) FILTER (WHERE profit_loss > 0),0)::numeric AS gross_profit,
        ABS(COALESCE(SUM(profit_loss) FILTER (WHERE profit_loss < 0),0))::numeric AS gross_loss,
        COALESCE(SUM(risk_amount),0)::numeric AS total_risk
      FROM trades WHERE user_id=$1
    `, [req.user.id]);

    const recent = await db(`
      SELECT id, account, symbol, direction, entry, stop_loss, take_profit,
             exit_price, quantity, risk_amount, profit_loss, strategy, session,
             notes, trade_date
      FROM trades
      WHERE user_id=$1
      ORDER BY trade_date DESC
      LIMIT 8
    `, [req.user.id]);

    const curve = await db(`
      SELECT trade_date, profit_loss
      FROM trades
      WHERE user_id=$1
      ORDER BY trade_date ASC, id ASC
    `, [req.user.id]);

    const s = stats.rows[0];
    const total = Number(s.total);
    const wins = Number(s.wins);
    const grossProfit = Number(s.gross_profit);
    const grossLoss = Number(s.gross_loss);

    res.json({
      stats: {
        total,
        wins,
        losses: Number(s.losses),
        pnl: Number(s.pnl),
        winRate: total ? (wins / total) * 100 : 0,
        avgWin: Number(s.avg_win),
        avgLoss: Number(s.avg_loss),
        profitFactor: grossLoss ? grossProfit / grossLoss : (grossProfit ? Infinity : 0),
        totalRisk: Number(s.total_risk)
      },
      recent: recent.rows,
      curve: curve.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load dashboard." });
  }
});

app.get("/api/trades", auth, async (req, res) => {
  try {
    const values = [req.user.id];
    const where = ["user_id=$1"];

    if (req.query.symbol) {
      values.push(`%${String(req.query.symbol).trim()}%`);
      where.push(`symbol ILIKE $${values.length}`);
    }
    if (req.query.direction && ["BUY", "SELL"].includes(req.query.direction)) {
      values.push(req.query.direction);
      where.push(`direction=$${values.length}`);
    }
    if (req.query.result === "win") where.push("profit_loss > 0");
    if (req.query.result === "loss") where.push("profit_loss < 0");

    const result = await db(`
      SELECT id, account, symbol, direction, entry, stop_loss, take_profit,
             exit_price, quantity, risk_amount, profit_loss, strategy, session,
             notes, trade_date
      FROM trades
      WHERE ${where.join(" AND ")}
      ORDER BY trade_date DESC, id DESC
      LIMIT 500
    `, values);

    res.json({ trades: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load trades." });
  }
});

app.post("/api/trades", auth, async (req, res) => {
  try {
    const b = req.body;
    const symbol = String(b.symbol || "").trim().toUpperCase();
    const direction = String(b.direction || "").toUpperCase();
    const account = String(b.account || "Main Account").trim();
    const entry = cleanNumber(b.entry, NaN);

    if (!symbol) return res.status(400).json({ error: "Symbol is required." });
    if (!["BUY", "SELL"].includes(direction)) return res.status(400).json({ error: "Direction must be BUY or SELL." });
    if (!Number.isFinite(entry)) return res.status(400).json({ error: "Entry price is required." });

    const result = await db(`
      INSERT INTO trades
      (user_id, account, symbol, direction, entry, stop_loss, take_profit,
       exit_price, quantity, risk_amount, profit_loss, strategy, session, notes, trade_date)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      req.user.id,
      account || "Main Account",
      symbol,
      direction,
      entry,
      b.stopLoss === "" || b.stopLoss == null ? null : cleanNumber(b.stopLoss, null),
      b.takeProfit === "" || b.takeProfit == null ? null : cleanNumber(b.takeProfit, null),
      b.exitPrice === "" || b.exitPrice == null ? null : cleanNumber(b.exitPrice, null),
      cleanNumber(b.quantity, 1),
      cleanNumber(b.riskAmount, 0),
      cleanNumber(b.profitLoss, 0),
      String(b.strategy || "").trim(),
      String(b.session || "").trim(),
      String(b.notes || "").trim(),
      b.tradeDate ? new Date(b.tradeDate) : new Date()
    ]);

    res.status(201).json({ trade: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create trade." });
  }
});

app.put("/api/trades/:id", auth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = req.body;

    const result = await db(`
      UPDATE trades SET
        account=$1, symbol=$2, direction=$3, entry=$4, stop_loss=$5,
        take_profit=$6, exit_price=$7, quantity=$8, risk_amount=$9,
        profit_loss=$10, strategy=$11, session=$12, notes=$13, trade_date=$14
      WHERE id=$15 AND user_id=$16
      RETURNING *
    `, [
      String(b.account || "Main Account").trim(),
      String(b.symbol || "").trim().toUpperCase(),
      String(b.direction || "").toUpperCase(),
      cleanNumber(b.entry),
      b.stopLoss === "" || b.stopLoss == null ? null : cleanNumber(b.stopLoss, null),
      b.takeProfit === "" || b.takeProfit == null ? null : cleanNumber(b.takeProfit, null),
      b.exitPrice === "" || b.exitPrice == null ? null : cleanNumber(b.exitPrice, null),
      cleanNumber(b.quantity, 1),
      cleanNumber(b.riskAmount, 0),
      cleanNumber(b.profitLoss, 0),
      String(b.strategy || "").trim(),
      String(b.session || "").trim(),
      String(b.notes || "").trim(),
      b.tradeDate ? new Date(b.tradeDate) : new Date(),
      id,
      req.user.id
    ]);

    if (!result.rowCount) return res.status(404).json({ error: "Trade not found." });
    res.json({ trade: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not update trade." });
  }
});

app.delete("/api/trades/:id", auth, async (req, res) => {
  try {
    const result = await db(
      "DELETE FROM trades WHERE id=$1 AND user_id=$2 RETURNING id",
      [Number(req.params.id), req.user.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Trade not found." });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not delete trade." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`GhostTrader running on port ${PORT}`));
  })
  .catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
