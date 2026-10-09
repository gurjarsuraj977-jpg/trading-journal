function insightRow(x){
  return`
    <div class="insight-row">
      <div>
        <b>${E(x.name)}</b>
        <small>
          ${x.trades} trades ·
          ${Number(x.winRate||0).toFixed(1)}% win rate ·
          ${Number(x.avgR||0).toFixed(2)}R avg
        </small>
      </div>

      <strong class="${C(x.pnl)}">
        ${M(x.pnl)}
      </strong>

      <small>
        PF ${
          Number.isFinite(Number(x.profitFactor))?
            Number(x.profitFactor).toFixed(2):
            '∞'
        }
      </small>
    </div>
  `;
}

/* ============================================================
   Behavior UI Batch 3A — legacy coach presentation language
   Presentation only. The API payload (type/title/body), the card
   CSS class (keyed on the raw type) and every calculation are
   unchanged. Legacy Premium has no evidence model, so no evidence
   status is attached here.
   ============================================================ */
const COACH_TYPE_LABELS={
  EDGE:'PERFORMANCE',
  LEAK:'UNDERPERFORMANCE'
};

function coachTypeLabel(type){
  const t=String(type||'');
  return COACH_TYPE_LABELS[t]||t;
}

/* Rewrites the known legacy title prefixes; any other title is left as-is */
function coachTitleText(type,title){
  const t=String(title||'');
  if(type==='EDGE'&&/^Strongest edge:\s*/i.test(t))
    return t.replace(/^Strongest edge:\s*/i,
      'A higher-performing group in your current history is ');
  if(type==='LEAK'&&/^Biggest performance leak is\s*/i.test(t))
    return t.replace(/^Biggest performance leak is\s*/i,
      'A lower-performing group in your current history is ');
  return t;
}

function premiumQuery(){
  /* tz aligns Reports with Unified Metrics local-calendar contract */
  return new URLSearchParams({
    account:state.account||'',
    range:state.range||'year',
    tz:typeof TZ==='function'?TZ():'UTC',
    ...(typeof dateRange==='function'?dateRange():{})
  }).toString();
}

/**
 * Same global filter semantics as premiumQuery, shaped for Behavioral APIs.
 * Backend accepts: account, from, to, tz, source (optional).
 * Does not invent new filter state.
 */
function behaviorQuery(){
  const params={
    account:state.account||'',
    tz:typeof TZ==='function'?TZ():'UTC',
    ...(typeof dateRange==='function'?dateRange():{})
  };
  /* source is supported by the API; frontend has no global source control yet */
  return new URLSearchParams(params).toString();
}

function evidenceLabel(status){
  const s=String(status||'').toLowerCase();
  if(s==='strong')return 'Strong';
  if(s==='meaningful')return 'Meaningful';
  if(s==='emerging')return 'Emerging';
  if(s==='insufficient')return 'Insufficient';
  return s?s[0].toUpperCase()+s.slice(1):'Unknown';
}

function confidenceLabel(level){
  const s=String(level||'').toLowerCase();
  if(s==='high')return 'High';
  if(s==='medium')return 'Medium';
  if(s==='low')return 'Low';
  if(s==='none')return 'None';
  return s?s[0].toUpperCase()+s.slice(1):'—';
}

function fmtNum(n,digits){
  if(n===null||n===undefined||n==='')return '—';
  const x=Number(n);
  if(!Number.isFinite(x))return '—';
  return x.toFixed(digits);
}

function fmtSignedR(n){
  if(n===null||n===undefined||n==='')return '—';
  const x=Number(n);
  if(!Number.isFinite(x))return '—';
  const sign=x>0?'+':'';
  return sign+x.toFixed(2)+'R';
}

function fmtPct(n,digits){
  if(n===null||n===undefined||n==='')return '—';
  const x=Number(n);
  if(!Number.isFinite(x))return '—';
  return x.toFixed(digits==null?1:digits)+'%';
}

function evidenceRank(status){
  const s=String(status||'').toLowerCase();
  if(s==='strong')return 3;
  if(s==='meaningful')return 2;
  if(s==='emerging')return 1;
  return 0;
}

function isActionableEvidence(ev){
  if(!ev)return false;
  const s=String(ev.status||'').toLowerCase();
  return s==='emerging'||s==='meaningful'||s==='strong';
}

