function page(p){
  $$('.page').forEach(x=>x.classList.add('hide'));

  const el=$("#"+p);
  if(!el)return;

  el.classList.remove('hide');

  $$('nav button').forEach(b=>
    b.classList.toggle('active',b.dataset.p===p)
  );

  $("#title").textContent=p[0].toUpperCase()+p.slice(1);

  if(p==='dashboard')
    dashboard().catch(e=>showError(e.message));

  if(p==='trades')
    trades().catch(e=>showError(e.message));

  if(p==='calendar')
    calendar().catch(e=>showError(e.message));

  if(p==='analytics')
    analytics().catch(e=>showError(e.message));

  if(p==='insights')
    insights().catch(e=>showError(e.message));

  if(p==='reports')
    reports().catch(e=>showError(e.message));

if(p==='accounts'){

  accounts().catch(e=>showError(e.message));

  loadTradeLockerConnection()
    .catch(e=>console.warn(
      'TradeLocker load:',
      e.message
    ));

}

  if(p==='playbooks')
    playbooks().catch(e=>showError(e.message));

  if(p==='execution')
    executionLab().catch(e=>showError(e.message));

  if(p==='simulation')
    simulationLab().catch(e=>showError(e.message));

  if(p==='replay')
    replayLab().catch(e=>showError(e.message));

  if(p==='market')
    marketChartLab().catch(e=>showError(e.message));

  if(p==='coach')
    coachLab();

  if(p==='missed')
    missedLab().catch(e=>showError(e.message));
}

$$('nav button[data-p]').forEach(b=>
  b.onclick=()=>page(b.dataset.p)
);

