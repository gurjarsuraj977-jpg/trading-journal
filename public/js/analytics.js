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
