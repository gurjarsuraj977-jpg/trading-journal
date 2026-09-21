/*
 * Accounts V2 — Account Command Center.
 *
 * Module-level state for this page only (kept local to this file,
 * consistent with how other page modules — analytics.js, calendar.js —
 * keep their own working state rather than polluting the shared
 * `state` object in state.js, which stays reserved for the app-wide
 * account/date filters used across pages).
 */
let accountsData=[];
let accountsSummary={};
let detailAccountId=null;
let detailData=null;
let detailFilters={};
let accountModalMode='create';

/* ---------------------------------------------------------------
   List + Portfolio Overview
   --------------------------------------------------------------- */

async function accounts(){
  const d=await api('/api/accounts');

  accountsData=d.accounts||[];
  accountsSummary=d.summary||{};

  renderAccountsSummary();
  renderAccountsGrid();
}

function renderAccountsSummary(){
  const s=accountsSummary;

  $("#accountsSummary").innerHTML=[
    st('Total accounts',s.totalAccounts||0),
    st('Active accounts',s.activeAccounts||0),
    st('Total capital',M(s.totalCapital)),
    st('Current equity',M(s.currentEquity),'',C(s.currentEquity)),
    st('Total P&L',M(s.totalPnl),'',C(s.totalPnl))
  ].join('');
}

function renderAccountsGrid(){
  if(!accountsData.length){
    $("#accountsList").innerHTML=`
      <div class="account-empty">
        <b>No accounts yet</b>
        Add your first trading account to start tracking capital, risk and performance.
      </div>`;
    return;
  }

  $("#accountsList").innerHTML=accountsData.map(accountCardHtml).join('');
}

function accBadges(a){
  const badges=[];

  if(a.is_primary)badges.push('<span class="acc-badge acc-badge-primary">Primary</span>');
  badges.push(
    a.active===false
      ?'<span class="acc-badge acc-badge-inactive">Archived</span>'
      :'<span class="acc-badge acc-badge-active">Active</span>'
  );
  badges.push(`<span class="acc-badge acc-badge-type">${E(accountTypeLabel(a.account_type))}</span>`);

  return badges.join('');
}

function accountTypeLabel(t){
  return{
    manual:'Manual',
    prop:'Prop firm',
    personal:'Personal',
    demo:'Demo',
    evaluation:'Evaluation'
  }[t]||'Manual';
}

function accountCardHtml(a){
  const archived=a.active===false;

  return `<div class="account-card${archived?' archived':''}">
    <div class="acc-card-top">
      <div class="acc-card-id">
        <h3>${E(a.name)}</h3>
        <p class="acc-card-sub">${E(a.broker||'No broker set')} · ${E(a.currency||'USD')}</p>
        <div class="acc-badges">${accBadges(a)}</div>
      </div>

      <div class="acc-menu-wrap">
        <button class="acc-menu-btn" type="button" onclick="toggleAccMenu(event,${a.id})">⋯</button>
        <div class="acc-menu" id="accMenu${a.id}">
          <button type="button" onclick="closeAccMenus();openAccountModal('edit',${a.id})">Edit account</button>
          ${a.is_primary?'':`<button type="button" onclick="closeAccMenus();setPrimaryAccount(${a.id})">Set as primary</button>`}
          <button type="button" onclick="closeAccMenus();${archived?'reactivateAccount':'archiveAccount'}(${a.id})">${archived?'Reactivate':'Archive'}</button>
          <button type="button" class="danger" onclick="closeAccMenus();deleteAccountConfirm(${a.id})">Delete</button>
        </div>
      </div>
    </div>

    <div class="acc-metrics">
      <div class="acc-metric"><span>Balance</span><b>${M(a.starting_balance)}</b></div>
      <div class="acc-metric"><span>Equity</span><b>${M(a.equity)}</b></div>
      <div class="acc-metric"><span>P&amp;L</span><b class="${C(a.pnl)}">${M(a.pnl)}</b></div>
      <div class="acc-metric"><span>Avg risk</span><b>${Number(a.avg_risk_percent||0).toFixed(2)}%</b></div>
    </div>

    <div class="acc-card-foot">
      <span>${a.trade_count} trade${a.trade_count===1?'':'s'}</span>
      <span>${a.trade_count?Number(a.win_rate||0).toFixed(1)+'% win rate':'No trades yet'}</span>
    </div>

    <div class="acc-card-actions">
      <button class="primary" type="button" onclick="openAccountDetail(${a.id})">Open</button>
      <button class="secondary" type="button" onclick="openAccountModal('edit',${a.id})">Edit</button>
    </div>
  </div>`;
}

