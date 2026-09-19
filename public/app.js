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

$("#openInsights").onclick=()=>
  page('insights');

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