function calKey(y,m,d){
  return`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

async function calendar(){
  const y=state.month.getFullYear();
  const mo=state.month.getMonth()+1;
  const m=String(mo).padStart(2,'0');

  const d=await api(
    `/api/calendar?month=${y}-${m}&tz=${encodeURIComponent(TZ())}`
  );

  const map=Object.fromEntries(
    (d.days||[]).map(x=>[
      String(x.day).slice(0,10),
      x
    ])
  );

  const first=new Date(y,mo-1,1);
  const days=new Date(y,mo,0).getDate();
  const off=(first.getDay()+6)%7;

  $("#mt").textContent=
    state.month.toLocaleString(
      undefined,
      {
        month:'long',
        year:'numeric'
      }
    );

  let h='';

  for(let i=0;i<off;i++)
    h+='<div class="day empty"></div>';

  for(let i=1;i<=days;i++){
    const x=map[calKey(y,mo,i)];
    const p=x?Number(x.pnl):0;

    h+=`
      <div
        class="day ${p>0?'win':p<0?'loss':''}"
        ${
          x?
          `data-day="${calKey(y,mo,i)}" title="${E(M(p)+' · '+x.trades+' trades')}"`:
          ''
        }
      >
        <b>${i}</b>

        ${
          x?
          `
          <p class="${C(p)}">
            <b>${M(p)}</b><br>
            ${x.trades} trade${Number(x.trades)===1?'':'s'}
          </p>
          `:
          ''
        }
      </div>
    `;
  }

  $("#gridcal").innerHTML=h;

  $$('#gridcal .day[data-day]').forEach(el=>
    el.onclick=async()=>{
      const d=await api(
        '/api/trades?date='+
        el.dataset.day+
        '&tz='+
        encodeURIComponent(TZ())
      );

      state.trades=d.trades||[];

      $("#fs").value='';
      $("#fd").value='';
      $("#fr").value='';

      page('trades');

      $("#tradeTable").innerHTML=
        table(state.trades);
    }
  );
}

$("#prev").onclick=()=>{
  state.month=new Date(
    state.month.getFullYear(),
    state.month.getMonth()-1,
    1
  );

  calendar().catch(e=>showError(e.message));
};

$("#next").onclick=()=>{
  state.month=new Date(
    state.month.getFullYear(),
    state.month.getMonth()+1,
    1
  );

  calendar().catch(e=>showError(e.message));
};

function bars(a,key){
  if(!a?.length)
    return'<p style="color:#98a2af">No data yet.</p>';

  const mx=Math.max(
    ...a.map(x=>Math.abs(Number(x.pnl||0))),
    1
  );

  return a.map(x=>
    `<div class="barrow">
      <b>${E(x[key]||'Unspecified')}</b>
      <div class="bar">
        <i style="width:${Math.min(100,Math.abs(Number(x.pnl||0))/mx*100)}%"></i>
      </div>
      <span class="${C(x.pnl)}">${M(x.pnl)}</span>
    </div>`
  ).join('');
}

async function analytics(){
  const d=await api('/api/analytics?'+query());
  const s=d.summary||{};

  $("#astats").innerHTML=[
    st('Trades',s.total||0),
    st('P&L',M(s.pnl),'',C(s.pnl)),
    st('Win rate',Number(s.winRate||0).toFixed(1)+'%'),
    st('Avg R',Number(s.avgR||0).toFixed(2)+'R','',C(s.avgR)),
    st('Expectancy',M(s.expectancy),'',C(s.expectancy)),
    st('Drawdown',M(s.maxDrawdown),'','negative')
  ].join('');

  $("#sym").innerHTML=
    bars(d.bySymbol,'symbol');

  $("#strat").innerHTML=
    bars(d.byStrategy,'strategy');

  $("#sess").innerHTML=
    bars(d.bySession,'session');

  $("#dir").innerHTML=
    bars(d.byDirection,'direction');
}

$("#newacc").onclick=async()=>{
  const n=prompt('Account name');

  if(!n?.trim())return;

  const b=prompt(
    'Starting balance',
    '10000'
  );

  if(b===null)return;

  try{
    await api('/api/accounts',{
      method:'POST',
      body:JSON.stringify({
        name:n.trim(),
        startingBalance:b,
        currency:'USD'
      })
    });

    await loadAccounts();
    await accounts();

  }catch(e){
    showError(e.message);
  }
};

async function accounts(){
  const d=await api('/api/accounts');

  $("#accountsList").innerHTML=
    (d.accounts||[]).map(a=>
      `<div class="account-card">
        <h3>${E(a.name)}</h3>
        <small>
          Starting balance · ${M(a.starting_balance)}
        </small>
        <strong class="${C(a.pnl)}">
          ${M(a.pnl)}
        </strong>
        <small>Net P&L</small>

        <button
          class="secondary"
          type="button"
          onclick="editAccountBalance(${a.id},${Number(a.starting_balance||0)})"
        >
          Edit Balance
        </button>
      </div>`
    ).join('')||
    '<p>No accounts yet.</p>';
}
async function editAccountBalance(id,currentBalance){
  const value=prompt(
    'Enter new starting balance:',
    Number(currentBalance||0).toFixed(2)
  );

  if(value===null)return;

  const startingBalance=Number(value);

  if(!Number.isFinite(startingBalance)||startingBalance<0){
    alert('Please enter a valid non-negative balance.');
    return;
  }

  try{
    await api(`/api/accounts/${id}`,{
      method:'PUT',
      body:JSON.stringify({
        startingBalance
      })
    });

    await loadAccounts();
    await accounts();
    await dashboard();
  }catch(e){
    showError(e.message);
  }
}
$("#openInsights").onclick=()=>
  page('insights');

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

async function loadPlaybooks(){
  try{
    const d=await api('/api/playbooks');

    state.playbooks=d.playbooks||[];
    state.playbookRules=d.rules||[];

    if($('#playbook')){
      $('#playbook').innerHTML=
        '<option value="">No playbook</option>'+
        state.playbooks.map(p=>
          `<option value="${p.id}">
            ${E(p.name)}
          </option>`
        ).join('');
    }

  }catch(e){
    console.warn(e.message);
  }
}

function playbookRulesFor(id){
  return(state.playbookRules||[])
    .filter(r=>Number(r.playbook_id)===Number(id));
}

async function playbooks(){
  await loadPlaybooks();

  $('#playbookList').innerHTML=
    (state.playbooks||[]).map(p=>{
      const rules=playbookRulesFor(p.id);

      return`
        <div class="playbook-card" data-id="${p.id}">
          <div>
            <h3>${E(p.name)}</h3>
            <p>${E(p.description||'')}</p>
            <small>
              ${E(p.strategy||'No strategy')} ·
              Risk cap ${Number(p.risk_limit||0).toFixed(2)}%
            </small>
          </div>

          <div class="playbook-actions">
            <b>${rules.length} rules</b>

            <button
              class="ghost"
              onclick="viewPlaybook(${p.id})"
            >
              View
            </button>

            <button
              class="ghost danger"
              onclick="deletePlaybook(${p.id})"
            >
              Delete
            </button>
          </div>
        </div>
      `;
    }).join('')||
    '<p class="muted">No playbooks yet. Create one from your best setup.</p>';
}

window.viewPlaybook=id=>{
  const p=(state.playbooks||[])
    .find(x=>Number(x.id)===Number(id));

  if(!p)return;

  const rules=playbookRulesFor(id);

  $('#playbookDetail').innerHTML=
    `<h2>${E(p.name)}</h2>
     <p>${E(p.description||'')}</p>

     <div class="checklist">
       ${
         rules.map((r,i)=>
           `<div>
             <span>${i+1}</span>
             <b>${E(r.label)}</b>
             <small>
               ${r.required?'Required':'Optional'} ·
               weight ${r.weight}
             </small>
           </div>`
         ).join('')||
         '<p class="muted">No checklist rules.</p>'
       }
     </div>`;
};

window.deletePlaybook=async id=>{
  if(!confirm('Delete this playbook?'))
    return;

  await api(
    '/api/playbooks/'+id,
    {method:'DELETE'}
  );

  await loadPlaybooks();
  await playbooks();
};

$('#newPlaybook').onclick=async()=>{
  const name=prompt('Playbook name');

  if(!name?.trim())return;

  const strategy=prompt(
    'Strategy / setup name',
    'Breakout'
  );

  const desc=prompt(
    'Description',
    'Rules for my highest-quality setup'
  );

  const raw=prompt(
    'Checklist rules, separated by |',
    'HTF bias aligned|Liquidity sweep confirmed|Entry trigger confirmed|Risk <= 1%|News checked'
  );

  const rules=(raw||'')
    .split('|')
    .map(x=>({
      label:x.trim(),
      required:true,
      weight:1
    }))
    .filter(x=>x.label);

  try{
    await api('/api/playbooks',{
      method:'POST',
      body:JSON.stringify({
        name:name.trim(),
        strategy,
        description:desc,
        riskLimit:1,
        rules
      })
    });

    await loadPlaybooks();
    await playbooks();

  }catch(e){
    showError(e.message);
  }
};

async function executionLab(){
  const d=await api(
    '/api/execution?'+
    new URLSearchParams(
      state.account?
        {account:state.account}:
        {}
    )
  );

  const o=d.overall||{};

  $('#executionStats').innerHTML=[
    st('Trades',o.trades||0),
    st(
      'Avg MFE',
      Number(o.avg_mfe||0).toFixed(2)+'R',
      '',
      C(o.avg_mfe)
    ),
    st(
      'Avg MAE',
      Number(o.avg_mae||0).toFixed(2)+'R',
      '',
      C(o.avg_mae)
    ),
    st(
      'Avg realized R',
      Number(o.avg_r||0).toFixed(2)+'R',
      '',
      C(o.avg_r)
    ),
    st(
      'Exit efficiency',
      Number(o.exit_efficiency||0)*100?
        (Number(o.exit_efficiency||0)*100).toFixed(1)+'%':
        '—'
    ),
    st(
      'Rule score',
      Number(o.rule_score||0).toFixed(0)+'%'
    )
  ].join('');

  $('#executionTable').innerHTML=
    `<div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Trades</th>
            <th>MFE</th>
            <th>MAE</th>
            <th>Realized R</th>
            <th>Exit efficiency</th>
            <th>Rule score</th>
          </tr>
        </thead>

        <tbody>
          ${
            (d.bySymbol||[]).map(x=>
              `<tr>
                <td><b>${E(x.symbol)}</b></td>
                <td>${x.trades}</td>
                <td class="positive">
                  ${Number(x.avg_mfe||0).toFixed(2)}R
                </td>
                <td class="negative">
                  ${Number(x.avg_mae||0).toFixed(2)}R
                </td>
                <td class="${C(x.avg_r)}">
                  ${Number(x.avg_r||0).toFixed(2)}R
                </td>
                <td>
                  ${(Number(x.exit_efficiency||0)*100).toFixed(1)}%
                </td>
                <td>
                  ${Number(x.rule_score||0).toFixed(0)}%
                </td>
              </tr>`
            ).join('')||
            '<tr><td colspan="7">No MFE/MAE data yet. Edit trades and record MFE/MAE.</td></tr>'
          }
        </tbody>
      </table>
    </div>`;
}

function symbolsForSim(){
  const vals=[
    ...new Set(
      (state.trades||[])
        .map(x=>x.symbol)
        .filter(Boolean)
    )
  ];

  $('#simSymbol').innerHTML=
    '<option value="">All symbols</option>'+
    vals.map(x=>
      `<option>${E(x)}</option>`
    ).join('');
}

async function simulationLab(){
  await trades();

  symbolsForSim();

  $('#simResult').innerHTML=
    '<p class="muted">Run a scenario to see simulated results.</p>';
}

$('#runSim').onclick=async()=>{
  try{
    const body={
      account:state.account||'',
      symbol:$('#simSymbol').value,
      targetR:$('#simTarget').value,
      stopR:$('#simStop').value
    };

    const d=await api(
      '/api/simulate',
      {
        method:'POST',
        body:JSON.stringify(body)
      }
    );

    $('#simResult').innerHTML=
      `<div class="sim-grid">
        <div>
          <small>Usable trades</small>
          <b>${d.usable}</b>
        </div>

        <div>
          <small>Simulated R</small>
          <b class="${C(d.simulatedR)}">
            ${Number(d.simulatedR).toFixed(2)}R
          </b>
        </div>

        <div>
          <small>Win rate</small>
          <b>${Number(d.winRate).toFixed(1)}%</b>
        </div>

        <div>
          <small>Avg R</small>
          <b class="${C(d.avgR)}">
            ${Number(d.avgR).toFixed(2)}R
          </b>
        </div>
      </div>

      <p>
        ${
          d.usable?
          `Scenario used target +${Number(d.targetR).toFixed(2)}R and stop -${Math.abs(Number(d.stopR)).toFixed(2)}R.`:
          'Add MFE/MAE values to your trades before simulating.'
        }
      </p>`;

    await api(
      '/api/backtests',
      {
        method:'POST',
        body:JSON.stringify({
          name:$('#simName').value,
          symbol:$('#simSymbol').value,
          targetR:$('#simTarget').value,
          stopR:$('#simStop').value
        })
      }
    );

  }catch(e){
    showError(e.message);
  }
};

let replayTradeData=null;
let replayTimer=null;

async function replayLab(){
  const d=await api(
    '/api/trades?'+query({})
  );

  const rows=d.trades||[];

  $('#replayTrade').innerHTML=
    rows.map(x=>
      `<option value="${x.id}">
        ${E(x.symbol)} ·
        ${E(formatDay(x.trade_date))} ·
        ${E(x.direction)} ·
        ${M(x.profit_loss)}
      </option>`
    ).join('')||
    '<option value="">No trades</option>';

  if(rows.length)
    await loadReplay(rows[0].id);
  else
    renderReplayEmpty();
}

async function loadReplay(id){
  if(!id)return;

  const d=await api(
    '/api/replay/'+id
  );

  replayTradeData=d.trade;

  $('#replaySlider').value=0;

  renderReplay(0);
}

function renderReplay(v){
  const t=replayTradeData;

  if(!t)return;

  const p=Math.max(
    0,
    Math.min(100,Number(v))
  );

  const entry=Number(t.entry||0);

  const exit=
    t.exit_price==null?
      entry:
      Number(t.exit_price);

  const price=
    entry+
    (exit-entry)*(p/100);

  const pnl=
    Number(t.profit_loss||0)*
    (p/100);

  $('#replayPrice').textContent=
    price.toFixed(4);

  $('#replayProgress').style.width=
    p+'%';

  $('#replayPnl').textContent=
    M(pnl);

  $('#replayTime').textContent=
    p<100?
      `Execution ${Math.round(p)}%`:
      `Closed · ${formatDay(t.trade_date)}`;

  $('#replayInfo').innerHTML=
    `<h2>
      ${E(t.symbol)} ${E(t.direction)}
    </h2>

    <div class="metric-list">
      <p>
        <span>Entry</span>
        <b>${entry.toFixed(4)}</b>
      </p>

      <p>
        <span>Exit</span>
        <b>${exit.toFixed(4)}</b>
      </p>

      <p>
        <span>Actual R</span>
        <b class="${C(t.actual_r)}">
          ${Number(t.actual_r||0).toFixed(2)}R
        </b>
      </p>

      <p>
        <span>MFE</span>
        <b>${Number(t.mfe_r||0).toFixed(2)}R</b>
      </p>

      <p>
        <span>MAE</span>
        <b>${Number(t.mae_r||0).toFixed(2)}R</b>
      </p>

      <p>
        <span>Rule score</span>
        <b>${Number(t.rule_score||0).toFixed(0)}%</b>
      </p>
    </div>

    ${
      t.screenshot_data?
      `<img
        class="replay-shot"
        src="${E(t.screenshot_data)}"
        alt="Trade screenshot"
      >`:
      ''
    }`;
}

function renderReplayEmpty(){
  $('#replayPrice').textContent='—';

  $('#replayInfo').innerHTML=
    '<h2>Execution record</h2>'+
    '<p class="muted">Add a trade to replay it.</p>';
}

$('#replayTrade').onchange=()=>
  loadReplay(
    $('#replayTrade').value
  ).catch(e=>showError(e.message));

$('#replaySlider').oninput=e=>
  renderReplay(e.target.value);

$('#replayReset').onclick=()=>{
  $('#replaySlider').value=0;
  renderReplay(0);
};

$('#replayPlay').onclick=()=>{
  clearInterval(replayTimer);

  let v=Number(
    $('#replaySlider').value
  );

  replayTimer=setInterval(()=>{
    v+=2;

    $('#replaySlider').value=v;

    renderReplay(v);

    if(v>=100)
      clearInterval(replayTimer);

  },70);
};

function coachLab(){
  $('#coachQuestion').focus();
}

async function askGhost(q){
  if(!q?.trim())return;

  $('#coachChat').insertAdjacentHTML(
    'beforeend',
    `<div class="chat user">
      <b>You</b>
      <p>${E(q)}</p>
    </div>`
  );

  try{
    const d=await api(
      '/api/ai/coach',
      {
        method:'POST',
        body:JSON.stringify({
          question:q
        })
      }
    );

    $('#coachChat').insertAdjacentHTML(
      'beforeend',
      `<div class="chat ghost">
        <b>Ghost</b>
        <p>${E(d.answer).replace(/\n/g,'<br>')}</p>
        <small>
          Mode: ${E(d.mode||'local')}
        </small>
      </div>`
    );

    $('#coachChat').scrollTop=
      $('#coachChat').scrollHeight;

  }catch(e){
    showError(e.message);
  }
}

$('#askCoach').onclick=()=>{
  const q=$('#coachQuestion').value;

  $('#coachQuestion').value='';

  askGhost(q);
};

$('#coachQuestion').onkeydown=e=>{
  if(e.key==='Enter')
    $('#askCoach').click();
};

$$('.chip').forEach(b=>
  b.onclick=()=>
    askGhost(b.dataset.q)
);

async function missedLab(){
  const d=await api('/api/missed');

  const rows=d.missed||[];

  $('#missedList').innerHTML=
    rows.length?
    `
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Symbol</th>
              <th>Direction</th>
              <th>Setup</th>
              <th>Reason</th>
              <th>Potential R</th>
              <th>Potential P&L</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${
              rows.map(x=>
                `<tr>
                  <td>${E(formatDay(x.trade_date))}</td>
                  <td><b>${E(x.symbol)}</b></td>
                  <td>${E(x.direction||'')}</td>
                  <td>${E(x.setup||'')}</td>
                  <td>${E(x.reason||'')}</td>
                  <td>
                    ${Number(x.potential_r||0).toFixed(2)}R
                  </td>
                  <td class="${C(x.potential_pnl)}">
                    ${M(x.potential_pnl)}
                  </td>
                  <td>
                    <button
                      class="ghost danger"
                      onclick="deleteMissed(${x.id})"
                    >
                      Delete
                    </button>
                  </td>
                </tr>`
              ).join('')
            }
          </tbody>
        </table>
      </div>
    `:
    '<p class="muted">No missed trades recorded.</p>';
}

window.deleteMissed=async id=>{
  if(!confirm(
    'Delete this missed trade?'
  ))return;

  await api(
    '/api/missed/'+id,
    {method:'DELETE'}
  );

  await missedLab();
};

$('#newMissed').onclick=async()=>{
  const symbol=prompt(
    'Symbol',
    'XAUUSD'
  );

  if(!symbol)return;

  const direction=prompt(
    'Direction',
    'BUY'
  );

  const setup=prompt(
    'Setup',
    'Breakout'
  );

  const reason=prompt(
    'Why missed?',
    'Fear'
  );

  const pr=prompt(
    'Potential R',
    '2'
  );

  const pp=prompt(
    'Potential P&L',
    '0'
  );

  try{
    await api(
      '/api/missed',
      {
        method:'POST',
        body:JSON.stringify({
          symbol,
          direction,
          setup,
          reason,
          potentialR:pr,
          potentialPnl:pp,
          account:state.account
        })
      }
    );

    await missedLab();

  }catch(e){
    showError(e.message);
  }
};

$('#refreshExecution').onclick=()=>
  executionLab().catch(e=>showError(e.message));

$('#refreshInsights').onclick=()=>
  insights().catch(e=>showError(e.message));
/* =========================================================
   V9 TRADELOCKER CONNECTION
   ========================================================= */

async function loadTradeLockerConnection(){
  const status=$("#tradelockerStatus");
  const message=$("#tradelockerMessage");

  if(!status)return;

  try{
    const d=await api('/api/tradelocker/status');

    if(d.connected){
      setTradeLockerStatus(true);

      if($("#tlEnvironment") && d.environment){
        $("#tlEnvironment").value=d.environment;
      }

      if($("#tlServer") && d.server){
        $("#tlServer").value=d.server;
      }

      if($("#tlEmail")){
        $("#tlEmail").value='';
      }

      if($("#tlPassword")){
        $("#tlPassword").value='';
      }

      if(message){
        message.textContent='TradeLocker is connected.';
      }

      await loadTradeLockerAccounts();

    }else{
      setTradeLockerStatus(false);

      hideTradeLockerAccounts();

      if(message){
        if(d.status==='reconnect_required'){
          message.textContent='TradeLocker session expired. Please reconnect.';
        }else{
          message.textContent='No TradeLocker connection configured yet.';
        }
      }
    }

  }catch(e){
    console.warn('TradeLocker status check:',e.message);

    setTradeLockerStatus(false);
    hideTradeLockerAccounts();

    if(message){
      message.textContent='Unable to check TradeLocker connection.';
    }
  }
}


function setTradeLockerStatus(connected){
  const status=$("#tradelockerStatus");

  if(!status)return;

  if(connected){
    status.innerHTML='<span></span> Connected';
    status.classList.add('connected');
  }else{
    status.innerHTML='<span></span> Not connected';
    status.classList.remove('connected');
  }
}


function hideTradeLockerAccounts(){
  const box=$("#tradelockerAccountsBox");

  if(box){
    box.style.display='none';
  }

  clearTradeLockerAccountDetails();
}


function clearTradeLockerAccountDetails(){
  const fields=[
    "#tlAccountIdValue",
    "#tlAccNumValue",
    "#tlAccountNameValue",
    "#tlCurrencyValue",
    "#tlAccountStatusValue",
    "#tlBalanceValue",
    "#tlEquityValue",
    "#tlFreeMarginValue",
    "#tlMarginUsedValue",
    "#tlUnrealizedPlValue"
  ];

  fields.forEach(selector=>{
    const el=$(selector);
    if(el)el.textContent='—';
  });
}


async function loadTradeLockerAccounts(){
  const box=$("#tradelockerAccountsBox");
  const select=$("#tlAccountSelect");

  if(!box || !select)return;

  try{
    const d=await api('/api/tradelocker/accounts');

    const accounts=Array.isArray(d.accounts)
      ? d.accounts
      : [];

    const selected=d.selectedAccount||null;

    select.innerHTML='<option value="">Select an account</option>';

    accounts.forEach(account=>{
      const option=document.createElement('option');

      option.value=account.accountId||account.id||'';

      const name=account.accountName||account.name||'Account';
      const accNum=account.accNum!=null
        ? ` #${account.accNum}`
        : '';

      option.textContent=`${name}${accNum}`;

      if(
        selected &&
        String(option.value)===String(
          selected.accountId||selected.id||''
        )
      ){
        option.selected=true;
      }

      select.appendChild(option);
    });

    if(accounts.length){
      box.style.display='block';

      if(selected){
        updateTradeLockerAccountDetails(selected);
        await loadTradeLockerState();
      }else{
        clearTradeLockerAccountDetails();
      }
    }else{
      box.style.display='block';

      const option=document.createElement('option');
      option.value='';
      option.textContent='No TradeLocker accounts found';
      select.appendChild(option);

      clearTradeLockerAccountDetails();
    }

  }catch(e){
    console.warn('TradeLocker accounts:',e.message);

    box.style.display='none';

    const message=$("#tradelockerMessage");

    if(message){
      message.textContent=e.message;
    }
  }
}


