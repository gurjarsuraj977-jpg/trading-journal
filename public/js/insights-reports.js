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
  return new URLSearchParams({
    account:state.account||'',
    range:state.range||'year'
  }).toString();
}

async function insights(){
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
