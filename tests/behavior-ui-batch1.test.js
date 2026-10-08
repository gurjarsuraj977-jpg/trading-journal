/**
 * Behavior UI Batch 1 — filter construction + evidence rendering helpers.
 * Deterministic source tests (no browser). Run:
 *   node tests/behavior-ui-batch1.test.js
 *
 * Mirrors the pure logic in public/js/insights-reports.js without DOM.
 */
const assert = require("assert");

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log("PASS  " + name);
    pass++;
  } catch (e) {
    console.log("FAIL  " + name + "  ->  " + e.message);
    fail++;
  }
}

/* ---- Mirror of frontend pure helpers ---- */

function dateRangeFrom(stateRange, now) {
  if (stateRange === "all") return {};
  const from = new Date(now);
  if (stateRange === "month") from.setDate(1);
  else if (stateRange === "3m") from.setMonth(from.getMonth() - 2, 1);
  else if (stateRange === "6m") from.setMonth(from.getMonth() - 5, 1);
  else from.setFullYear(from.getFullYear() - 1);
  const local = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: local(from), to: local(now) };
}

function behaviorQuery(state, tz, now) {
  const params = {
    account: state.account || "",
    tz: tz || "UTC",
    ...dateRangeFrom(state.range || "year", now || new Date()),
  };
  return new URLSearchParams(params).toString();
}

function evidenceLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "strong") return "Strong";
  if (s === "meaningful") return "Meaningful";
  if (s === "emerging") return "Emerging";
  if (s === "insufficient") return "Insufficient";
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
}

function confidenceLabel(level) {
  const s = String(level || "").toLowerCase();
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  if (s === "none") return "None";
  return s ? s[0].toUpperCase() + s.slice(1) : "—";
}

function classifyBaseline(b) {
  if (!b || typeof b !== "object") return "error";
  const n = Number(b.sampleSize) || 0;
  if (n === 0) return "empty";
  const status = String((b.evidence && b.evidence.status) || "").toLowerCase();
  if (status === "insufficient" || n < 8) return "insufficient";
  return "ready";
}

/* ---- Tests ---- */

const FIXED = new Date(2026, 9, 8); // 2026-10-08 local

test("behaviorQuery includes account, tz, from, to for year range", () => {
  const q = behaviorQuery({ account: "Main", range: "year" }, "America/New_York", FIXED);
  const p = new URLSearchParams(q);
  assert.strictEqual(p.get("account"), "Main");
  assert.strictEqual(p.get("tz"), "America/New_York");
  assert.ok(p.get("from"));
  assert.ok(p.get("to"));
  assert.strictEqual(p.get("to"), "2026-10-08");
  assert.strictEqual(p.get("from"), "2025-10-08");
});

test("behaviorQuery omits from/to when range is all", () => {
  const q = behaviorQuery({ account: "", range: "all" }, "UTC", FIXED);
  const p = new URLSearchParams(q);
  assert.strictEqual(p.get("account"), "");
  assert.strictEqual(p.get("tz"), "UTC");
  assert.strictEqual(p.get("from"), null);
  assert.strictEqual(p.get("to"), null);
});

test("behaviorQuery month range starts on 1st of current month", () => {
  const q = behaviorQuery({ account: "A", range: "month" }, "UTC", FIXED);
  const p = new URLSearchParams(q);
  assert.strictEqual(p.get("from"), "2026-10-01");
  assert.strictEqual(p.get("to"), "2026-10-08");
});

test("behaviorQuery empty account is still sent as empty string (parity with premium)", () => {
  const q = behaviorQuery({ account: "", range: "year" }, "UTC", FIXED);
  const p = new URLSearchParams(q);
  assert.strictEqual(p.has("account"), true);
  assert.strictEqual(p.get("account"), "");
});

test("evidence labels map backend statuses", () => {
  assert.strictEqual(evidenceLabel("insufficient"), "Insufficient");
  assert.strictEqual(evidenceLabel("emerging"), "Emerging");
  assert.strictEqual(evidenceLabel("meaningful"), "Meaningful");
  assert.strictEqual(evidenceLabel("strong"), "Strong");
});

test("confidence labels map backend levels", () => {
  assert.strictEqual(confidenceLabel("none"), "None");
  assert.strictEqual(confidenceLabel("low"), "Low");
  assert.strictEqual(confidenceLabel("medium"), "Medium");
  assert.strictEqual(confidenceLabel("high"), "High");
});

test("classifyBaseline: sampleSize 0 → empty", () => {
  assert.strictEqual(classifyBaseline({ sampleSize: 0, evidence: { status: "insufficient" } }), "empty");
});

test("classifyBaseline: sampleSize 5 insufficient → insufficient", () => {
  assert.strictEqual(
    classifyBaseline({ sampleSize: 5, evidence: { status: "insufficient", confidenceLevel: "none" } }),
    "insufficient"
  );
});

test("classifyBaseline: emerging (n=12) → ready", () => {
  assert.strictEqual(
    classifyBaseline({ sampleSize: 12, evidence: { status: "emerging", confidenceLevel: "low" } }),
    "ready"
  );
});

test("classifyBaseline: meaningful (n=34) → ready", () => {
  assert.strictEqual(
    classifyBaseline({ sampleSize: 34, evidence: { status: "meaningful", confidenceLevel: "medium" } }),
    "ready"
  );
});

test("classifyBaseline: strong (n=80) → ready", () => {
  assert.strictEqual(
    classifyBaseline({ sampleSize: 80, evidence: { status: "strong", confidenceLevel: "high" } }),
    "ready"
  );
});

test("classifyBaseline: null payload → error", () => {
  assert.strictEqual(classifyBaseline(null), "error");
});

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