function updateTradeLockerAccountDetails(account){
  if(!account)return;

  const accountId=
    account.accountId||
    account.id||
    '';

  const accNum=
    account.accNum!=null
      ? account.accNum
      : account.accountNumber!=null
        ? account.accountNumber
        : '';

  const accountName=
    account.accountName||
    account.name||
    '';

  const currency=
    account.currency||
    '';

  const accountStatus=
    account.status||
    '';

  if($("#tlAccountIdValue")){
    $("#tlAccountIdValue").textContent=accountId||'—';
  }

  if($("#tlAccNumValue")){
    $("#tlAccNumValue").textContent=
      accNum!=='' ? accNum : '—';
  }

  if($("#tlAccountNameValue")){
    $("#tlAccountNameValue").textContent=
      accountName||'—';
  }

  if($("#tlCurrencyValue")){
    $("#tlCurrencyValue").textContent=
      currency||'—';
  }

  if($("#tlAccountStatusValue")){
    $("#tlAccountStatusValue").textContent=
      accountStatus||'—';
  }
}


async function selectTradeLockerAccount(accountId){
  const message=$("#tradelockerMessage");
  const select=$("#tlAccountSelect");

  if(!accountId)return;

  if(select){
    select.disabled=true;
  }

  if(message){
    message.textContent='Selecting TradeLocker account...';
  }

  try{
    const d=await api('/api/tradelocker/select-account',{
      method:'POST',
      body:JSON.stringify({
        accountId
      })
    });

    if(d.selectedAccount){
      updateTradeLockerAccountDetails(d.selectedAccount);
    }

    await loadTradeLockerState();

    if(message){
      message.textContent=
        d.message||'TradeLocker account selected.';
    }

  }finally{
    if(select){
      select.disabled=false;
    }
  }
}


