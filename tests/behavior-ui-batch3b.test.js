/**
 * Behavior UI Batch 3B — Legacy Edge/Leak consolidation
 * ("Historical P&L groups" wrapper + legacyGroupRow()).
 *
 * Source-level deterministic tests. These are NOT browser tests.
 * The real public/js/insights-reports.js is executed inside a Node `vm`
 * sandbox with stubbed DOM / api helpers (E / C / M mirror utils.js), so
 * assertions run against the shipped code. Run:
 *   node tests/behavior-ui-batch3b.test.js
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
const APP = read("public/app.js");
const PREMIUM = read("routes/premium-routes.js");

/* Active Insights page markup only */
const INSIGHTS_HTML = (() => {
  const start = HTML.indexOf('<section id="insights"');
  assert.ok(start >= 0, "insights section present");
  return HTML.slice(start, HTML.indexOf("</section>", start));
})();

/* The Batch 3B wrapper */
const WRAP_START = INSIGHTS_HTML.indexOf('<details class="legacy-groups"');
const WRAP_END = INSIGHTS_HTML.indexOf("</details>");
const WRAPPER = INSIGHTS_HTML.slice(WRAP_START, WRAP_END + "</details>".length);

/* The Batch 3B CSS block (marker to end of file) */
const CSS_3B = CSS.slice(
  CSS.indexOf("Behavior UI Batch 3B — Historical P&L groups")
);

/* ---- sandbox that runs the real frontend module (E/C/M as utils.js) ---- */
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
    M: (n) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      }).format(Number(n || 0)),
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

/* Legacy Premium edge objects exactly as the API shapes them (placeholders) */
const legacyEdge = (name, trades, pnl) => ({
  name,
  trades,
  pnl,
  winRate: 0,
  profitFactor: 0,
  avgR: 0,
});

const FIXTURE = {
  edge: {
    symbols: [
      legacyEdge("EURUSD", 6, 120),
      legacyEdge("GBPUSD", 3, -45),
      legacyEdge("USDJPY", 8, 15),
      legacyEdge("XAUUSD", 4, -10),
    ],
    strategies: [legacyEdge("Breakout", 9, 300), legacyEdge("Reversal", 4, -200)],
    setups: [legacyEdge("Pullback", 5, 10)],
    sessions: [],
    markets: [],
  },
  coach: [
    { type: "EDGE", title: "Strongest edge: Breakout", body: "9 trades · 300.00 P&L." },
    { type: "LEAK", title: "Biggest performance leak is Reversal", body: "4 trades · -200.00 P&L." },
    { type: "RISK", title: "2 trades were risk outliers", body: "1.5× avg." },
    { type: "DISCIPLINE", title: "Your worst losing streak is 4", body: "Hard stop." },
    { type: "PROCESS", title: "3 trades have process flags", body: "Review." },
  ],
  psychology: {
    emotions: [{ name: "Calm", trades: 10, pnl: 50, winRate: 60 }],
    confidence: [{ label: "61-80", min: 61, max: 80, trades: 12, pnl: -30, winRate: 41.7, avgR: -0.2 }],
  },
  processFlags: [
    { symbol: "EURUSD", date: "2026-10-01", pnl: -20, reasons: ["No stop loss recorded"] },
  ],
};

const textOf = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/* =========================================================
   1. Behavioral sections present and in order
   ========================================================= */
test("1. Behavioral sections remain present, unchanged and in order", () => {
  const ids = [
    'id="traderBaseline"',
    'id="behaviorPatterns"',
    'id="performanceDrivers"',
    'id="coachCards"',
    '<details class="legacy-groups"',
    'id="edgeList"',
    'id="leakList"',
    'id="psychList"',
    'id="processList"',
  ];
  const idx = ids.map((k) => INSIGHTS_HTML.indexOf(k));
  assert.ok(idx.every((i) => i >= 0), "all anchors present: " + idx);
  assert.deepStrictEqual([...idx].sort((a, b) => a - b), idx);
  for (const s of [
    "Behavioral Patterns",
    "Performance Drivers",
    "Patterns detected from your trading history. Evidence strength determines what is surfaced.",
    "Where your trading is performing above or below your baseline.",
    'id="behaviorPatternsBody"',
    'id="performanceDriversBody"',
  ]) {
    assert.ok(HTML.includes(s), "missing: " + s);
  }
  for (const fn of ["loadTraderBaseline", "loadBehaviorPatterns", "loadBehaviorSignals", "renderDriverCard", "renderPatternCard"]) {
    assert.ok(new RegExp("function " + fn + "\\(").test(JS), fn);
  }
});