function dimLabel(dim){
  const map={
    session:'Session',
    strategy:'Strategy',
    setup:'Setup',
    market_condition:'Market Condition',
    symbol:'Symbol',
    direction:'Direction',
    source:'Source',
    playbook:'Playbook',
    confidence:'Confidence',
    rule_score:'Rule Score',
    emotion_before:'Emotion (before)',
    emotion_after:'Emotion (after)',
    mistake:'Mistake',
    risk:'Risk',
    exit_efficiency:'Exit Efficiency',
    streaks:'Streaks'
  };
  return map[dim]||(dim?String(dim).replace(/_/g,' '):'—');
}

function patternTypeLabel(type){
  const map={
    segment_performance:'Segment',
    confidence_calibration:'Confidence',
    emotion_segment:'Emotion',
    rule_score:'Rule Score',
    mistake_impact:'Mistake Impact',
    risk_consistency:'Risk Consistency',
    exit_efficiency:'Exit Efficiency',
    streaks:'Streaks'
  };
  return map[type]||(type?String(type).replace(/_/g,' '):'Pattern');
}

function patternGroup(type){
  if(type==='confidence_calibration'||type==='emotion_segment')return 'Psychology';
  if(type==='rule_score'||type==='mistake_impact')return 'Process';
  if(type==='risk_consistency'||type==='exit_efficiency'||type==='streaks')return 'Risk & Execution';
  if(type==='segment_performance')return 'Segments';
  return 'Other';
}

/* Evidence sort: strong > meaningful > emerging; then larger sample */
function sortByEvidence(a,b){
  const ra=evidenceRank(a.evidence&&a.evidence.status);
  const rb=evidenceRank(b.evidence&&b.evidence.status);
  if(rb!==ra)return rb-ra;
  return(Number(b.sampleSize)||0)-(Number(a.sampleSize)||0);
}

/* Drivers: actionable evidence first, then |Δ avgR|, then sample */
function sortDrivers(a,b){
  const ra=evidenceRank(a.evidence&&a.evidence.status);
  const rb=evidenceRank(b.evidence&&b.evidence.status);
  if(rb!==ra)return rb-ra;
  const da=Math.abs(Number(a.difference&&a.difference.averageR));
  const db=Math.abs(Number(b.difference&&b.difference.averageR));
  const aOk=Number.isFinite(da)?da:0;
  const bOk=Number.isFinite(db)?db:0;
  if(bOk!==aOk)return bOk-aOk;
  return(Number(b.sampleSize)||0)-(Number(a.sampleSize)||0);
}

function baselineMetric(label,value,cls){
  return`
    <div class="baseline-metric">
      <span>${E(label)}</span>
      <b class="${cls||''}">${value}</b>
    </div>
  `;
}

function renderBaselineLoading(){
  const el=$('#traderBaseline');
  if(!el)return;
  el.innerHTML=
    `<div class="baseline-loading">Analyzing your trading baseline...</div>`;
}

function renderBaselineError(){
  const el=$('#traderBaseline');
  if(!el)return;
  el.innerHTML=
    `<div class="baseline-error">
      <strong>Trader Baseline</strong>
      <p>Behavioral baseline temporarily unavailable.</p>
    </div>`;
}

function renderBaselineEmpty(){
  const el=$('#traderBaseline');
  if(!el)return;
  el.innerHTML=
    `<div class="baseline-empty">
      <div class="baseline-head">
        <div>
          <span class="eyebrow">BEHAVIORAL CONTEXT</span>
          <h2>Trader Baseline</h2>
        </div>
      </div>
      <p class="baseline-message">
        No trading data for the selected filters.
      </p>
      <p class="baseline-hint">
        Add or import trades to generate your behavioral baseline.
      </p>
    </div>`;
}

function renderBaselineInsufficient(b){
  const el=$('#traderBaseline');
  if(!el)return;
  const n=Number(b.sampleSize)||0;
  const status=evidenceLabel(b.evidence&&b.evidence.status);
  const conf=confidenceLabel(b.evidence&&b.evidence.confidenceLevel);
  el.innerHTML=
    `<div class="baseline-insufficient">
      <div class="baseline-head">
        <div>
          <span class="eyebrow">BEHAVIORAL CONTEXT</span>
          <h2>Trader Baseline</h2>
        </div>
        <div class="baseline-badges">
          <span class="evidence-badge evidence-insufficient">${E(status)}</span>
          <span class="confidence-badge">Confidence: ${E(conf)}</span>
        </div>
      </div>
      <p class="baseline-message">
        Not enough trade history yet.
      </p>
      <p class="baseline-hint">
        Add more trades to unlock reliable behavioral intelligence.
      </p>
      <div class="baseline-meta">
        <span>Sample: ${n} trade${n===1?'':'s'}</span>
        <span>Evidence: ${E(status)}</span>
      </div>
    </div>`;
}