async function loadTradeLockerState(){
  try{
    const d=await api('/api/tradelocker/state');

    const state=d.state||d.accountState||null;

    if(!state){
      clearTradeLockerState();
      return;
    }

    if($("#tlBalanceValue")){
      $("#tlBalanceValue").textContent=
        formatTradeLockerNumber(state.balance);
    }

    if($("#tlEquityValue")){
      $("#tlEquityValue").textContent=
        formatTradeLockerNumber(state.equity);
    }

    if($("#tlFreeMarginValue")){
      $("#tlFreeMarginValue").textContent=
        formatTradeLockerNumber(
          state.freeMargin
        );
    }

    if($("#tlMarginUsedValue")){
      $("#tlMarginUsedValue").textContent=
        formatTradeLockerNumber(
          state.marginUsed
        );
    }

    if($("#tlUnrealizedPlValue")){
      $("#tlUnrealizedPlValue").textContent=
        formatTradeLockerNumber(
          state.unrealizedPl
        );
    }

  }catch(e){
    console.warn('TradeLocker state:',e.message);

    clearTradeLockerState();
  }
}


function clearTradeLockerState(){
  const fields=[
    "#tlBalanceValue",
    "#tlEquityValue",
    "#tlFreeMarginValue",
    "#tlMarginUsedValue",
    "#tlUnrealizedPlValue"
  ];

  fields.forEach(selector=>{
    const el=$(selector);

    if(el){
      el.textContent='—';
    }
  });
}