function toggleAccMenu(e,id){
  e.stopPropagation();
  const el=$("#accMenu"+id);
  const wasOpen=el.classList.contains('show');
  closeAccMenus();
  if(!wasOpen)el.classList.add('show');
}

function closeAccMenus(){
  $$('.acc-menu.show').forEach(m=>m.classList.remove('show'));
}

document.addEventListener('click',closeAccMenus);

/* ---------------------------------------------------------------
   Create / Edit
   --------------------------------------------------------------- */

$("#newacc").onclick=()=>openAccountModal('create');

function openAccountModal(mode,id){
  accountModalMode=mode;
  const a=mode==='edit'?accountsData.find(x=>x.id===id):null;

  $("#accountModalTitle").textContent=mode==='edit'?'Edit account':'Add account';
  $("#accId").value=a?a.id:'';
  $("#accName").value=a?a.name:'';
  $("#accBroker").value=a?(a.broker||''):'';
  $("#accType").value=a?(a.account_type||'manual'):'manual';
  $("#accBalance").value=a?Number(a.starting_balance||0):10000;
  $("#accCurrency").value=a?(a.currency||'USD'):'USD';
  $("#accIsPrimary").checked=a?!!a.is_primary:accountsData.length===0;
  $("#accActive").checked=a?a.active!==false:true;

  const hasTrades=a&&Number(a.trade_count||0)>0;
  $("#accCurrency").disabled=!!hasTrades;
  $("#accCurrencyHint").classList.toggle('hide',!hasTrades);

  // A brand-new account has no "active" toggle to show — it's always
  // active by definition. Archiving is a decision made later, from the
  // account card, once there's something to archive.
  $("#accActiveRow").classList.toggle('hide',mode==='create');

  $("#accountModal").classList.remove('hide');
}

function closeAccountModal(){
  $("#accountModal").classList.add('hide');
}

$("#accountModalClose").onclick=closeAccountModal;
$("#accountModalCancel").onclick=closeAccountModal;
$("#accountModal").onclick=e=>{
  if(e.target===$("#accountModal"))closeAccountModal();
};

$("#accountModalSave").onclick=async()=>{
  const name=$("#accName").value.trim();
  if(!name){
    showError('Account name is required.');
    return;
  }

  const body={
    name,
    broker:$("#accBroker").value.trim(),
    accountType:$("#accType").value,
    startingBalance:$("#accBalance").value,
    currency:$("#accCurrency").value,
    isPrimary:$("#accIsPrimary").checked
  };

  if(accountModalMode==='edit')body.active=$("#accActive").checked;

  try{
    if(accountModalMode==='edit'){
      await api(`/api/accounts/${$("#accId").value}`,{method:'PUT',body:JSON.stringify(body)});
    }else{
      await api('/api/accounts',{method:'POST',body:JSON.stringify(body)});
    }

    closeAccountModal();
    await loadAccounts();
    await accounts();
    dashboard().catch(()=>{});
  }catch(e){
    showError(e.message);
  }
};

/* ---------------------------------------------------------------
   Lifecycle actions
   --------------------------------------------------------------- */

async function archiveAccount(id){
  if(!confirm('Archive this account? It will no longer be selectable when adding new trades, but its balance, P&L and trade history stay exactly as they are. You can reactivate it anytime.'))return;

  try{
    await api(`/api/accounts/${id}`,{method:'PUT',body:JSON.stringify({active:false})});
    await loadAccounts();
    await accounts();
    dashboard().catch(()=>{});
  }catch(e){
    showError(e.message);
  }
}