function renderBaselineReady(b){
  const el=$('#traderBaseline');
  if(!el)return;
  const n=Number(b.sampleSize)||0;
  const status=String((b.evidence&&b.evidence.status)||'');
  const conf=String((b.evidence&&b.evidence.confidenceLevel)||'');
  const perf=b.performance||{};
  const risk=b.risk||{};
  const act=b.activity||{};
  const psych=b.psychology||{};

  const wr=Number.isFinite(Number(perf.winRate))
    ?fmtNum(perf.winRate,1)+'%'
    :'—';
  const avgR=fmtSignedR(perf.averageR);
  const exp=fmtSignedR(perf.expectancy);
  const totalR=fmtSignedR(perf.totalR);
  const pnl=Number.isFinite(Number(perf.pnl))?M(perf.pnl):'—';
  const avgRisk=Number.isFinite(Number(risk.averagePercent))
    ?fmtNum(risk.averagePercent,2)+'%'
    :'—';
  const tpd=Number.isFinite(Number(act.tradesPerActiveDay))
    ?fmtNum(act.tradesPerActiveDay,1)
    :'—';
  const avgConf=Number.isFinite(Number(psych.averageConfidence))
    ?fmtNum(psych.averageConfidence,0)
    :'—';
  const avgRule=Number.isFinite(Number(psych.averageRuleScore))
    ?fmtNum(psych.averageRuleScore,0)
    :'—';

  el.innerHTML=
    `<div class="baseline-ready">
      <div class="baseline-head">
        <div>
          <span class="eyebrow">BEHAVIORAL CONTEXT</span>
          <h2>Trader Baseline</h2>
          <p class="baseline-sample">
            ${n} trade${n===1?'':'s'} · ${E(evidenceLabel(status))} evidence
          </p>
        </div>
        <div class="baseline-badges">
          <span class="evidence-badge evidence-${E(status)}">${E(evidenceLabel(status))}</span>
          <span class="confidence-badge">Confidence: ${E(confidenceLabel(conf))}</span>
        </div>
      </div>
      <div class="baseline-metrics">
        ${baselineMetric('Win Rate',wr)}
        ${baselineMetric('Average R',avgR,C(perf.averageR))}
        ${baselineMetric('Expectancy',exp,C(perf.expectancy))}
        ${baselineMetric('Total R',totalR,C(perf.totalR))}
        ${baselineMetric('P&L',pnl,C(perf.pnl))}
        ${baselineMetric('Avg Risk',avgRisk)}
        ${baselineMetric('Trades / Day',tpd)}
        ${baselineMetric('Avg Confidence',avgConf)}
        ${baselineMetric('Avg Rule Score',avgRule)}
      </div>
    </div>`;
}

async function loadTraderBaseline(){
  const el=$('#traderBaseline');
  if(!el)return;

  renderBaselineLoading();

  try{
    const d=await api('/api/behavior/baseline?'+behaviorQuery());
    const b=d&&d.baseline?d.baseline:d;
    if(!b||typeof b!=='object'){
      renderBaselineError();
      return;
    }
    const n=Number(b.sampleSize)||0;
    if(n===0){
      renderBaselineEmpty();
      return;
    }
    const status=String((b.evidence&&b.evidence.status)||'').toLowerCase();
    if(status==='insufficient'||n<8){
      renderBaselineInsufficient(b);
      return;
    }
    renderBaselineReady(b);
  }catch(_e){
    renderBaselineError();
  }
}

/* ============================================================
   Behavior UI Batch 2 — Signals + Patterns
   ============================================================ */

function cardMetric(label,value,cls){
  return`
    <div class="bcard-metric">
      <span>${E(label)}</span>
      <b class="${cls||''}">${value}</b>
    </div>
  `;
}

function evidenceBadges(ev){
  if(!ev)return'';
  const status=String(ev.status||'');
  const conf=String(ev.confidenceLevel||'');
  return`
    <div class="baseline-badges">
      <span class="evidence-badge evidence-${E(status)}">${E(evidenceLabel(status))}</span>
      <span class="confidence-badge">${E(confidenceLabel(conf))}</span>
    </div>
  `;
}