function formatTradeLockerNumber(value){
  if(value===null || value===undefined || value===''){
    return '—';
  }

  const number=Number(value);

  if(!Number.isFinite(number)){
    return String(value);
  }

  return number.toLocaleString(undefined,{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  });
}


async function connectTradeLocker(){
  const btn=$("#connectTradeLocker");
  const message=$("#tradelockerMessage");

  if(!btn)return;

  const environment=$("#tlEnvironment").value;
  const server=$("#tlServer").value.trim();
  const email=$("#tlEmail").value.trim();
  const password=$("#tlPassword").value;

  if(!server){
    throw Error('TradeLocker server is required.');
  }

  if(!email){
    throw Error('TradeLocker email is required.');
  }

  if(!password){
    throw Error('TradeLocker password is required.');
  }

  btn.disabled=true;

  if(message){
    message.textContent='Connecting to TradeLocker...';
  }

  try{
    const d=await api('/api/tradelocker/connect',{
      method:'POST',
      body:JSON.stringify({
        environment,
        server,
        email,
        password
      })
    });

    setTradeLockerStatus(true);

    if($("#tlPassword")){
      $("#tlPassword").value='';
    }

    if(message){
      message.textContent=
        d.message||
        'TradeLocker connected successfully.';
    }

    await loadTradeLockerAccounts();

  }finally{
    btn.disabled=false;
  }
}