async function reactivateAccount(id){
  try{
    await api(`/api/accounts/${id}`,{method:'PUT',body:JSON.stringify({active:true})});
    await loadAccounts();
    await accounts();
    dashboard().catch(()=>{});
  }catch(e){
    showError(e.message);
  }
}

async function setPrimaryAccount(id){
  try{
    await api(`/api/accounts/${id}`,{method:'PUT',body:JSON.stringify({isPrimary:true})});
    await accounts();
  }catch(e){
    showError(e.message);
  }
}

async function deleteAccountConfirm(id){
  const a=accountsData.find(x=>x.id===id);

  if(a&&Number(a.trade_count||0)>0){
    alert(`"${a.name}" has ${a.trade_count} trade(s) attached. To protect your trading history, accounts with trades can only be archived, not deleted. Use "Archive" instead.`);
    return;
  }

  if(!confirm(`Permanently delete "${a?a.name:'this account'}"? This can't be undone. (Only empty accounts with no trades can be deleted.)`))return;

  try{
    await api(`/api/accounts/${id}`,{method:'DELETE'});
    await loadAccounts();
    await accounts();
  }catch(e){
    showError(e.message);
  }
}

/* ---------------------------------------------------------------
   Account Detail — "Account Command Center"
   --------------------------------------------------------------- */

async function openAccountDetail(id){
  detailAccountId=id;
  detailFilters={};
  clearDetailFilterInputs();
  await loadAccountDetail();
  switchAccTab('overview');
  $("#accountDetailModal").classList.remove('hide');
}

function closeAccountDetail(){
  $("#accountDetailModal").classList.add('hide');
}

$("#accountDetailClose").onclick=closeAccountDetail;
$("#accountDetailModal").onclick=e=>{
  if(e.target===$("#accountDetailModal"))closeAccountDetail();
};

$$('.acc-tabs button').forEach(b=>
  b.onclick=()=>switchAccTab(b.dataset.tab)
);

function switchAccTab(tab){
  $$('.acc-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  $$('.acc-tab-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tab));
}

async function loadAccountDetail(){
  const q=new URLSearchParams(detailFilters);
  const d=await api(`/api/accounts/${detailAccountId}?${q}`);
  detailData=d;
  renderAccountDetail(d);
}

$("#accDetailEditBtn").onclick=()=>{
  if(!detailData)return;
  closeAccountDetail();
  openAccountModal('edit',detailData.account.id);
};

function renderAccountDetail(d){
  const a=d.account,p=d.performance,r=d.risk;

  $("#accDetailName").textContent=a.name;
  $("#accDetailBadges").innerHTML=accBadges({
    is_primary:a.is_primary,active:a.active,account_type:a.account_type
  });

  renderAccHealth(a,p,r);

  $("#accOverviewStats").innerHTML=[
    st('Balance',M(a.starting_balance)),
    st('Equity',M(p.currentEquity),'',C(p.currentEquity)),
    st('Net P&L',M(p.pnl),'',C(p.pnl)),
    st('Trades',p.total),
    st('Win rate',p.total?Number(p.winRate).toFixed(1)+'%':'—')
  ].join('');

  drawAccountEquity(d.equityCurve||[]);
  renderAccTimeline(a,d);

  $("#accPerfStats").innerHTML=[
    st('Win rate',p.total?Number(p.winRate).toFixed(1)+'%':'—'),
    st('Profit factor',p.profitFactorInfinite?'∞':Number(p.profitFactor).toFixed(2)),
    st('Avg R',Number(p.avgR||0).toFixed(2)+'R','',C(p.avgR)),
    st('Expectancy',M(p.expectancy),'',C(p.expectancy))
  ].join('');

  $("#accPerfList").innerHTML=[
    ['Starting balance',M(p.startingBalance)],
    ['Current equity',M(p.currentEquity),C(p.currentEquity)],
    ['Best trade',M(p.bestTrade),'positive'],
    ['Worst trade',M(p.worstTrade),'negative'],
    ['Avg win',M(p.avgWin),'positive'],
    ['Avg loss',M(p.avgLoss),'negative'],
    ['Max drawdown',M(p.maxDrawdown),'negative'],
    ['Best win streak',p.bestWinStreak+' wins'],
    ['Worst loss streak',p.bestLossStreak+' losses']
  ].map(x=>`<p><span>${E(x[0])}</span><b class="${x[2]||''}">${E(x[1])}</b></p>`).join('');

  $("#accRiskList").innerHTML=[
    ['Avg risk per trade',Number(r.avgRiskPercent||0).toFixed(2)+'%'],
    ['Avg risk amount',M(r.avgRiskAmount)],
    ['Largest single risk',Number(r.largestRiskPercent||0).toFixed(2)+'%'],
    ['Risk consistency',r.riskConsistency===null?'Not enough data yet':r.riskConsistency+' / 100']
  ].map(x=>`<p><span>${E(x[0])}</span><b>${E(x[1])}</b></p>`).join('');

  $("#accTradesTable").innerHTML=table(d.trades||[],false);
}

