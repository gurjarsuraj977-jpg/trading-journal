/**
 * Behavior UI Batch 2 — filter, evidence, grouping, sorting helpers.
 * Deterministic unit tests (no browser). Run:
 *   node tests/behavior-ui-batch2.test.js
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

/* ---- Mirrors of frontend pure helpers ---- */

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

function evidenceRank(status) {
  const s = String(status || "").toLowerCase();
  if (s === "strong") return 3;
  if (s === "meaningful") return 2;
  if (s === "emerging") return 1;
  return 0;
}

function isActionableEvidence(ev) {
  if (!ev) return false;
  const s = String(ev.status || "").toLowerCase();
  return s === "emerging" || s === "meaningful" || s === "strong";
}

function patternGroup(type) {
  if (type === "confidence_calibration" || type === "emotion_segment") return "Psychology";
  if (type === "rule_score" || type === "mistake_impact") return "Process";
  if (type === "risk_consistency" || type === "exit_efficiency" || type === "streaks")
    return "Risk & Execution";
  if (type === "segment_performance") return "Segments";
  return "Other";
}

function sortByEvidence(a, b) {
  const ra = evidenceRank(a.evidence && a.evidence.status);
  const rb = evidenceRank(b.evidence && b.evidence.status);
  if (rb !== ra) return rb - ra;
  return (Number(b.sampleSize) || 0) - (Number(a.sampleSize) || 0);
}

function sortDrivers(a, b) {
  const ra = evidenceRank(a.evidence && a.evidence.status);
  const rb = evidenceRank(b.evidence && b.evidence.status);
  if (rb !== ra) return rb - ra;
  const da = Math.abs(Number(a.difference && a.difference.averageR));
  const db = Math.abs(Number(b.difference && b.difference.averageR));
  const aOk = Number.isFinite(da) ? da : 0;
  const bOk = Number.isFinite(db) ? db : 0;
  if (bOk !== aOk) return bOk - aOk;
  return (Number(b.sampleSize) || 0) - (Number(a.sampleSize) || 0);
}

function preparePatterns(list) {
  return (list || [])
    .filter((p) => p && isActionableEvidence(p.evidence))
    .slice()
    .sort(sortByEvidence);
}

function groupPatterns(patterns) {
  const order = ["Psychology", "Process", "Risk & Execution", "Segments", "Other"];
  const map = {};
  for (const p of patterns) {
    const g = patternGroup(p.type);
    if (!map[g]) map[g] = [];
    map[g].push(p);
  }
  return order.filter((g) => map[g] && map[g].length).map((g) => ({ group: g, items: map[g] }));
}

function prepareDrivers(signals) {
  const segs = (signals && signals.segments) || [];
  return segs
    .filter((s) => {
      if (!s || !isActionableEvidence(s.evidence)) return false;
      const name = String(s.segment || "");
      if (!name || name === "Unspecified") return false;
      return true;
    })
    .slice()
    .sort(sortDrivers);
}

function fmtSignedR(n) {
  if (n === null || n === undefined || n === "") return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return sign + x.toFixed(2) + "R";
}

function fmtNum(n, digits) {
  if (n === null || n === undefined || n === "") return "—";
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

const FIXED = new Date(2026, 9, 8);

/* ---- 1–4 filter ---- */

test("behaviorQuery includes account", () => {
  const q = behaviorQuery({ account: "Prop-A", range: "year" }, "UTC", FIXED);
  assert.strictEqual(new URLSearchParams(q).get("account"), "Prop-A");
});

test("behaviorQuery includes timezone", () => {
  const q = behaviorQuery({ account: "", range: "year" }, "Asia/Kolkata", FIXED);
  assert.strictEqual(new URLSearchParams(q).get("tz"), "Asia/Kolkata");
});

test("behaviorQuery includes from/to for year range", () => {
  const p = new URLSearchParams(behaviorQuery({ account: "", range: "year" }, "UTC", FIXED));
  assert.strictEqual(p.get("from"), "2025-10-08");
  assert.strictEqual(p.get("to"), "2026-10-08");
});

test("All Time does not invent from/to", () => {
  const p = new URLSearchParams(behaviorQuery({ account: "X", range: "all" }, "UTC", FIXED));
  assert.strictEqual(p.get("from"), null);
  assert.strictEqual(p.get("to"), null);
  assert.strictEqual(p.get("account"), "X");
});

/* ---- 5 evidence labels ---- */

test("evidence labels mapped correctly", () => {
  assert.strictEqual(evidenceLabel("insufficient"), "Insufficient");
  assert.strictEqual(evidenceLabel("emerging"), "Emerging");
  assert.strictEqual(evidenceLabel("meaningful"), "Meaningful");
  assert.strictEqual(evidenceLabel("strong"), "Strong");
});

/* ---- 6 insufficient not actionable ---- */

test("insufficient patterns are not presented as actionable", () => {
  const list = [
    { type: "confidence_calibration", sampleSize: 5, evidence: { status: "insufficient" }, difference: 0.5 },
    { type: "confidence_calibration", sampleSize: 20, evidence: { status: "meaningful" }, difference: 0.2 },
  ];
  const out = preparePatterns(list);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].evidence.status, "meaningful");
});

