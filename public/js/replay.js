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

