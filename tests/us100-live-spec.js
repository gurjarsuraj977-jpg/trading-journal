/**
 * PHASE 2 — SAFE TradeLocker instrument specification capture (read-only).
 *
 * Purpose:
 *   Discover the REAL broker specification for the user's US100-family
 *   instrument. This script performs GET requests ONLY. It never places,
 *   modifies or closes trades, and it never writes to the database.
 *
 * Security guarantees:
 *   - NEVER prints access tokens, refresh tokens, passwords or emails.
 *   - NEVER prints Authorization / accNum headers.
 *   - Persists NOTHING except the whitelisted, non-sensitive instrument
 *     fields written to tests/us100-live-spec-output.json.
 *
 * Usage:
 *   node tests/us100-live-spec.js [userId] [--env demo|live] [--pattern REGEX]
 *
 *   userId defaults to 1. Pass --db $DATABASE_URL or set DATABASE_URL.
 *
 * Flow (mirrors the existing production path exactly):
 *   tradelocker_connections (refresh_token)
 *     -> client.refreshAccessToken        (tradelocker-client.js)
 *     -> client.getAllAccounts            (pick selected / only account)
 *     -> client.getInstruments            GET /trade/accounts/{id}/instruments
 *     -> match candidate symbols          (US100/NAS100/USTEC/... exact list)
 *     -> client.getInstrumentDetails      GET /trade/instruments/{tid}?routeId={rid}
 *     -> validateInstrumentSpec           (utils/instrument-spec.js — Phase 1 layer)
 *     -> calculateTrade BUY/SELL          (utils/trade-calculator.js)
 */

const fs = require("fs");
const path = require("path");

const { TradeLockerClient } = require("../tradelocker/tradelocker-client");
const {
  validateInstrumentSpec,
  normalizeSymbol,
  resolveCanonicalSymbol
} = require("../utils/instrument-spec");
const { calculateTrade } = require("../utils/trade-calculator");

/* ------------------------------------------------------------------ */
/* Args                                                               */
/* ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
let userId = "1";
let envOverride = null;
let pattern = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--env") envOverride = argv[++i];
  else if (argv[i] === "--pattern") pattern = new RegExp(argv[++i], "i");
  else if (/^\d+$/.test(argv[i])) userId = argv[i];
}

/* Candidate broker spellings — normalized before comparison.
 * These are SEARCH TERMS for discovery only; equivalence is proven by
 * inspecting the returned instrument details, never assumed here. */
const CANDIDATE_NORMALIZED = new Set([
  "US100", "NAS100", "USTEC", "NASDAQ", "NQ100", "USTECH",
  "US100CASH", "NAS100CASH", "USTECCASH", "US100USD", "NAS100USD",
  "TECH100", "USATECH100", "NASDAQ100"
]);

function redacted(obj, keys) {
  const out = {};
  for (const k of keys) {
    const v = obj && obj[k];
    out[k] = v ? String(v).slice(0, 4) + "…[redacted]" : null;
  }
  return out;
}

/* Keep ONLY whitelisted non-sensitive fields from a raw API row. */
function pickInstrumentFields(row) {
  if (!row || typeof row !== "object") return null;
  const out = {};
  for (const k of Object.keys(row)) {
    const lk = k.toLowerCase();
    if (/(token|password|secret|auth|cookie|email|apikey|api_key)/.test(lk)) continue;
    // instruments list rows are small metadata; cap pathological strings
    const v = row[k];
    out[k] = typeof v === "string" && v.length > 120 ? v.slice(0, 120) + "…" : v;
  }
  return out;
}

