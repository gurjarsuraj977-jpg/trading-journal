function table(t,full=true){
  if(!t.length)
    return'<p style="color:#98a2af">No trades found.</p>';

  /* Desktop table + mobile cards from the SAME trade array.
     No second API, no duplicate state, same editTrade/delTrade handlers. */
  const rows=t.map(x=>`
            <tr>
              <td>${E(formatDay(x.trade_date))}</td>
              <td><b>${E(x.symbol)}</b></td>
              <td>
                <span class="side-pill">
                  ${E(x.direction)}
                </span>
              </td>
<td>${E(x.account)}</td> <td>   <b>${M(x.risk_amount)}</b>   <small class="risk-level ${String(x.risk_level || "UNKNOWN").toLowerCase()}">     ${E(x.risk_level || "UNKNOWN")}   </small> </td> <td class="${C(x.profit_loss)}">
                <b>${M(x.profit_loss)}</b>
              </td>
              <td>
                ${Number(x.actual_r||0).toFixed(2)}R
              </td>

              ${
                full?
                `
                <td>${E(x.strategy||'—')}</td>

                <td>
                  <button
                    class="secondary"
                    type="button"
                    onclick="editTrade(${Number(x.id)})"
                  >
                    Edit
                  </button>

                  <button
                    class="secondary"
                    type="button"
                    onclick="delTrade(${Number(x.id)})"
                  >
                    Delete
                  </button>
                </td>
                `:
                ''
              }
            </tr>
          `).join('');

  const cards=t.map(x=>{
    const pl=Number(x.profit_loss||0);
    const r=Number(x.actual_r||0);
    const dir=String(x.direction||'').toUpperCase();
    return`
      <article class="trade-card ${pl>=0?'trade-card-win':'trade-card-loss'}">
        <div class="trade-card-top">
          <div>
            <b class="trade-card-symbol">${E(x.symbol)}</b>
            <span class="side-pill">${E(dir)}</span>
          </div>
          <div class="trade-card-pnl ${C(x.profit_loss)}">
            <strong>${M(x.profit_loss)}</strong>
            <small>${r.toFixed(2)}R</small>
          </div>
        </div>
        <div class="trade-card-meta">
          <span><em>Date</em>${E(formatDay(x.trade_date))}</span>
          <span><em>Account</em>${E(x.account||'—')}</span>
          <span><em>Risk</em>${M(x.risk_amount)} <small class="risk-level ${String(x.risk_level||'UNKNOWN').toLowerCase()}">${E(x.risk_level||'UNKNOWN')}</small></span>
          ${x.strategy?`<span><em>Strategy</em>${E(x.strategy)}</span>`:''}
        </div>
        <details class="trade-card-details">
          <summary>Details</summary>
          <div class="trade-card-detail-grid">
            <span><em>Entry</em>${E(x.entry_price??x.entry??'—')}</span>
            <span><em>Exit</em>${E(x.exit_price??x.exitPrice??'—')}</span>
            <span><em>Stop</em>${E(x.stop_loss??x.stopLoss??'—')}</span>
            <span><em>Target</em>${E(x.take_profit??x.takeProfit??'—')}</span>
            <span><em>Qty</em>${E(x.quantity??'—')}</span>
            <span><em>Setup</em>${E(x.setup||'—')}</span>
            <span><em>Session</em>${E(x.session||'—')}</span>
            <span><em>Notes</em>${E(x.notes||'—')}</span>
          </div>
        </details>
        ${full?`
        <div class="trade-card-actions">
          <button class="secondary" type="button" onclick="editTrade(${Number(x.id)})">Edit</button>
          <button class="secondary" type="button" onclick="delTrade(${Number(x.id)})">Delete</button>
        </div>`:''}
      </article>`;
  }).join('');

  return`
    <div class="tablewrap trade-table-desktop">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Account</th><th>Risk</th><th>P&L</th><th>R</th>
            ${full?'<th>Strategy</th><th>Actions</th>':''}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="trade-cards-mobile">${cards}</div>
  `;
}

async function trades(){
  const q=new URLSearchParams();

  if($("#fs").value.trim())
    q.set('symbol',$("#fs").value.trim());

  if($("#fd").value)
    q.set('direction',$("#fd").value);

  if($("#fr").value)
    q.set('result',$("#fr").value);

  if($("#tradeAccount").value)
    q.set('account',$("#tradeAccount").value);

  const d=await api('/api/trades?'+q);

  state.trades=d.trades||[];

  $("#tradeTable").innerHTML=
    table(state.trades);
}

['fs','fd','fr','tradeAccount'].forEach(x=>
  $("#"+x).addEventListener(
    'input',
    ()=>trades().catch(e=>showError(e.message))
  )
);

$("#cf").onclick=()=>{
  ['fs','fd','fr','tradeAccount']
    .forEach(x=>$("#"+x).value='');

  trades().catch(e=>showError(e.message));
};

function localNow(){
  const d=new Date();

  d.setSeconds(0,0);

  const off=d.getTimezoneOffset();

  return new Date(
    d.getTime()-off*60000
  ).toISOString().slice(0,16);
}