function renderAccHealth(a,p,r){
  const startBal=Number(a.starting_balance||0);

  if(!p.total){
    $("#accHealthScore").textContent='—';
    $("#accHealthFill").style.width='0%';
    $("#accHealthBox small").textContent='Not enough trades yet to estimate account health.';
    return;
  }

  const winScore=Math.max(0,Math.min(100,Number(p.winRate||0)));
  const profitScore=startBal
    ?Math.max(0,Math.min(100,50+(Number(p.pnl||0)/startBal)*100))
    :50;
  const ddScore=startBal
    ?Math.max(0,Math.min(100,100-(Number(p.maxDrawdown||0)/startBal)*100))
    :50;

  let score,parts=[winScore,profitScore,ddScore];
  if(r.riskConsistency!==null)parts.push(r.riskConsistency);
  score=Math.round(parts.reduce((s,x)=>s+x,0)/parts.length);

  $("#accHealthScore").textContent=score+'/100';
  $("#accHealthFill").style.width=score+'%';
  $("#accHealthBox small").textContent='Account health — an analytical estimate from real trading data, not financial advice.';
}

function renderAccTimeline(a,d){
  const rows=[['Created',formatDay(a.created_at)]];

  const firstTrade=d.equityCurve&&d.equityCurve.length?d.equityCurve[0].date:null;
  const lastTrade=d.trades&&d.trades.length?d.trades[0].trade_date:null;

  if(firstTrade)rows.push(['First trade',formatDay(firstTrade)]);
  if(lastTrade)rows.push(['Most recent trade',formatDay(lastTrade)]);
  if(a.updated_at&&a.updated_at!==a.created_at)rows.push(['Last updated',formatDay(a.updated_at)]);
  if(a.archived_at)rows.push(['Archived',formatDay(a.archived_at)]);

  $("#accTimeline").innerHTML=rows.map(x=>`<p><span>${E(x[0])}</span><b>${E(x[1])}</b></p>`).join('');
}

function drawAccountEquity(curve){
  const c=$("#acctEquityChart");
  if(!c)return;

  const {ctx,w,h}=prepCanvas(c,180);

  if(!curve.length){
    ctx.fillStyle='#98a2af';
    ctx.textAlign='center';
    ctx.font='11px system-ui';
    ctx.fillText('No closed trades yet',w/2,h/2);
    return;
  }

  const vals=curve.map(x=>Number(x.equity));
  const pad={l:58,r:14,t:14,b:22};

  let mi=Math.min(...vals),ma=Math.max(...vals),rg=(ma-mi)||1;

  const X=i=>pad.l+i*(w-pad.l-pad.r)/Math.max(1,vals.length-1);
  const Y=v=>pad.t+(ma-v)/rg*(h-pad.t-pad.b);

  ctx.strokeStyle='#edf0f4';
  ctx.fillStyle='#8994a3';
  ctx.font='10px system-ui';
  ctx.textAlign='right';

  for(let i=0;i<=3;i++){
    const y=pad.t+i*(h-pad.t-pad.b)/3;
    const val=ma-rg*i/3;
    ctx.beginPath();
    ctx.moveTo(pad.l,y);
    ctx.lineTo(w-pad.r,y);
    ctx.stroke();
    ctx.fillText(M(val),pad.l-7,y+3);
  }

  ctx.strokeStyle='#1769d2';
  ctx.lineWidth=2.2;
  ctx.beginPath();
  vals.forEach((v,i)=>i?ctx.lineTo(X(i),Y(v)):ctx.moveTo(X(i),Y(v)));
  ctx.stroke();

  ctx.fillStyle='#1769d2';
  ctx.beginPath();
  ctx.arc(X(vals.length-1),Y(vals.at(-1)),3.3,0,Math.PI*2);
  ctx.fill();
}