function deviationWord(diff){
  const x=Number(diff);
  if(!Number.isFinite(x))return'';
  if(x>0)return'Above baseline';
  if(x<0)return'Below baseline';
  return'At baseline';
}

/**
 * Filter patterns to actionable evidence only; sort strong→meaningful→emerging.
 * Backend already skips insufficient for segment-derived patterns, but we
 * defend in the UI as well.
 */
function preparePatterns(list){
  return(list||[])
    .filter(p=>p&&isActionableEvidence(p.evidence))
    .slice()
    .sort(sortByEvidence);
}

/**
 * Group prepared patterns into Psychology / Process / Risk & Execution / Segments.
 * Omits empty groups.
 */
function groupPatterns(patterns){
  const order=['Psychology','Process','Risk & Execution','Segments','Other'];
  const map={};
  for(const p of patterns){
    const g=patternGroup(p.type);
    if(!map[g])map[g]=[];
    map[g].push(p);
  }
  return order
    .filter(g=>map[g]&&map[g].length)
    .map(g=>({group:g,items:map[g]}));
}

/**
 * Segment signals usable as performance drivers.
 * Excludes Unspecified and insufficient evidence.
 */
function prepareDrivers(signals){
  const segs=(signals&&signals.segments)||[];
  return segs
    .filter(s=>{
      if(!s||!isActionableEvidence(s.evidence))return false;
      const name=String(s.segment||'');
      if(!name||name==='Unspecified')return false;
      return true;
    })
    .slice()
    .sort(sortDrivers);
}

function renderPatternCard(p){
  const n=Number(p.sampleSize)||0;
  const status=String((p.evidence&&p.evidence.status)||'');
  const type=patternTypeLabel(p.type);
  const seg=p.segment!=null&&p.segment!==''?String(p.segment):null;
  const dim=p.dimension?dimLabel(p.dimension):'';
  const title=seg||dim||type;
  const sub=[type,dim&&dim!==title?dim:null].filter(Boolean).join(' · ');

  let metrics='';
  if(p.type==='streaks'){
    metrics=
      cardMetric('Win streak',String(p.longestWinStreak!=null?p.longestWinStreak:'—'))+
      cardMetric('Loss streak',String(p.longestLossStreak!=null?p.longestLossStreak:'—'));
  }else if(p.type==='exit_efficiency'){
    const cap=Number(p.difference);
    metrics=
      cardMetric('Capture ratio',Number.isFinite(cap)?fmtNum(cap,2):'—',Number.isFinite(cap)?C(cap-0.5):'');
  }else if(p.type==='risk_consistency'){
    const dev=Number(p.difference);
    metrics=
      cardMetric('Risk Δ',Number.isFinite(dev)?fmtNum(dev,2)+' pp':'—',Number.isFinite(dev)?C(-Math.abs(dev)):'')+
      (Number.isFinite(dev)?`<div class="bcard-note">${E(deviationWord(dev))}</div>`:'');
  }else{
    const diff=Number(p.difference);
    metrics=
      cardMetric('Δ Average R',fmtSignedR(diff),Number.isFinite(diff)?C(diff):'')+
      (Number.isFinite(diff)?`<div class="bcard-note">${E(deviationWord(diff))}</div>`:'');
  }

  return`
    <div class="bcard">
      <div class="bcard-top">
        <div>
          <span class="bcard-type">${E(type)}</span>
          <h3 class="bcard-title">${E(title)}</h3>
          ${sub&&sub!==title?`<p class="bcard-sub">${E(sub)}</p>`:''}
          <p class="bcard-sample">${n} trade${n===1?'':'s'} · ${E(evidenceLabel(status))} pattern</p>
        </div>
        ${evidenceBadges(p.evidence)}
      </div>
      <div class="bcard-metrics">${metrics}</div>
    </div>
  `;
}