function openModal(t){
  state.edit=t||null;

  $("#mh").textContent=
    t?'Edit trade':'Add trade';

  $("#tf").reset();

  /*
   * Batch 1B: editing an existing trade must always be able to show
   * that trade's own account, even if it has since been archived
   * (activeOnly=false) — otherwise saving the edit would silently
   * reassign it to a different account. Adding a brand-new trade
   * only offers active accounts (activeOnly=true), with the default
   * selection falling back to the first active account rather than
   * simply state.accounts[0], which could itself be archived.
   */
  $("#ta").innerHTML=
    accountOptions(
      t?.account||
      state.accounts.find(a=>a.active!==false)?.name||
      state.accounts[0]?.name||
      '',
      !t
    );

  $("#tt").value=localNow();

  if(t){
    const map={
      tid:'id',
      ts:'symbol',
      td:'direction',
      te:'entry',
      sl:'stop_loss',
      tp:'take_profit',
      ex:'exit_price',
      qty:'quantity',
      risk:'risk_amount',
      riskp:'risk_percent',
      pl:'profit_loss',
      prr:'planned_rr',
      ar:'actual_r',
      mfe:'mfe_r',
      mae:'mae_r',
      mfp:'max_favorable_price',
      map:'max_adverse_price',
      rulescore:'rule_score',
      strategy:'strategy',
      setup:'setup',
      session:'session',
      mc:'market_condition',
      conf:'confidence',
      eb:'emotion_before',
      ea:'emotion_after',
      mist:'mistakes',
      er:'entry_reason',
      xr:'exit_reason',
      notes:'notes'
    };

    Object.entries(map).forEach(([a,b])=>{
      if($("#"+a))
        $("#"+a).value=t[b]??'';
    });

    if($('#playbook'))
      $('#playbook').value=t.playbook_id||'';

    const dt=new Date(t.trade_date);

    if(!Number.isNaN(dt.getTime())){
      const off=dt.getTimezoneOffset();

      $("#tt").value=
        new Date(
          dt.getTime()-off*60000
        ).toISOString().slice(0,16);
    }
  }

  $("#shot").value='';

  $("#modal").classList.remove('hide');
}

$("#add").onclick=()=>openModal();

$("#close").onclick=
$("#cancel").onclick=()=>
  $("#modal").classList.add('hide');

$("#modal").onclick=e=>{
  if(e.target===$("#modal"))
    $("#modal").classList.add('hide');
};

document.addEventListener('keydown',e=>{
  if(e.key==='Escape')
    $("#modal").classList.add('hide');
});

$("#save").onclick=async()=>{
  const btn=$("#save");

  btn.disabled=true;

  try{
    if(!$("#ta").value)
      throw Error(
        'Create an account before adding a trade.'
      );

    if(!$("#ts").value.trim())
      throw Error('Symbol is required.');

    if(!$("#te").value)
      throw Error('Entry price is required.');

    const f=$("#shot").files[0];

    let img=
      state.edit?.screenshot_data||'';

    if(f){
      if(!f.type.startsWith('image/'))
        throw Error(
          'Please select an image.'
        );

      if(f.size>3e6)
        throw Error(
          'Screenshot must be under 3MB'
        );

      img=await fileData(f);
    }

    const b={
      account:$("#ta").value,
      symbol:$("#ts").value,
      direction:$("#td").value,
      tradeDate:$("#tt").value,
      entry:$("#te").value,
      stopLoss:$("#sl").value,
      takeProfit:$("#tp").value,
      exitPrice:$("#ex").value,
      quantity:$("#qty").value,
      riskAmount:$("#risk").value,
      riskPercent:$("#riskp").value,
      profitLoss:$("#pl").value,
      plannedRr:$("#prr").value,
      actualR:$("#ar").value,
      mfeR:$("#mfe").value,
      maeR:$("#mae").value,
      maxFavorablePrice:$("#mfp").value,
      maxAdversePrice:$("#map").value,
      ruleScore:$("#rulescore").value,
      playbookId:$("#playbook").value,
      strategy:$("#strategy").value,
      setup:$("#setup").value,
      session:$("#session").value,
      marketCondition:$("#mc").value,
      confidence:$("#conf").value,
      emotionBefore:$("#eb").value,
      emotionAfter:$("#ea").value,
      mistakes:$("#mist").value,
      entryReason:$("#er").value,
      exitReason:$("#xr").value,
      notes:$("#notes").value,
      screenshotData:img
    };

    await api(
      state.edit?
        '/api/trades/'+state.edit.id:
        '/api/trades',
      {
        method:state.edit?'PUT':'POST',
        body:JSON.stringify(b)
      }
    );

    $("#modal").classList.add('hide');

    state.edit=null;

    await loadAccounts();
    await trades();
    await dashboard();

  }catch(e){
    showError(e.message);
  }finally{
    btn.disabled=false;
  }
};

window.editTrade=async id=>{
  try{
    /*
     * Batch A2: the Journal list no longer carries screenshot_data,
     * so state.trades entries don't have it either. Fetch this one
     * trade's full record (screenshot included) via the targeted
     * single-trade endpoint so editing still preserves an existing
     * screenshot when the user doesn't pick a new file.
     */
    const t=(await api('/api/trades/'+id)).trade;

    if(!t)
      throw Error('Trade not found.');

    openModal(t);

  }catch(e){
    showError(e.message);
  }
};

window.delTrade=async id=>{
  if(!confirm(
    'Delete this trade permanently?'
  ))return;

  try{
    await api('/api/trades/'+id,{
      method:'DELETE'
    });

    await loadAccounts();
    await trades();
    await dashboard();

  }catch(e){
    showError(e.message);
  }
};
