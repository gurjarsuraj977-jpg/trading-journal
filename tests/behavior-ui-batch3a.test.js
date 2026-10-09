/**
 * Behavior UI Batch 3A — Evidence & Language Alignment.
 *
 * Source-level deterministic tests. These are NOT browser tests.
 * The real public/js/insights-reports.js is executed inside a Node `vm`
 * sandbox with stubbed DOM / api helpers, so assertions run against the
 * shipped code rather than a mirror of it. Run:
 *   node tests/behavior-ui-batch3a.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let pass = 0;
let fail = 0;
const pending = [];
function test(name, fn) {
  pending.push({ name, fn });
}

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const HTML = read("public/index.html");
const JS = read("public/js/insights-reports.js");
const CSS = read("public/styles.css");
const PREMIUM = read("routes/premium-routes.js");

/* Active Insights page markup only (not Reports, Ghost AI chips, etc.) */
const INSIGHTS_HTML = (() => {
  const start = HTML.indexOf('<section id="insights"');
  assert.ok(start >= 0, "insights section present");
  const end = HTML.indexOf("</section>", start);
  return HTML.slice(start, end);
})();

/* ---- sandbox that runs the real frontend module ---- */
function makeSandbox(premiumPayload) {
  const els = {};
  const calls = [];
  const sandbox = {
    state: { account: "", range: "year" },
    E: (x) =>
      String(x ?? "").replace(/[&<>"']/g, (m) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[m])),
    C: (n) => (Number(n || 0) >= 0 ? "positive" : "negative"),
    M: (n) => "$" + Number(n || 0).toFixed(2),
    formatDay: (d) => String(d),
    $: (sel) => (els[sel] = els[sel] || { innerHTML: "" }),
    api: async (url) => {
      calls.push(url);
      if (url.startsWith("/api/premium")) return premiumPayload;
      if (url.startsWith("/api/behavior/baseline"))
        return { ok: true, baseline: { sampleSize: 0 } };
      if (url.startsWith("/api/behavior/patterns"))
        return { ok: true, patterns: [] };
      if (url.startsWith("/api/behavior/signals"))
        return { ok: true, signals: { segments: [] } };
      throw new Error("unexpected url " + url);
    },
    URLSearchParams,
    Number,
    String,
    Array,
    Math,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(JS, sandbox, { filename: "insights-reports.js" });
  return { sandbox, els, calls };
}

const legacyEdge = (name, trades, pnl) => ({
  name,
  trades,
  pnl,
  winRate: 0,
  profitFactor: 0,
  avgR: 0,
});

const PREMIUM_FIXTURE = {
  edge: {
    symbols: [legacyEdge("EURUSD", 6, 120), legacyEdge("GBPUSD", 3, -45)],
    strategies: [legacyEdge("Breakout", 9, 300), legacyEdge("Reversal", 4, -200)],
    setups: [legacyEdge("Pullback", 5, 10)],
    sessions: [],
    markets: [],
  },
  coach: [
    { type: "EDGE", title: "Strongest edge: Breakout", body: "9 trades · 300.00 P&L." },
    {
      type: "LEAK",
      title: "Biggest performance leak is Reversal",
      body: "4 trades · -200.00 P&L.",
    },
    { type: "RISK", title: "2 trades were risk outliers", body: "1.5× avg." },
    { type: "DISCIPLINE", title: "Your worst losing streak is 4", body: "Hard stop." },
    { type: "PROCESS", title: "3 trades have process flags", body: "Review." },
  ],
  psychology: { emotions: [], confidence: [] },
  processFlags: [],
};

/* =========================================================
   1–2. Legacy headings no longer used in the active Insights UI
   ========================================================= */
test("1. 'Strongest edges' wording is gone from the Insights UI", () => {
  assert.ok(!/strongest\s+edges?/i.test(INSIGHTS_HTML));
  assert.ok(INSIGHTS_HTML.includes("Highest P&amp;L groups"));
  assert.ok(/not a verified edge/i.test(INSIGHTS_HTML));
});

test("2. 'Biggest leaks' wording is gone from the Insights UI", () => {
  assert.ok(!/biggest\s+(performance\s+)?leaks?/i.test(INSIGHTS_HTML));
  assert.ok(INSIGHTS_HTML.includes("Lowest P&amp;L groups"));
  assert.ok(/not a statistically verified leak/i.test(INSIGHTS_HTML));
});

test("2b. Insights intro no longer promises 'edges' / 'leaks'", () => {
  const head = INSIGHTS_HTML.slice(0, INSIGHTS_HTML.indexOf('id="traderBaseline"'));
  assert.ok(!/\bedges?\b/i.test(head));
  assert.ok(!/\bleaks?\b/i.test(head));
});

test("2c. Legacy panels carry the subtle hierarchy hook; ids unchanged", () => {
  assert.strictEqual((INSIGHTS_HTML.match(/panel legacy-intel/g) || []).length, 2);
  assert.ok(INSIGHTS_HTML.includes('id="edgeList"'));
  assert.ok(INSIGHTS_HTML.includes('id="leakList"'));
  assert.ok(/\.legacy-intel \.panel-head p\{/.test(CSS));
});

/* =========================================================
   3–4. Coach EDGE / LEAK presentation
   ========================================================= */
test("3. Coach EDGE no longer claims a verified edge", () => {
  const { sandbox } = makeSandbox(PREMIUM_FIXTURE);
  assert.strictEqual(vm.runInContext("coachTypeLabel('EDGE')", sandbox), "PERFORMANCE");
  const t = vm.runInContext(
    "coachTitleText('EDGE','Strongest edge: Breakout')",
    sandbox
  );
  assert.strictEqual(
    t,
    "A higher-performing group in your current history is Breakout"
  );
  assert.ok(!/edge/i.test(t));
});

test("4. Coach LEAK no longer claims a verified leak", () => {
  const { sandbox } = makeSandbox(PREMIUM_FIXTURE);
  assert.strictEqual(
    vm.runInContext("coachTypeLabel('LEAK')", sandbox),
    "UNDERPERFORMANCE"
  );
  const t = vm.runInContext(
    "coachTitleText('LEAK','Biggest performance leak is Reversal')",
    sandbox
  );
  assert.strictEqual(
    t,
    "A lower-performing group in your current history is Reversal"
  );
  assert.ok(!/leak/i.test(t));
});

test("4b. Other coach types and unknown titles pass through unchanged", () => {
  const { sandbox } = makeSandbox(PREMIUM_FIXTURE);
  for (const ty of ["RISK", "DISCIPLINE", "PROCESS", "GHOST"]) {
    assert.strictEqual(vm.runInContext(`coachTypeLabel('${ty}')`, sandbox), ty);
  }
  assert.strictEqual(
    vm.runInContext("coachTitleText('RISK','2 trades were risk outliers')", sandbox),
    "2 trades were risk outliers"
  );
  /* unrecognised EDGE/LEAK title shapes are not mangled */
  assert.strictEqual(
    vm.runInContext("coachTitleText('EDGE','Something else')", sandbox),
    "Something else"
  );
  assert.strictEqual(vm.runInContext("coachTitleText('EDGE',null)", sandbox), "");
  assert.strictEqual(vm.runInContext("coachTypeLabel(undefined)", sandbox), "");
});

/* =========================================================
   5. Behavioral Intelligence labels unchanged
   ========================================================= */
test("5. Behavioral section labels and containers unchanged", () => {
  for (const s of [
    'id="traderBaseline"',
    "BEHAVIORAL CONTEXT",
    "Behavioral Patterns",
    "Patterns detected from your trading history. Evidence strength determines what is surfaced.",
    "Performance Drivers",
    "Where your trading is performing above or below your baseline.",
    'id="behaviorPatternsBody"',
    'id="performanceDriversBody"',
  ]) {
    assert.ok(HTML.includes(s) || JS.includes(s), "missing: " + s);
  }
  /* section order: baseline → patterns → drivers → coach cards */
  const order = [
    'id="traderBaseline"',
    'id="behaviorPatterns"',
    'id="performanceDrivers"',
    'id="coachCards"',
    'id="edgeList"',
    'id="leakList"',
    'id="psychList"',
    'id="processList"',
  ].map((k) => INSIGHTS_HTML.indexOf(k));
  assert.ok(order.every((i) => i >= 0));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
});

test("5b. Behavioral JS helpers and CSS still present and unchanged in form", () => {
  for (const fn of [
    "loadTraderBaseline",
    "loadBehaviorPatterns",
    "loadBehaviorSignals",
    "renderDriverCard",
    "renderPatternCard",
    "prepareDrivers",
    "preparePatterns",
  ]) {
    assert.ok(new RegExp("function " + fn + "\\(").test(JS), fn);
  }
  assert.ok(/\.behavior-section \.panel-head h2\{\s*margin:2px 0 0;\s*font-size:16px;\s*font-weight:800;/.test(CSS));
});

/* =========================================================
   6. No fabricated evidence for Premium data
   ========================================================= */
test("6. Legacy edge/leak/coach render shows no evidence status", async () => {
  const { sandbox, els } = makeSandbox(PREMIUM_FIXTURE);
  await sandbox.insights();
  const legacy =
    els["#coachCards"].innerHTML +
    els["#edgeList"].innerHTML +
    els["#leakList"].innerHTML;
  assert.ok(legacy.length > 0);
  assert.ok(!/evidence-badge|confidence-badge|bcard/i.test(legacy));
  assert.ok(!/\b(Strong|Meaningful|Emerging|Insufficient|Verified)\b/.test(legacy));
  assert.ok(!/High confidence/i.test(legacy));
});

test("6b. insightRow / coach path never reads an evidence field", () => {
  const row = JS.slice(JS.indexOf("function insightRow"), JS.indexOf("function premiumQuery"));
  assert.ok(!/evidence/i.test(row.replace(/\/\*[\s\S]*?\*\//g, "")));
});

/* =========================================================
   7. Legacy API data still accepted / rendered
   ========================================================= */
test("7. Legacy Premium payload still renders edges, leaks, coach", async () => {
  const { sandbox, els, calls } = makeSandbox(PREMIUM_FIXTURE);
  await sandbox.insights();

  assert.ok(calls.some((u) => u.startsWith("/api/premium?")), "still calls /api/premium");
  for (const ep of ["baseline", "patterns", "signals"]) {
    assert.ok(calls.some((u) => u.startsWith("/api/behavior/" + ep + "?")), ep);
  }

  const edge = els["#edgeList"].innerHTML;
  assert.ok(edge.includes("Breakout") && edge.includes("EURUSD"));
  /* ranked by P&L desc (unchanged sort): Breakout 300 before EURUSD 120 */
  assert.ok(edge.indexOf("Breakout") < edge.indexOf("EURUSD"));

  const leak = els["#leakList"].innerHTML;
  assert.ok(leak.includes("Reversal") && leak.includes("GBPUSD"));
  /* most negative first; only negative P&L groups */
  assert.ok(leak.indexOf("Reversal") < leak.indexOf("GBPUSD"));
  assert.ok(!leak.includes("EURUSD") && !leak.includes("Pullback"));

  const coach = els["#coachCards"].innerHTML;
  assert.ok(coach.includes('<span class="tag">PERFORMANCE</span>'));
  assert.ok(coach.includes('<span class="tag">UNDERPERFORMANCE</span>'));
  assert.ok(coach.includes("A higher-performing group in your current history is Breakout"));
  assert.ok(coach.includes("A lower-performing group in your current history is Reversal"));
  assert.ok(!/Strongest edge|Biggest performance leak|>EDGE<|>LEAK</.test(coach));
  /* body text untouched */
  assert.ok(coach.includes("9 trades · 300.00 P&amp;L."));
  /* non-edge/leak cards unchanged */
  assert.ok(coach.includes('<span class="tag">RISK</span>'));
  assert.ok(coach.includes('<span class="tag">DISCIPLINE</span>'));
  assert.ok(coach.includes('<span class="tag">PROCESS</span>'));
});

test("7b. Card colour classes still keyed on the raw backend type", async () => {
  const { sandbox, els } = makeSandbox(PREMIUM_FIXTURE);
  await sandbox.insights();
  const coach = els["#coachCards"].innerHTML;
  assert.ok(/coach-positive">\s*<span class="tag">PERFORMANCE/.test(coach));
  assert.ok(/coach-negative">\s*<span class="tag">UNDERPERFORMANCE/.test(coach));
  assert.ok(/coach-neutral">\s*<span class="tag">RISK/.test(coach));
});

test("7c. Empty legacy payload uses neutral empty-state copy", async () => {
  const { sandbox, els } = makeSandbox({ edge: {}, coach: [], psychology: {}, processFlags: [] });
  await sandbox.insights();
  assert.ok(els["#edgeList"].innerHTML.includes("No performance groups yet."));
  assert.ok(els["#leakList"].innerHTML.includes("No negative-P&amp;L groups"));
  assert.ok(!/\bedge\b/i.test(els["#edgeList"].innerHTML + els["#leakList"].innerHTML));
});

/* =========================================================
   8. Calculations / sorting / thresholds / API unchanged
   ========================================================= */
test("8. Frontend ranking, filtering and slicing unchanged", () => {
  const body = JS.slice(JS.indexOf("async function insights()"), JS.indexOf("async function reports()"));
  assert.ok(body.includes(".sort((a,b)=>b.pnl-a.pnl)"));
  assert.ok(body.includes(".sort((a,b)=>a.pnl-b.pnl)"));
  assert.ok(body.includes(".filter(x=>x.pnl<0)"));
  assert.strictEqual((body.match(/\.slice\(0,6\)/g) || []).length, 2);
  assert.ok(body.includes("'/api/premium?'+premiumQuery()"));
  /* insightRow formatting unchanged */
  assert.ok(JS.includes("Number(x.winRate||0).toFixed(1)}% win rate"));
  assert.ok(JS.includes("Number(x.avgR||0).toFixed(2)}R avg"));
});

test("8b. Backend still emits legacy EDGE/LEAK payload (presentation-only shim)", () => {
  /* Batch 3A is frontend-only: the Premium contract must be untouched. */
  assert.ok(PREMIUM.includes('type: "EDGE"'));
  assert.ok(PREMIUM.includes('type: "LEAK"'));
  assert.ok(PREMIUM.includes("`Strongest edge: ${best.name}`"));
  assert.ok(PREMIUM.includes("`Biggest performance leak is ${worst.name}`"));
  assert.ok(PREMIUM.includes("Number(x.trades) >= 3"));
  assert.ok(PREMIUM.includes(".filter((x) => x.trades >= 5)"));
});

test("8c. Frontend rewrite prefixes match the backend's literal titles", () => {
  const edge = PREMIUM.match(/`(Strongest edge: )\$\{best\.name\}`/);
  const leak = PREMIUM.match(/`(Biggest performance leak is )\$\{worst\.name\}`/);
  assert.ok(edge && leak);
  const { sandbox } = makeSandbox(PREMIUM_FIXTURE);
  assert.notStrictEqual(
    vm.runInContext(`coachTitleText('EDGE', ${JSON.stringify(edge[1] + "X")})`, sandbox),
    edge[1] + "X"
  );
  assert.notStrictEqual(
    vm.runInContext(`coachTitleText('LEAK', ${JSON.stringify(leak[1] + "X")})`, sandbox),
    leak[1] + "X"
  );
});

test("8d. Coach titles are HTML-escaped after rewrite", async () => {
  const { sandbox, els } = makeSandbox({
    ...PREMIUM_FIXTURE,
    coach: [{ type: "EDGE", title: "Strongest edge: <img src=x onerror=1>", body: "b" }],
  });
  await sandbox.insights();
  assert.ok(!els["#coachCards"].innerHTML.includes("<img"));
  assert.ok(els["#coachCards"].innerHTML.includes("&lt;img"));
});

(async () => {
  for (const { name, fn } of pending) {
    try {
      await fn();
      console.log("PASS  " + name);
      pass++;
    } catch (e) {
      console.log("FAIL  " + name + "  ->  " + e.message);
      fail++;
    }
  }
  console.log("");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