function renderDriverCard(s){
  const n=Number(s.sampleSize)||0;
  const status=String((s.evidence&&s.evidence.status)||'');
  const dim=dimLabel(s.dimension);
  const seg=String(s.segment||'');
  const avgR=s.averageR;
  const baseR=s.baseline&&s.baseline.averageR;
  const diff=s.difference&&s.difference.averageR;
  const wr=s.winRate;

  return`
    <div class="bcard">
      <div class="bcard-top">
        <div>
          <span class="bcard-type">${E(dim)}</span>
          <h3 class="bcard-title">${E(seg)}</h3>
          <p class="bcard-sample">${n} trade${n===1?'':'s'} · ${E(evidenceLabel(status))}</p>
        </div>
        ${evidenceBadges(s.evidence)}
      </div>
      <div class="bcard-metrics">
        ${cardMetric('Average R',fmtSignedR(avgR),Number.isFinite(Number(avgR))?C(avgR):'')}
        ${cardMetric('Baseline',fmtSignedR(baseR))}
        ${cardMetric('Difference',fmtSignedR(diff),Number.isFinite(Number(diff))?C(diff):'')}
        ${cardMetric('Win Rate',fmtPct(wr,1))}
      </div>
      ${Number.isFinite(Number(diff))?`<div class="bcard-note">${E(deviationWord(diff))}</div>`:''}
    </div>
  `;
}

function renderPatternsBody(patterns){
  const el=$('#behaviorPatternsBody');
  if(!el)return;

  const prepared=preparePatterns(patterns);
  if(!prepared.length){
    el.innerHTML=
      `<div class="behavior-empty">
        <p class="baseline-message">No behavioral patterns detected yet.</p>
        <p class="baseline-hint">
          Keep logging consistent trades. GhostTrader will surface patterns
          as enough evidence accumulates.
        </p>
      </div>`;
    return;
  }

  const groups=groupPatterns(prepared);
  el.innerHTML=groups.map(g=>
    `<div class="behavior-group">
      <h3 class="behavior-group-title">${E(g.group)}</h3>
      <div class="bcard-grid">
        ${g.items.map(renderPatternCard).join('')}
      </div>
    </div>`
  ).join('');
}

function renderDriversBody(signals){
  const el=$('#performanceDriversBody');
  if(!el)return;

  const drivers=prepareDrivers(signals);
  if(!drivers.length){
    el.innerHTML=
      `<div class="behavior-empty">
        <p class="baseline-message">No performance drivers with usable evidence yet.</p>
        <p class="baseline-hint">
          Segment performance appears here once sample sizes support
          emerging or stronger evidence.
        </p>
      </div>`;
    return;
  }

  /* Cap display to keep the page focused — full list available via API */
  const shown=drivers.slice(0,18);
  el.innerHTML=
    `<div class="bcard-grid">
      ${shown.map(renderDriverCard).join('')}
    </div>
    ${drivers.length>18
      ?`<p class="behavior-more">${drivers.length-18} additional segment(s) not shown.</p>`
      :''}`;
}

async function loadBehaviorPatterns(){
  const el=$('#behaviorPatternsBody');
  if(!el)return;
  el.innerHTML=`<div class="baseline-loading">Scanning behavioral patterns…</div>`;
  try{
    const d=await api('/api/behavior/patterns?'+behaviorQuery());
    const list=d&&Array.isArray(d.patterns)?d.patterns:[];
    renderPatternsBody(list);
  }catch(_e){
    el.innerHTML=
      `<div class="baseline-error">
        <p>Pattern scan temporarily unavailable.</p>
      </div>`;
  }
}

async function loadBehaviorSignals(){
  const el=$('#performanceDriversBody');
  if(!el)return;
  el.innerHTML=`<div class="baseline-loading">Analyzing performance drivers…</div>`;
  try{
    const d=await api('/api/behavior/signals?'+behaviorQuery());
    const signals=d&&d.signals?d.signals:d;
    renderDriversBody(signals||{});
  }catch(_e){
    el.innerHTML=
      `<div class="baseline-error">
        <p>Behavioral patterns temporarily unavailable.</p>
      </div>`;
  }
}