/* ---------------------------------------------------------------
   Account-level trade filtering (Trades tab)
   --------------------------------------------------------------- */

function clearDetailFilterInputs(){
  ['accFSymbol','accFStrategy','accFSession','accFFrom','accFTo'].forEach(id=>$('#'+id).value='');
  $("#accFDirection").value='';
  $("#accFResult").value='';
}

$("#accFApply").onclick=async()=>{
  detailFilters={};
  const sym=$("#accFSymbol").value.trim();
  const dir=$("#accFDirection").value;
  const res=$("#accFResult").value;
  const strat=$("#accFStrategy").value.trim();
  const sess=$("#accFSession").value.trim();
  const from=$("#accFFrom").value;
  const to=$("#accFTo").value;

  if(sym)detailFilters.symbol=sym;
  if(dir)detailFilters.direction=dir;
  if(res)detailFilters.result=res;
  if(strat)detailFilters.strategy=strat;
  if(sess)detailFilters.session=sess;
  if(from)detailFilters.from=from;
  if(to)detailFilters.to=to;

  try{
    await loadAccountDetail();
  }catch(e){
    showError(e.message);
  }
};

$("#accFReset").onclick=async()=>{
  detailFilters={};
  clearDetailFilterInputs();
  try{
    await loadAccountDetail();
  }catch(e){
    showError(e.message);
  }
};

/* ---------------------------------------------------------------
   Account Comparison (factual metrics only — no "best account"
   ranking or labels, per design spec).
   --------------------------------------------------------------- */

$("#compareAccountsBtn").onclick=()=>{
  if(accountsData.length<2){
    alert('Add at least two accounts to compare them.');
    return;
  }

  $("#comparePicker").innerHTML=accountsData.map((a,i)=>
    `<label><input type="checkbox" value="${a.id}" ${i<3?'checked':''}> ${E(a.name)}</label>`
  ).join('');

  $("#compareResults").innerHTML='';
  $("#compareModal").classList.remove('hide');
};

$("#compareModalClose").onclick=()=>$("#compareModal").classList.add('hide');
$("#compareModal").onclick=e=>{
  if(e.target===$("#compareModal"))$("#compareModal").classList.add('hide');
};

$("#compareRunBtn").onclick=async()=>{
  const ids=$$('#comparePicker input:checked').map(x=>Number(x.value));

  if(ids.length<2){
    alert('Select at least two accounts to compare.');
    return;
  }
  if(ids.length>4){
    alert('Compare up to 4 accounts at a time.');
    return;
  }

  try{
    const details=await Promise.all(ids.map(id=>api(`/api/accounts/${id}`)));
    renderCompareTable(details);
  }catch(e){
    showError(e.message);
  }
};

function renderCompareTable(details){
  const rows=[
    ['Net P&L',d=>M(d.performance.pnl)],
    ['Win rate',d=>d.performance.total?Number(d.performance.winRate).toFixed(1)+'%':'—'],
    ['Avg R',d=>Number(d.performance.avgR||0).toFixed(2)+'R'],
    ['Profit factor',d=>d.performance.profitFactorInfinite?'∞':Number(d.performance.profitFactor).toFixed(2)],
    ['Max drawdown',d=>M(d.performance.maxDrawdown)],
    ['Trade count',d=>d.performance.total]
  ];

  $("#compareResults").innerHTML=`
    <div class="tablewrap">
      <table class="acc-compare-table">
        <thead>
          <tr><th>Metric</th>${details.map(d=>`<th>${E(d.account.name)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${rows.map(([label,fn])=>`
            <tr><td>${E(label)}</td>${details.map(d=>`<td>${E(fn(d))}</td>`).join('')}</tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}