/* =========================================================
   2–3. Wrapper: native <details>, collapsed, correct summary
   ========================================================= */
test("2. Wrapper is a native <details>, collapsed by default", () => {
  assert.ok(WRAP_START >= 0 && WRAP_END > WRAP_START);
  const openTag = WRAPPER.slice(0, WRAPPER.indexOf(">") + 1);
  assert.ok(!/\bopen\b/i.test(openTag), "must not be open by default: " + openTag);
  assert.strictEqual((HTML.match(/<details class="legacy-groups"/g) || []).length, 1);
  /* summary is the first child */
  assert.ok(/^<details class="legacy-groups">\s*<summary>/.test(WRAPPER));
});

test("2b. Summary title and explanation say historical P&L, not evidence", () => {
  const summary = WRAPPER.slice(WRAPPER.indexOf("<summary>"), WRAPPER.indexOf("</summary>"));
  const t = textOf(summary).replace(/&amp;/g, "&");
  assert.ok(t.includes("Historical P&L groups"));
  assert.ok(/ranked by historical P&L/i.test(t));
  assert.ok(/not verified evidence/i.test(t));
  assert.ok(/Performance Drivers/.test(t));
});

test("3. Both legacy panels and their Batch 3A subtitles are inside the wrapper", () => {
  for (const s of [
    "Highest P&amp;L groups",
    "Groups with at least 3 trades, ranked by historical P&amp;L. Legacy performance grouping &mdash; not a verified edge.",
    "Lowest P&amp;L groups",
    "Historical underperformance; not a statistically verified leak.",
    'id="edgeList"',
    'id="leakList"',
  ]) {
    assert.ok(WRAPPER.includes(s), "inside wrapper: " + s);
  }
  assert.strictEqual((WRAPPER.match(/panel legacy-intel/g) || []).length, 2);
});

test("3b. Psychology and Process Review are outside the wrapper and unchanged", () => {
  const after = INSIGHTS_HTML.slice(WRAP_END);
  for (const s of [
    "Psychology impact",
    "Confidence and pre-trade emotion versus results.",
    'id="psychList"',
    "Process review",
    "Flags generated from your recorded trade data.",
    'id="processList"',
  ]) {
    assert.ok(after.includes(s), "after wrapper: " + s);
    assert.ok(!WRAPPER.includes(s), "not inside wrapper: " + s);
  }
});

/* =========================================================
   4–5. legacyGroupRow: only name, trade count, P&L
   ========================================================= */
test("4. legacyGroupRow renders only name, trade count and P&L", () => {
  const { sandbox } = makeSandbox(FIXTURE);
  const html = vm.runInContext(
    "legacyGroupRow({name:'EURUSD',trades:6,pnl:120,winRate:0,profitFactor:0,avgR:0})",
    sandbox
  );
  const t = textOf(html);
  assert.ok(t.includes("EURUSD"));
  assert.ok(t.includes("6 trades"));
  assert.ok(t.includes("$120.00"));
  assert.ok(!/win rate|% win|avg|\bPF\b|∞|0\.00R/i.test(t), "no metric text: " + t);
  assert.ok(html.includes('class="positive"'));
});

test("4b. Even non-zero legacy metric fields are not rendered (not measured here)", () => {
  const { sandbox } = makeSandbox(FIXTURE);
  const html = vm.runInContext(
    "legacyGroupRow({name:'X',trades:1,pnl:-5,winRate:55.5,profitFactor:1.7,avgR:0.4})",
    sandbox
  );
  const t = textOf(html);
  assert.ok(t.includes("1 trade") && !t.includes("1 trades"));
  assert.ok(t.includes("-$5.00"));
  assert.ok(!/55|1\.7|0\.4|win|PF|avg/i.test(t.replace("-$5.00", "")));
  assert.ok(html.includes('class="negative"'));
});

test("5. insights() renders edge/leak lists with no win rate / avgR / PF", async () => {
  const { sandbox, els } = makeSandbox(FIXTURE);
  await sandbox.insights();
  for (const id of ["#edgeList", "#leakList"]) {
    const t = textOf(els[id].innerHTML);
    assert.ok(t.length > 0);
    assert.ok(!/win rate|R avg|\bPF\b|∞/i.test(t), id + ": " + t);
  }
  assert.ok(textOf(els["#edgeList"].innerHTML).includes("9 trades"));
  assert.ok(textOf(els["#edgeList"].innerHTML).includes("$300.00"));
});

