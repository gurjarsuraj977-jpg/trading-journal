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
