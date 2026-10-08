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
  const x=Number(n);
  if(!Number.isFinite(x))return '—';
  return x.toFixed(digits);
}

function fmtSignedR(n){
  const x=Number(n);
  if(!Number.isFinite(x))return '—';
  const sign=x>0?'+':'';
  return sign+x.toFixed(2)+'R';
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

async function insights(){
  /* Baseline loads independently so premium content is never blocked */
  const baselinePromise=loadTraderBaseline();

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
        <span class="tag">${E(x.type)}</span>
        <h3>${E(x.title)}</h3>
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
    '<p>No edge data yet.</p>';

  $('#leakList').innerHTML=
    leaks.map(insightRow).join('')||
    '<p>No negative edge detected in the selected period.</p>';

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

  await baselinePromise;
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