async function disconnectTradeLocker(){
  const btn=$("#disconnectTradeLocker");
  const message=$("#tradelockerMessage");

  if(!confirm('Disconnect this TradeLocker account?')){
    return;
  }

  if(btn){
    btn.disabled=true;
  }

  try{
    const d=await api(
      '/api/tradelocker/disconnect',
      {
        method:'POST'
      }
    );

    setTradeLockerStatus(false);

    hideTradeLockerAccounts();

    if($("#tlServer")){
      $("#tlServer").value='';
    }

    if($("#tlEmail")){
      $("#tlEmail").value='';
    }

    if($("#tlPassword")){
      $("#tlPassword").value='';
    }

    if(message){
      message.textContent=
        d.message||
        'TradeLocker disconnected.';
    }

  }finally{
    if(btn){
      btn.disabled=false;
    }
  }
}


$("#connectTradeLocker")?.addEventListener(
  'click',
  async()=>{
    try{
      await connectTradeLocker();
    }catch(e){
      showError(e.message);

      const message=$("#tradelockerMessage");

      if(message){
        message.textContent=e.message;
      }
    }
  }
);


$("#disconnectTradeLocker")?.addEventListener(
  'click',
  async()=>{
    try{
      await disconnectTradeLocker();
    }catch(e){
      showError(e.message);
    }
  }
);


$("#tlAccountSelect")?.addEventListener(
  'change',
  async()=>{
    const accountId=$("#tlAccountSelect").value;

    if(!accountId)return;

    try{
      await selectTradeLockerAccount(accountId);
    }catch(e){
      showError(e.message);

      const message=$("#tradelockerMessage");

      if(message){
        message.textContent=e.message;
      }
    }
  }
);


$("#refreshTradeLockerState")?.addEventListener(
  'click',
  async()=>{
    const btn=$("#refreshTradeLockerState");

    if(btn){
      btn.disabled=true;
    }

    try{
      await loadTradeLockerState();
    }catch(e){
      showError(e.message);
    }finally{
      if(btn){
        btn.disabled=false;
      }
    }
  }
);
$("#syncTradeLocker")?.addEventListener(
  'click',
  async()=>{
    const btn=$("#syncTradeLocker");
    const message=$("#tradelockerMessage");

    if(btn){
      btn.disabled=true;
      btn.textContent='Syncing...';
    }

    if(message){
      message.textContent=
        'Synchronizing TradeLocker trades...';
    }

    try{
      const d=await api(
        '/api/tradelocker/sync',
        {
          method:'POST',
          body:JSON.stringify({
            dryRun:false
          })
        }
      );

      if(message){
        message.textContent=
          d.message||
          `Synced ${d.inserted||0} TradeLocker trades successfully.`;
      }

      alert(
        `TradeLocker sync complete.\n\n`+
        `Imported: ${d.inserted||0}\n`+
        `Skipped: ${d.skipped||0}\n`+
        `Total processed: ${d.normalizedTrades||0}`
      );

      await loadAccounts();
      await accounts();
      await dashboard();

    }catch(e){
      showError(e.message);

      if(message){
        message.textContent=
          e.message||
          'TradeLocker sync failed.';
      }

    }finally{
      if(btn){
        btn.disabled=false;
        btn.textContent='Sync Trades';
      }
    }
  }
);
/* =========================================================
   V8.3 MARKET CHART
   Real PostgreSQL candle data
   ========================================================= */

