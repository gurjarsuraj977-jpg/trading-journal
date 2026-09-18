async function dashboard(){
  const d=await api('/api/analytics?'+query());

  state.lastAnalytics=d;

  const s=d.summary||{};

  $("#periodText").textContent=
    (state.account?state.account+' · ':'')+
    periodLabel();

  $("#stats").innerHTML=[
    st('Net P&L',M(s.pnl),'',C(s.pnl)),
    st(
      'Gain %',
      s.startingBalance?
        ((Number(s.pnl)/Number(s.startingBalance))*100).toFixed(2)+'%':
        '—',
      'vs starting balance',
      C(s.pnl)
    ),
    st('Trade count',s.total||0),
    st('Win rate',Number(s.winRate||0).toFixed(1)+'%'),
    st(
      'Profit factor',
      Number.isFinite(Number(s.profitFactor))?
        Number(s.profitFactor).toFixed(2):
        '∞'
    )
  ].join('');

  $("#perf").innerHTML=[
    ['Starting balance',M(s.startingBalance)],
    ['Current equity',M(s.currentEquity),C(s.currentEquity)],
    ['Max drawdown',M(s.maxDrawdown),'negative'],
    ['Expectancy',M(s.expectancy),C(s.expectancy)],
    ['Avg win',M(s.avgWin),C(s.avgWin)],
    ['Avg loss',M(s.avgLoss),'negative'],
    ['Avg R',Number(s.avgR||0).toFixed(2)+'R',C(s.avgR)],
    ['Avg risk',Number(s.avgRisk||0).toFixed(2)+'%'],
    ['Best streak',(s.bestWinStreak||0)+' wins'],
    ['Worst streak',(s.bestLossStreak||0)+' losses']
  ].map(x=>
    `<p><span>${E(x[0])}</span><b class="${x[2]||''}">${E(x[1])}</b></p>`
  ).join('');

  draw(d.byDay||[]);
  drawPnl(d.byDay||[]);
  drawDonut(d.bySymbol||[]);

  $("#pnlTotal").textContent=M(s.pnl);

  const t=await api('/api/trades?'+query())
    .catch(()=>({trades:[]}));

  state.trades=t.trades||[];

  $("#recent").innerHTML=
    table(state.trades.slice(0,8),false);
}

function periodLabel(){
  return({
    all:'All recorded trades',
    month:'This month',
    '3m':'Last 3 months',
    '6m':'Last 6 months',
    year:'Last 12 months'
  })[state.range]||'Performance overview';
}

function prepCanvas(c,h){
  const box=c.parentElement;
  const w=Math.max(300,box.clientWidth-30);
  const dpr=window.devicePixelRatio||1;

  c.style.height=h+'px';
  c.width=Math.round(w*dpr);
  c.height=Math.round(h*dpr);

  const ctx=c.getContext('2d');

  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);

  return{ctx,w,h};
}

function draw(days){
  const c=$("#chart");

  if(!c)return;

  const {ctx,w,h}=prepCanvas(c,315);

  const rows=(days||[])
    .filter(x=>x&&x.day)
    .slice()
    .sort((a,b)=>String(a.day).localeCompare(String(b.day)));

  const pad={
    l:58,
    r:16,
    t:20,
    b:34
  };

  ctx.font='10px system-ui';

  if(!rows.length){
    ctx.fillStyle='#98a2af';
    ctx.textAlign='center';
    ctx.fillText(
      'No closed trades in this period',
      w/2,
      h/2
    );
    return;
  }

  let eq=0;

  const vals=rows.map(
    x=>eq+=Number(x.pnl||0)
  );

  let mi=Math.min(0,...vals);
  let ma=Math.max(0,...vals);
  let rg=ma-mi||1;

  const X=i=>
    pad.l+
    i*(w-pad.l-pad.r)/
    Math.max(1,vals.length-1);

  const Y=v=>
    pad.t+
    (ma-v)/rg*
    (h-pad.t-pad.b);

  ctx.strokeStyle='#edf0f4';
  ctx.fillStyle='#8994a3';

  for(let i=0;i<=4;i++){
    const y=
      pad.t+
      i*(h-pad.t-pad.b)/4;

    const val=ma-rg*i/4;

    ctx.beginPath();
    ctx.moveTo(pad.l,y);
    ctx.lineTo(w-pad.r,y);
    ctx.stroke();

    ctx.textAlign='right';
    ctx.fillText(
      M(val),
      pad.l-7,
      y+3
    );
  }

  ctx.strokeStyle='#bfc8d3';
  ctx.beginPath();
  ctx.moveTo(pad.l,Y(0));
  ctx.lineTo(w-pad.r,Y(0));
  ctx.stroke();

  ctx.strokeStyle='#1769d2';
  ctx.lineWidth=2.3;
  ctx.beginPath();

  vals.forEach((v,i)=>
    i?
      ctx.lineTo(X(i),Y(v)):
      ctx.moveTo(X(i),Y(v))
  );

  ctx.stroke();

  ctx.fillStyle='#1769d2';
  ctx.beginPath();

  ctx.arc(
    X(vals.length-1),
    Y(vals.at(-1)),
    3.5,
    0,
    Math.PI*2
  );

  ctx.fill();

  ctx.fillStyle='#8c97a5';
  ctx.textAlign='left';

  ctx.fillText(
    formatDay(rows[0].day),
    pad.l,
    h-9
  );

  ctx.textAlign='right';

  ctx.fillText(
    formatDay(rows.at(-1).day),
    w-pad.r,
    h-9
  );

  ctx.fillStyle='#172033';
  ctx.font='bold 11px system-ui';
  ctx.textAlign='left';

  ctx.fillText(
    'Ending P&L '+M(vals.at(-1)),
    pad.l,
    11
  );
}