/* =========================================================
   6. Ranking / filter / cap unchanged; legacy P&L still accessible
   ========================================================= */
test("6. Ordering, pnl<0 filter and 6-row cap are unchanged", async () => {
  const many = {
    ...FIXTURE,
    edge: {
      symbols: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => legacyEdge("S" + i, 3 + i, i * 10)),
      strategies: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => legacyEdge("L" + i, 3 + i, -i * 10)),
      setups: [],
    },
  };
  const { sandbox, els } = makeSandbox(many);
  await sandbox.insights();
  const edge = els["#edgeList"].innerHTML;
  const leak = els["#leakList"].innerHTML;
  assert.strictEqual((edge.match(/insight-row-compact/g) || []).length, 6);
  assert.strictEqual((leak.match(/insight-row-compact/g) || []).length, 6);
  /* highest P&L first */
  assert.ok(edge.indexOf(">S8<") < edge.indexOf(">S7<"));
  assert.ok(edge.indexOf(">S3<") > 0 && !edge.includes(">S2<"));
  /* lowest P&L first, negative groups only */
  assert.ok(leak.indexOf(">L8<") < leak.indexOf(">L7<"));
  assert.ok(!/>S\d</.test(leak));
});

test("6b. Frontend ranking source lines are unchanged", () => {
  const body = JS.slice(JS.indexOf("async function insights()"), JS.indexOf("async function reports()"));
  assert.ok(body.includes(".sort((a,b)=>b.pnl-a.pnl)"));
  assert.ok(body.includes(".sort((a,b)=>a.pnl-b.pnl)"));
  assert.ok(body.includes(".filter(x=>x.pnl<0)"));
  assert.strictEqual((body.match(/\.slice\(0,6\)/g) || []).length, 2);
  assert.ok(body.includes("strong.map(legacyGroupRow)"));
  assert.ok(body.includes("leaks.map(legacyGroupRow)"));
});

/* =========================================================
   7. Null values and empty states
   ========================================================= */
test("7. Null / missing / non-numeric values render safely, never as 0 or NaN", () => {
  const { sandbox } = makeSandbox(FIXTURE);
  const run = (arg) => vm.runInContext(`legacyGroupRow(${arg})`, sandbox);
  for (const arg of ["null", "undefined", "{}", "{name:null,trades:null,pnl:null}", "{name:'A',trades:'x',pnl:'y'}"]) {
    const html = run(arg);
    const t = textOf(html);
    assert.ok(!/NaN|undefined|null|Infinity/.test(t), arg + " -> " + t);
    assert.ok(!/\$0\.00/.test(t), "must not manufacture $0.00 for missing P&L: " + arg + " -> " + t);
    assert.ok(t.includes("—"), "unavailable marker for " + arg);
  }
  /* a genuine zero P&L is a real value and still shows */
  assert.ok(textOf(run("{name:'Z',trades:3,pnl:0}")).includes("$0.00"));
  assert.ok(textOf(run("{name:'Z',trades:'3',pnl:'12.5'}")).includes("3 trades"));
});

test("7b. Empty payload keeps neutral empty-state copy", async () => {
  const { sandbox, els } = makeSandbox({ edge: {}, coach: [], psychology: {}, processFlags: [] });
  await sandbox.insights();
  assert.ok(els["#edgeList"].innerHTML.includes("No performance groups yet."));
  assert.ok(els["#leakList"].innerHTML.includes("No negative-P&amp;L groups"));
});

test("7c. Group names are HTML-escaped", () => {
  const { sandbox } = makeSandbox(FIXTURE);
  const html = vm.runInContext(
    `legacyGroupRow({name:'<img src=x onerror=1>',trades:3,pnl:1})`,
    sandbox
  );
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
});

/* =========================================================
   8. Shared insightRow / Psychology / Process untouched
   ========================================================= */