async function insights(){
  /* Each behavioral request is independent — failures must not block others */
  const baselinePromise=loadTraderBaseline();
  const patternsPromise=loadBehaviorPatterns();
  const signalsPromise=loadBehaviorSignals();

  const d=await api(
    '/api/premium?'+premiumQuery()
  );

  const edges=d.edge||{};
  const coach=d.coach||[];

  const strong=[
    ...(edges.symbols||[]),
    ...(edges.strategies||[]),
    ...(edges.setups||[])
  ]
  .sort((a,b)=>b.pnl-a.pnl)
  .slice(0,6);

  const leaks=[
    ...(edges.symbols||[]),
    ...(edges.strategies||[]),
    ...(edges.setups||[])
  ]
  .sort((a,b)=>a.pnl-b.pnl)
  .filter(x=>x.pnl<0)
  .slice(0,6);

  $('#coachCards').innerHTML=
    coach.map(x=>
      `<div class="insight-card ${
        x.type==='LEAK'?
          'coach-negative':
          x.type==='EDGE'?
            'coach-positive':
            'coach-neutral'
      }">
        <span class="tag">${E(coachTypeLabel(x.type))}</span>
        <h3>${E(coachTitleText(x.type,x.title))}</h3>
        <p>${E(x.body)}</p>
      </div>`
    ).join('')||
    `
      <div class="insight-card">
        <span class="tag">GHOST</span>
        <h3>Not enough data yet</h3>
        <p>
          Log at least a few trades with strategy,
          setup, confidence and risk fields to unlock
          deeper insights.
        </p>
      </div>
    `;

  $('#edgeList').innerHTML=
    strong.map(insightRow).join('')||
    '<p>No performance groups yet.</p>';

  $('#leakList').innerHTML=
    leaks.map(insightRow).join('')||
    '<p>No negative-P&amp;L groups in the selected period.</p>';

  const psych=[
    ...(d.psychology?.confidence||[]),
    ...(d.psychology?.emotions||[])
  ].filter(x=>x.trades);

  $('#psychList').innerHTML=
    psych.map(insightRow).join('')||
    '<p>Add confidence or pre-trade emotion to unlock psychology analysis.</p>';

  $('#processList').innerHTML=
    (d.processFlags||[]).map(x=>
      `<div class="flag">
        <strong>
          ${E(x.symbol)} ·
          ${E(formatDay(x.date))} ·
          <span class="${C(x.pnl)}">${M(x.pnl)}</span>
        </strong>

        ${x.reasons.map(r=>
          `<span>${E(r)}</span>`
        ).join('')}
      </div>`
    ).join('')||
    '<p>No process flags found.</p>';

  await Promise.allSettled([baselinePromise,patternsPromise,signalsPromise]);
}

async function reports(){
  const d=await api(
    '/api/premium?'+premiumQuery()
  );

  const w=d.weekly||{
    current:{},
    previous:{}
  };

  const r=d.risk||{};

  $('#weeklyCards').innerHTML=[
    st(
      'This week P&L',
      M(w.current.pnl),
      '',
      C(w.current.pnl)
    ),
    st(
      'This week trades',
      w.current.trades||0
    ),
    st(
      'This week win rate',
      Number(w.current.winRate||0).toFixed(1)+'%'
    ),
    st(
      'Avg R',
      Number(w.current.avgR||0).toFixed(2)+'R',
      '',
      C(w.current.avgR)
    ),
    st(
      'Avg risk',
      Number(r.avgRisk||0).toFixed(2)+'%'
    ),
    st(
      'Risk outliers',
      r.riskOutliers||0
    )
  ].join('');

  $('#riskCenter').innerHTML=[
    [
      'Average recorded risk',
      Number(r.avgRisk||0).toFixed(2)+'%'
    ],
    [
      'Risk outliers',
      String(r.riskOutliers||0)
    ],
    [
      'Current max drawdown',
      M(r.maxDrawdown)
    ],
    [
      'Best win streak',
      String(r.bestWinStreak||0)
    ],
    [
      'Worst loss streak',
      String(r.bestLossStreak||0)
    ]
  ].map(x=>
    `<div class="metric">
      <span>${E(x[0])}</span>
      <b>${E(x[1])}</b>
    </div>`
  ).join('');

  $('#weeklyReview').innerHTML=
    `<div class="compare">
      <div>
        <small>THIS WEEK</small>
        <strong class="${C(w.current.pnl)}">
          ${M(w.current.pnl)}
        </strong>
        <small>
          ${w.current.trades||0} trades ·
          ${Number(w.current.winRate||0).toFixed(1)}% win ·
          ${Number(w.current.avgR||0).toFixed(2)}R avg
        </small>
      </div>

      <div>
        <small>PREVIOUS WEEK</small>
        <strong class="${C(w.previous.pnl)}">
          ${M(w.previous.pnl)}
        </strong>
        <small>
          ${w.previous.trades||0} trades ·
          ${Number(w.previous.winRate||0).toFixed(1)}% win ·
          ${Number(w.previous.avgR||0).toFixed(2)}R avg
        </small>
      </div>
    </div>`;
}