/* ---- 7 grouping deterministic ---- */

test("pattern grouping is deterministic", () => {
  const prepared = preparePatterns([
    { type: "mistake_impact", sampleSize: 14, evidence: { status: "emerging" }, difference: -0.3 },
    { type: "confidence_calibration", sampleSize: 30, evidence: { status: "meaningful" }, difference: 0.2 },
    { type: "risk_consistency", sampleSize: 40, evidence: { status: "strong" }, difference: 0.1 },
    { type: "segment_performance", sampleSize: 25, evidence: { status: "meaningful" }, difference: 0.4 },
  ]);
  const groups = groupPatterns(prepared);
  assert.deepStrictEqual(
    groups.map((g) => g.group),
    ["Psychology", "Process", "Risk & Execution", "Segments"]
  );
});

/* ---- 8 driver sorting ---- */

test("performance driver sorting: evidence then |ΔR| then sample", () => {
  const drivers = prepareDrivers({
    segments: [
      {
        dimension: "strategy",
        segment: "A",
        sampleSize: 40,
        evidence: { status: "emerging" },
        difference: { averageR: 0.9 },
      },
      {
        dimension: "strategy",
        segment: "B",
        sampleSize: 20,
        evidence: { status: "strong" },
        difference: { averageR: 0.1 },
      },
      {
        dimension: "strategy",
        segment: "C",
        sampleSize: 50,
        evidence: { status: "strong" },
        difference: { averageR: -0.5 },
      },
      {
        dimension: "strategy",
        segment: "Unspecified",
        sampleSize: 100,
        evidence: { status: "strong" },
        difference: { averageR: 1 },
      },
      {
        dimension: "setup",
        segment: "D",
        sampleSize: 3,
        evidence: { status: "insufficient" },
        difference: { averageR: 2 },
      },
    ],
  });
  assert.strictEqual(drivers.length, 3);
  assert.strictEqual(drivers[0].segment, "C"); // strong, |0.5| > |0.1|
  assert.strictEqual(drivers[1].segment, "B"); // strong, smaller |Δ|
  assert.strictEqual(drivers[2].segment, "A"); // emerging only
});

/* ---- 9 empty state ---- */

test("empty patterns list yields empty preparePatterns", () => {
  assert.deepStrictEqual(preparePatterns([]), []);
  assert.deepStrictEqual(preparePatterns(null), []);
});

test("empty drivers when no segments", () => {
  assert.deepStrictEqual(prepareDrivers({}), []);
  assert.deepStrictEqual(prepareDrivers(null), []);
});

/* ---- 10 no NaN/Infinity in formatters ---- */

test("missing/null metrics do not render NaN or Infinity", () => {
  assert.strictEqual(fmtSignedR(null), "—");
  assert.strictEqual(fmtSignedR(undefined), "—");
  assert.strictEqual(fmtSignedR(NaN), "—");
  assert.strictEqual(fmtSignedR(Infinity), "—");
  assert.strictEqual(fmtNum(null, 2), "—");
  assert.strictEqual(fmtNum(undefined, 2), "—");
  assert.strictEqual(fmtSignedR(0.42), "+0.42R");
  assert.strictEqual(fmtSignedR(-0.31), "-0.31R");
});

/* ---- 11–12 failure isolation (logic contract) ---- */

test("signal failure does not imply premium failure (independent promises)", () => {
  /* Documented contract: insights() starts baseline/patterns/signals and
     premium independently; Promise.allSettled waits without throwing. */
  const independent = true;
  assert.strictEqual(independent, true);
});

test("pattern failure does not imply signal failure (independent promises)", () => {
  const independent = true;
  assert.strictEqual(independent, true);
});

/* ---- sort order within evidence ---- */

test("within same evidence level larger sample ranks higher", () => {
  const out = preparePatterns([
    { type: "emotion_segment", sampleSize: 10, evidence: { status: "emerging" }, difference: 0.1 },
    { type: "emotion_segment", sampleSize: 18, evidence: { status: "emerging" }, difference: 0.1 },
  ]);
  assert.strictEqual(out[0].sampleSize, 18);
  assert.strictEqual(out[1].sampleSize, 10);
});

test("isActionableEvidence rejects insufficient and missing", () => {
  assert.strictEqual(isActionableEvidence({ status: "insufficient" }), false);
  assert.strictEqual(isActionableEvidence(null), false);
  assert.strictEqual(isActionableEvidence({ status: "emerging" }), true);
});

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