let marketChartInstance=null;
let marketCandleSeries=null;
let marketChartResizeObserver=null;
let marketChartLibraryPromise=null;


/* ---------------------------------------------------------
   Load Lightweight Charts
   --------------------------------------------------------- */

function loadMarketChartLibrary(){

  if(window.LightweightCharts){
    return Promise.resolve(window.LightweightCharts);
  }

  if(marketChartLibraryPromise){
    return marketChartLibraryPromise;
  }

  marketChartLibraryPromise=new Promise((resolve,reject)=>{

    const existing=
      document.querySelector(
        'script[data-ghost-market-chart]'
      );

    if(existing){

      existing.addEventListener(
        'load',
        ()=>{

          if(window.LightweightCharts)
            resolve(window.LightweightCharts);
          else
            reject(
              new Error(
                'Market chart library loaded incorrectly.'
              )
            );

        }
      );

      existing.addEventListener(
        'error',
        ()=>reject(
          new Error(
            'Could not load the market chart library.'
          )
        )
      );

      if(window.LightweightCharts){
        resolve(window.LightweightCharts);
      }

      return;
    }

    const script=document.createElement('script');

    script.src=
      'https://unpkg.com/lightweight-charts@5.0.0/dist/lightweight-charts.standalone.production.js';

    script.async=true;

    script.dataset.ghostMarketChart='1';

    script.onload=()=>{

      if(!window.LightweightCharts){

        reject(
          new Error(
            'Market chart library loaded incorrectly.'
          )
        );

        return;
      }

      resolve(window.LightweightCharts);
    };

    script.onerror=()=>{

      reject(
        new Error(
          'Could not load Lightweight Charts. Check your internet connection or CDN access.'
        )
      );

    };

    document.head.appendChild(script);

  });

  return marketChartLibraryPromise;
}


/* ---------------------------------------------------------
   Create chart
   --------------------------------------------------------- */

async function createMarketChart(){

  const container=$("#marketChart");

  if(!container){
    throw new Error(
      'Market chart container was not found.'
    );
  }

  const Charts=
    await loadMarketChartLibrary();

  if(
    marketChartInstance &&
    marketCandleSeries
  ){
    return;
  }

  marketChartInstance=
    Charts.createChart(
      container,
      {
        width:Math.max(
          300,
          container.clientWidth
        ),

        height:520,

        layout:{
          background:{
            type:'solid',
            color:'#ffffff'
          },

          textColor:'#172033'
        },

        grid:{
          vertLines:{
            color:'#edf0f4'
          },

          horzLines:{
            color:'#edf0f4'
          }
        },

        rightPriceScale:{
          borderColor:'#dfe4ea'
        },

        timeScale:{
          borderColor:'#dfe4ea',
          timeVisible:true,
          secondsVisible:false
        },

        crosshair:{
          mode:Charts.CrosshairMode.Normal
        },

        handleScroll:{
          mouseWheel:true,
          pressedMouseMove:true,
          horzTouchDrag:true,
          vertTouchDrag:true
        },

        handleScale:{
          mouseWheel:true,
          pinch:true,
          axisPressedMouseMove:true
        }
      }
    );

  marketCandleSeries=
    marketChartInstance.addSeries(
      Charts.CandlestickSeries,
      {
        upColor:'#13a36b',
        downColor:'#e0525d',
        borderUpColor:'#13a36b',
        borderDownColor:'#e0525d',
        wickUpColor:'#13a36b',
        wickDownColor:'#e0525d'
      }
    );


  updateMarketChartTheme(
    document.documentElement.getAttribute('data-theme')||'dark'
  );


  /* -------------------------------------------------------
     Responsive resize
     ------------------------------------------------------- */

  if(
    typeof ResizeObserver!=='undefined'
  ){

    if(marketChartResizeObserver){
      marketChartResizeObserver.disconnect();
    }

    marketChartResizeObserver=
      new ResizeObserver(()=>{

        if(
          !marketChartInstance ||
          !container
        ){
          return;
        }

        const width=
          Math.max(
            300,
            container.clientWidth
          );

        marketChartInstance.applyOptions({
          width
        });

      });

    marketChartResizeObserver.observe(
      container
    );

  }else{

    window.addEventListener(
      'resize',
      resizeMarketChart
    );

  }
}


/* ---------------------------------------------------------
   Fallback resize
   --------------------------------------------------------- */

function resizeMarketChart(){

  if(!marketChartInstance){
    return;
  }

  const container=$("#marketChart");

  if(!container){
    return;
  }

  marketChartInstance.applyOptions({
    width:Math.max(
      300,
      container.clientWidth
    )
  });
}


/* ---------------------------------------------------------
   Load real PostgreSQL candles
   --------------------------------------------------------- */