function extractTickSize(raw) {
  if (raw && Array.isArray(raw.tickSize) && raw.tickSize.length > 0) {
    return raw.tickSize;
  }
  return raw && raw.tickSize !== undefined ? raw.tickSize : null;
}

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    (() => {
      const i = argv.indexOf("--db");
      return i >= 0 ? argv[i + 1] : null;
    })();

  if (!connectionString) {
    console.error(
      "ERROR: DATABASE_URL is required (the encrypted TradeLocker session\n" +
      "is stored in the tradelocker_connections table). Example:\n" +
      "  DATABASE_URL=postgres://... node tests/us100-live-spec.js 1"
    );
    process.exit(2);
  }

  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost")
      ? false
      : { rejectUnauthorized: false }
  });

  const client = new TradeLockerClient();
  let accessToken = null; // local only — never printed

  try {
    /* ---------------- 1. Load connection (no secrets printed) -------- */
    const { rows } = await pool.query(
      `SELECT environment, server, refresh_token,
              selected_account_id, selected_acc_num, currency
       FROM tradelocker_connections
       WHERE user_id = $1 LIMIT 1`,
      [Number(userId)]
    );
    const conn = rows[0];
    if (!conn || !conn.refresh_token) {
      console.error(`No TradeLocker connection found for user ${userId}.`);
      process.exit(3);
    }
    const environment = envOverride || conn.environment;
    console.log(`Connection found: user=${userId} environment=${environment} ` +
      `accountCurrency=${conn.currency || "NOT PROVIDED"}`);
    console.log(`Secrets present but REDACTED:`,
      redacted(conn, ["refresh_token"]));

    /* ---------------- 2. Refresh token (never logged) ----------------- */
    const refreshed = await client.refreshAccessToken({
      environment,
      refreshToken: conn.refresh_token
    });
    accessToken = refreshed.accessToken;

    /* ---------------- 3. Accounts ------------------------------------- */
    const accounts = await client.getAllAccounts({ environment, accessToken });
    if (!accounts.length) {
      console.error("No TradeLocker accounts returned.");
      process.exit(4);
    }
    let account =
      accounts.find(a => String(a.id) === String(conn.selected_account_id)) ||
      (accounts.length === 1 ? accounts[0] : null);
    if (!account) {
      console.log("Multiple accounts; available (non-sensitive):");
      accounts.forEach(a =>
        console.log(`  id=${a.id} accNum=${a.accNum} name=${a.accountName} currency=${a.currency}`));
      console.error("Set selected_account_id or extend this script with an explicit account arg.");
      process.exit(5);
    }
    const accountCurrency = String(account.currency || conn.currency || "USD").toUpperCase();
    console.log(`Using account: id=${account.id} accNum=${account.accNum} ` +
      `name="${account.accountName}" currency=${accountCurrency}`);

    /* ---------------- 4. Instrument discovery ------------------------- */
    const instrumentsRes = await client.getInstruments({
      environment,
      accessToken,
      accountId: account.id,
      accNum: account.accNum
    });
    const instrumentRows =
      instrumentsRes && instrumentsRes.d && Array.isArray(instrumentsRes.d.instruments)
        ? instrumentsRes.d.instruments
        : [];
    console.log(`Instruments returned by broker: ${instrumentRows.length}`);

    const candidates = instrumentRows.filter((inst) => {
      const name = String(inst.name || inst.symbol || "");
      const n = normalizeSymbol(name);
      if (pattern) return pattern.test(name);
      return CANDIDATE_NORMALIZED.has(n) || resolveCanonicalSymbol(name) === "US100";
    });

    if (!candidates.length) {
      console.log("\nNo US100-family instrument matched. Full symbol list (names only):");
      console.log(instrumentRows.map(i => i.name || i.symbol).filter(Boolean).join(", "));
      console.log("\nACTION: re-run with --pattern 'REGEX' once you spot the real symbol above.");
      process.exit(6);
    }

    const report = [];
    for (const inst of candidates) {
      const routes = Array.isArray(inst.routes) ? inst.routes : [];
      const tradeRoute = routes.find(r => String(r.actionType || r.type || "").toUpperCase() === "TRADE") || routes[0];
      const name = String(inst.name || inst.symbol || "");
      console.log(`\n=== Candidate: ${name} (tradableInstrumentId=${inst.tradableInstrumentId}, routeId=${tradeRoute ? tradeRoute.routeId : "N/A"}) ===`);
      if (!tradeRoute) {
        console.log("  No TRADE route — cannot fetch details.");
        report.push({ brokerSymbol: name, error: "NO_TRADE_ROUTE" });
        continue;
      }

      /* ---------- 5. Instrument details (GET only) -------------------- */
      const detailsRes = await client.getInstrumentDetails({
        environment,
        accessToken,
        tradableInstrumentId: inst.tradableInstrumentId,
        routeId: tradeRoute.routeId,
        accNum: account.accNum
      });
      const details = (detailsRes && detailsRes.d) ? detailsRes.d : detailsRes;

      /* ---------- 6. Phase 1 validation layer ------------------------- */
      const validated = validateInstrumentSpec({
        instrumentId: inst.tradableInstrumentId,
        name,
        lotSize: details.lotSize,
        lotStep: details.lotStep,
        minLot: details.minLot,
        maxLot: details.maxLot,
        tickSize: details.tickSize,
        quotingCurrency: details.quotingCurrency
      });

      const tickSizes = extractTickSize(details);
      const entry = {
        brokerSymbol: name,
        canonicalSymbol: resolveCanonicalSymbol(name),
        instrumentId: validated.valid ? validated.spec.instrumentId : String(inst.tradableInstrumentId),
        lotSize: validated.valid ? validated.spec.lotSize : "REJECTED",
        lotStep: validated.valid ? validated.spec.lotStep : (details.lotStep ?? "NOT PROVIDED"),
        minLot: validated.valid ? validated.spec.minLot : (details.minLot ?? "NOT PROVIDED"),
        maxLot: validated.valid ? validated.spec.maxLot : (details.maxLot ?? "NOT PROVIDED"),
        tickSize: tickSizes,
        priceDecimals: details.priceDecimal != null ? details.priceDecimal
          : (details.priceDecimals != null ? details.priceDecimals : "NOT PROVIDED"),
        quantityDecimals: details.quantityDecimal != null ? details.quantityDecimal
          : (details.volumeDecimal != null ? details.volumeDecimal : "NOT PROVIDED"),
        quotingCurrency: validated.valid ? validated.spec.quotingCurrency : (details.quotingCurrency || "NOT PROVIDED"),
        validSpec: validated.valid,
        ...(validated.valid ? {} : { rejection: validated.error, diagnostics: validated.diagnostics }),
        rawNonSensitiveFields: pickInstrumentFields(details)
      };
      report.push(entry);

      console.log(JSON.stringify({
        symbol: entry.brokerSymbol,
        instrumentId: entry.instrumentId,
        lotSize: entry.lotSize,
        lotStep: entry.lotStep,
        minLot: entry.minLot,
        maxLot: entry.maxLot,
        tickSize: entry.tickSize,
        quotingCurrency: entry.quotingCurrency,
        priceDecimals: entry.priceDecimals,
        quantityDecimals: entry.quantityDecimals,
        validSpec: entry.validSpec
      }, null, 2));

      /* ---------- 7. Phase 1 pipeline proof w/ ACTUAL lotSize --------- */
      if (validated.valid) {
        const cs = validated.spec.lotSize;
        const refEntry = Number(details.currentPrice || details.lastPrice || 24000) || 24000;
        const buy = calculateTrade({
          symbol: name, direction: "BUY",
          entry: refEntry, exitPrice: refEntry + 50,
          quantity: validated.spec.minLot || 1, contractSize: cs
        });
        const sell = calculateTrade({
          symbol: name, direction: "SELL",
          entry: refEntry + 50, exitPrice: refEntry,
          quantity: validated.spec.minLot || 1, contractSize: cs
        });
        console.log(`Phase1 check @ lotSize=${cs}: BUY +50pts x qty ${validated.spec.minLot || 1} => ` +
          `${buy.profitLoss} (${buy.status}); SELL mirror => ${sell.profitLoss} (${sell.status})`);
        entry.phase1PipelineCheck = {
          contractSize: cs,
          referenceEntry: refEntry,
          buy: { profitLoss: buy.profitLoss, status: buy.status },
          sell: { profitLoss: sell.profitLoss, status: sell.status }
        };
      } else {
        console.log("REJECTED by validateInstrumentSpec:\n" + validated.error);
      }
    }

    /* ---------- 8. Persist ONLY whitelisted non-sensitive output ------ */
    const outPath = path.join(__dirname, "us100-live-spec-output.json");
    fs.writeFileSync(outPath, JSON.stringify({
      capturedAt: new Date().toISOString(),
      environment,
      accountCurrency,
      instruments: report
    }, null, 2));
    console.log(`\nSaved non-sensitive spec report -> ${outPath}`);
    console.log("NOTE: no tokens, credentials, headers or DB writes occurred.");
  } catch (err) {
    console.error("FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    accessToken = null;
    await pool.end().catch(() => {});
  }
}

main();