function drawPnl(days){
  const c=$("#pnlChart");

  if(!c)return;

  const {ctx,w,h}=prepCanvas(c,265);

  const rows=(days||[])
    .filter(x=>x&&x.day);

  if(!rows.length){
    ctx.fillStyle='#98a2af';
    ctx.textAlign='center';

    ctx.fillText(
      'No data yet',
      w/2,
      h/2
    );

    return;
  }

  const vals=rows.map(
    x=>Number(x.pnl||0)
  );

  const max=Math.max(
    ...vals.map(Math.abs),
    1
  );

  const pad={
    l:35,
    r:10,
    t:10,
    b:28
  };

  const barW=Math.max(
    3,
    (w-pad.l-pad.r)/vals.length-2
  );

  ctx.strokeStyle='#edf0f4';
  ctx.beginPath();

  ctx.moveTo(pad.l,h/2);
  ctx.lineTo(w-pad.r,h/2);

  ctx.stroke();

  vals.forEach((v,i)=>{
    const x=
      pad.l+
      i*((w-pad.l-pad.r)/vals.length)+1;

    const hh=
      Math.abs(v)/max*
      (h/2-20);

    ctx.fillStyle=
      v>=0?'#1769d2':'#e0525d';

    ctx.fillRect(
      x,
      v>=0?h/2-hh:h/2,
      barW,
      hh
    );
  });

  ctx.fillStyle='#98a2af';
  ctx.font='10px system-ui';
  ctx.textAlign='left';

  ctx.fillText(
    formatDay(rows[0].day),
    pad.l,
    h-8
  );

  ctx.textAlign='right';

  ctx.fillText(
    formatDay(rows.at(-1).day),
    w-pad.r,
    h-8
  );
}

function drawDonut(data){
  const c=$("#donut");

  if(!c)return;

  const {ctx,w,h}=prepCanvas(c,210);

  const rows=(data||[])
    .filter(x=>Number(x.trades)>0)
    .slice(0,6);

  const total=rows.reduce(
    (a,x)=>a+Number(x.trades||0),
    0
  );

  ctx.clearRect(0,0,w,h);

  const cx=w/2;
  const cy=h/2;
  const r=Math.min(w,h)*.32;

  const colors=[
    '#1769d2',
    '#37a3e8',
    '#13a36b',
    '#f3ad35',
    '#e0525d',
    '#8067d9'
  ];

  let a=-Math.PI/2;

  rows.forEach((x,i)=>{
    const end=
      a+
      (Number(x.trades)/total)*
      Math.PI*2;

    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      r,
      a,
      end
    );

    ctx.lineWidth=28;
    ctx.strokeStyle=
      colors[i%colors.length];

    ctx.stroke();

    a=end;
  });

  $("#donutCenter").innerHTML=
    `${total}<small>TRADES</small>`;

  $("#symbolLegend").innerHTML=
    rows.map((x,i)=>
      `<div class="item">
        <span class="dot" style="background:${colors[i%colors.length]}"></span>
        <span>${E(x.symbol)}</span>
        <b>${Number(x.trades)}</b>
      </div>`
    ).join('')||
    '<small>No trades yet.</small>';
}

$("#dashAccount").onchange=async()=>{
  state.account=$("#dashAccount").value;
  await dashboard();
};

$("#range").onchange=async()=>{
  state.range=$("#range").value;
  await dashboard();
};