async function loadMarketCandles(){

  const symbol=
    $("#marketSymbol")?.value||
    'XAUUSD';

  const timeframe=
    $("#marketTimeframe")?.value||
    '1h';

  const limit=
    Number(
      $("#marketLimit")?.value||
      200
    );

  const status=
    $("#marketChartStatus");

  const title=
    $("#marketChartTitle");


  if(status){

    status.textContent=
      `Loading ${symbol} ${timeframe} candles...`;

  }


  if(title){

    title.textContent=
      `${symbol} · ${timeframe.toUpperCase()}`;

  }


  /* -------------------------------------------------------
     Create chart engine
     ------------------------------------------------------- */

  await createMarketChart();


  /* -------------------------------------------------------
     Request authenticated market candles
     ------------------------------------------------------- */

  const d=
    await api(
      `/api/market-data/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`
    );


  const seen=new Set();


  const candles=
    (d.candles||[])

      .map(c=>{

        const timestamp=
          new Date(
            c.candle_time
          ).getTime();

        const open=Number(c.open);
        const high=Number(c.high);
        const low=Number(c.low);
        const close=Number(c.close);

        if(
          !Number.isFinite(timestamp)||
          !Number.isFinite(open)||
          !Number.isFinite(high)||
          !Number.isFinite(low)||
          !Number.isFinite(close)
        ){
          return null;
        }

        return{
          time:Math.floor(
            timestamp/1000
          ),

          open,
          high,
          low,
          close
        };

      })

      .filter(Boolean)

      .sort(
        (a,b)=>a.time-b.time
      )

      .filter(c=>{

        if(seen.has(c.time)){
          return false;
        }

        seen.add(c.time);

        return true;

      });


  /* -------------------------------------------------------
     No candles available
     ------------------------------------------------------- */

  if(!candles.length){

    marketCandleSeries.setData([]);

    if(status){

      status.textContent=
        `No market candles available for ${symbol} ${timeframe}.`;

    }

    return;
  }


  /* -------------------------------------------------------
     Render real OHLC candles
     ------------------------------------------------------- */

  marketCandleSeries.setData(
    candles
  );


  marketChartInstance
    .timeScale()
    .fitContent();


  /* -------------------------------------------------------
     Update status
     ------------------------------------------------------- */

  const first=
    new Date(
      candles[0].time*1000
    );

  const last=
    new Date(
      candles[candles.length-1].time*1000
    );


  if(status){

    status.textContent=
      `${candles.length} real candles · `+
      `${first.toLocaleString()} → `+
      `${last.toLocaleString()}`;

  }

}


/* ---------------------------------------------------------
   Market Chart Page
   --------------------------------------------------------- */

async function marketChartLab(){

  const chart=
    $("#marketChart");

  if(!chart){
    return;
  }


  const loadButton=
    $("#loadMarketChart");


  /* -------------------------------------------------------
     Bind Load Chart button once
     ------------------------------------------------------- */

  if(
    loadButton &&
    !loadButton.dataset.bound
  ){

    loadButton.dataset.bound='1';


    loadButton.onclick=async()=>{

      loadButton.disabled=true;

      try{

        await loadMarketCandles();

      }catch(e){

        console.error(
          'Market chart error:',
          e
        );

        const status=
          $("#marketChartStatus");

        if(status){

          status.textContent=
            e.message||
            'Could not load market chart.';

        }

        showError(
          e.message||
          'Could not load market chart.'
        );

      }finally{

        loadButton.disabled=false;

      }

    };

  }


  /* -------------------------------------------------------
     First page load
     ------------------------------------------------------- */

  await loadMarketCandles();

}


/* =========================================================
   GLOBAL RESIZE
   ========================================================= */

let rt;

window.addEventListener('resize',()=>{

  clearTimeout(rt);

  rt=setTimeout(()=>{

    if(
      $("#dashboard") &&
      !$("#dashboard").classList.contains('hide')
    ){
      dashboard().catch(()=>{});
    }

  },180);

});


/* =========================================================
   PREMIUM THEME
   ========================================================= */

function applyGhostTheme(theme,save=true){
  const next=theme==='light'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);

  if(save){
    try{
      localStorage.setItem('ghosttrader-theme',next);
    }catch(e){}
  }

  const button=$("#themeToggle");

  if(button){
    const dark=next==='dark';
    button.innerHTML=dark?'☀ <span>Light mode</span>':'☾ <span>Dark mode</span>';
    button.setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
    button.setAttribute('title',dark?'Switch to light mode':'Switch to dark mode');
  }

  updateMarketChartTheme(next);
}

function updateMarketChartTheme(theme){
  if(!marketChartInstance||typeof marketChartInstance.applyOptions!=='function')return;

  const dark=theme==='dark';

  marketChartInstance.applyOptions({
    layout:{
      background:{type:'solid',color:dark?'#101722':'#ffffff'},
      textColor:dark?'#edf3fb':'#172033'
    },
    grid:{
      vertLines:{color:dark?'#202b3a':'#edf0f4'},
      horzLines:{color:dark?'#202b3a':'#edf0f4'}
    },
    rightPriceScale:{borderColor:dark?'#2a3748':'#dfe4ea'},
    timeScale:{borderColor:dark?'#2a3748':'#dfe4ea'}
  });
}

function initGhostTheme(){
  let theme='dark';

  try{
    const saved=localStorage.getItem('ghosttrader-theme');
    if(saved==='light'||saved==='dark')theme=saved;
  }catch(e){}

  applyGhostTheme(theme,false);

  const button=$("#themeToggle");

  if(button&&!button.dataset.bound){
    button.dataset.bound='1';

    button.onclick=()=>{
      const current=document.documentElement.getAttribute('data-theme')||'dark';
      applyGhostTheme(current==='dark'?'light':'dark');
    };
  }
}

initGhostTheme();