test("8. insightRow() is unchanged and still feeds the Psychology list", async () => {
  const fn = JS.slice(JS.indexOf("function insightRow"), JS.indexOf("function legacyGroupRow"));
  /* original expressions are still present (regression guard — NOT an endorsement;
     the known Psychology renderer defects are recorded for a separate batch) */
  assert.ok(fn.includes("Number(x.winRate||0).toFixed(1)}% win rate"));
  assert.ok(fn.includes("Number(x.avgR||0).toFixed(2)}R avg"));
  assert.ok(fn.includes("Number.isFinite(Number(x.profitFactor))"));
  assert.ok(JS.includes("psych.map(insightRow).join('')"));

  const { sandbox, els } = makeSandbox(FIXTURE);
  await sandbox.insights();
  const expected = [
    ...FIXTURE.psychology.confidence,
    ...FIXTURE.psychology.emotions,
  ]
    .map((x) => sandbox.insightRow(x))
    .join("");
  assert.strictEqual(els["#psychList"].innerHTML, expected);
});

test("8b. Process Review rendering is unchanged", async () => {
  const { sandbox, els } = makeSandbox(FIXTURE);
  await sandbox.insights();
  const h = els["#processList"].innerHTML;
  assert.ok(h.includes("EURUSD") && h.includes("No stop loss recorded"));
  assert.ok(h.includes('class="flag"'));
});

/* =========================================================
   9. Coach labels and rules preserved
   ========================================================= */
test("9. Coach PERFORMANCE / UNDERPERFORMANCE and other cards preserved", async () => {
  const { sandbox, els } = makeSandbox(FIXTURE);
  await sandbox.insights();
  const c = els["#coachCards"].innerHTML;
  assert.ok(c.includes('<span class="tag">PERFORMANCE</span>'));
  assert.ok(c.includes('<span class="tag">UNDERPERFORMANCE</span>'));
  assert.ok(c.includes("A higher-performing group in your current history is Breakout"));
  assert.ok(c.includes("A lower-performing group in your current history is Reversal"));
  for (const ty of ["RISK", "DISCIPLINE", "PROCESS"]) {
    assert.ok(c.includes(`<span class="tag">${ty}</span>`), ty);
  }
  assert.ok(!/>EDGE<|>LEAK<|Strongest edge|Biggest performance leak/.test(c));
  assert.ok(/coach-positive">\s*<span class="tag">PERFORMANCE/.test(c));
  assert.ok(/coach-negative">\s*<span class="tag">UNDERPERFORMANCE/.test(c));
});

/* =========================================================
   10. Reports consumers and API usage unchanged
   ========================================================= */
test("10. reports() and /api/premium usage unchanged; Reports ignores edge data", () => {
  const rep = JS.slice(JS.indexOf("async function reports()"));
  assert.ok(rep.includes("'/api/premium?'+premiumQuery()"));
  assert.ok(rep.includes("d.weekly") && rep.includes("d.risk"));
  assert.ok(!/d\.edge|legacyGroupRow|insightRow/.test(rep));
  assert.strictEqual((JS.match(/'\/api\/premium\?'\+premiumQuery\(\)/g) || []).length, 2);
  for (const ep of ["baseline", "patterns", "signals"]) {
    assert.ok(JS.includes(`'/api/behavior/${ep}?'+behaviorQuery()`), ep);
  }
});

test("10b. Backend contract untouched (placeholders still emitted, so frontend must not render them)", () => {
  assert.ok(/winRate:\s*0,\s*profitFactor:\s*0,\s*avgR:\s*0/.test(PREMIUM));
  assert.ok(PREMIUM.includes("Number(x.trades) >= 3"));
  assert.ok(PREMIUM.includes('type: "EDGE"') && PREMIUM.includes('type: "LEAK"'));
});

/* =========================================================
   11. Filters / refresh intact; wrapper never re-rendered
   ========================================================= */
test("11. Filter queries and refresh wiring unchanged", () => {
  assert.ok(JS.includes("account:state.account||''"));
  assert.ok(JS.includes("range:state.range||'year'"));
  assert.ok(JS.includes("...(typeof dateRange==='function'?dateRange():{})"));
  assert.ok(/\$\('#refreshInsights'\)\.onclick=\(\)=>\s*insights\(\)/.test(APP));
  assert.ok(/if\(p==='insights'\)\s*insights\(\)/.test(APP));
  /* behavioral loads still start before the premium fetch */
  const body = JS.slice(JS.indexOf("async function insights()"), JS.indexOf("async function reports()"));
  assert.ok(body.indexOf("loadTraderBaseline()") < body.indexOf("'/api/premium?'"));
  assert.ok(body.includes("Promise.allSettled([baselinePromise,patternsPromise,signalsPromise])"));
});

test("11b. insights() never rewrites the wrapper, so open/closed state survives refresh", async () => {
  assert.ok(!JS.includes("legacy-groups"));
  const { sandbox, els } = makeSandbox(FIXTURE);
  await sandbox.insights();
  await sandbox.insights();
  assert.deepStrictEqual(
    Object.keys(els).sort(),
    [
      "#behaviorPatternsBody",
      "#coachCards",
      "#edgeList",
      "#leakList",
      "#performanceDriversBody",
      "#processList",
      "#psychList",
      "#traderBaseline",
    ]
  );
});

/* =========================================================
   12. Visual subordination, theme and mobile safety (CSS source)
   ========================================================= */
test("12. Legacy wrapper is visually quieter than Behavioral sections", () => {
  const titleSize = Number(/\.legacy-groups-title\{[^}]*font-size:(\d+)px/.exec(CSS_3B)[1]);
  const titleWeight = Number(/\.legacy-groups-title\{[^}]*font-weight:(\d+)/.exec(CSS_3B)[1]);
  const behSize = Number(/\.behavior-section \.panel-head h2\{[^}]*font-size:(\d+)px/.exec(CSS)[1]);
  const behWeight = Number(/\.behavior-section \.panel-head h2\{[^}]*font-weight:(\d+)/.exec(CSS)[1]);
  assert.ok(titleSize < behSize, `${titleSize} < ${behSize}`);
  assert.ok(titleWeight < behWeight, `${titleWeight} < ${behWeight}`);
  /* Behavioral heading rule itself is unchanged */
  assert.strictEqual(behSize, 16);
  assert.strictEqual(behWeight, 800);
});

test("12b. Wrapper CSS is theme-safe, accessible and touch-friendly", () => {
  assert.ok(CSS_3B.length > 200, "3B CSS block found");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(CSS_3B.replace(/\\25B8/g, "")), "no hard-coded hex colours");
  assert.ok(!/data-theme/.test(CSS_3B), "uses variables, no theme forks");
  assert.ok(/var\(--line\)/.test(CSS_3B) && /var\(--muted\)/.test(CSS_3B) && /var\(--text\)/.test(CSS_3B));
  assert.ok(/min-height:var\(--touch-min,44px\)/.test(CSS_3B));
  assert.ok(/summary:focus-visible/.test(CSS_3B));
  assert.ok(/::-webkit-details-marker\{\s*display:none/.test(CSS_3B));
  assert.ok(/\[open\] > summary::before\{\s*transform:rotate\(90deg\)/.test(CSS_3B));
  assert.ok(/\.insight-row\.insight-row-compact\{\s*grid-template-columns:1fr auto/.test(CSS_3B));
});

test("12c. CSS is well-formed; no existing grid/media rule was altered", () => {
  assert.strictEqual(CSS.split("{").length, CSS.split("}").length);
  /* the wrapper block adds no @media and does not redefine .dashboard-grid columns */
  assert.ok(!/@media/.test(CSS_3B));
  assert.ok(!/grid-template-columns:[^;}]*\}\s*\.dashboard-grid/.test(CSS_3B));
  assert.ok(!/\.dashboard-grid\{[^}]*grid-template-columns/.test(CSS_3B));
  /* Batch 3A hook preserved */
  assert.ok(/\.legacy-intel \.panel-head p\{/.test(CSS));
});

/* =========================================================
   13. No unsupported evidence claims
   ========================================================= */
test("13. No evidence language introduced for legacy data", async () => {
  const forbidden = /\b(strong|meaningful|emerging|insufficient|high confidence)\b/i;
  const stripNegations = (s) =>
    s.replace(/not (a )?(statistically )?verified( evidence| edge| leak)?/gi, "");
  assert.ok(!forbidden.test(textOf(WRAPPER)), "wrapper text");
  assert.ok(!/verified/i.test(stripNegations(textOf(WRAPPER).replace(/&mdash;/g, "-"))));

  const { sandbox, els } = makeSandbox(FIXTURE);
  await sandbox.insights();
  const rows = els["#edgeList"].innerHTML + els["#leakList"].innerHTML;
  assert.ok(!/evidence-badge|confidence-badge|bcard/.test(rows));
  assert.ok(!forbidden.test(textOf(rows)));
  const fn = JS.slice(JS.indexOf("function legacyGroupRow"), JS.indexOf("function coachTypeLabel"))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/evidence/i.test(fn));
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
