/*
 * Connect Account flow — a broker-selection layer placed in front of
 * GhostTrader's EXISTING TradeLocker and MT5 implementations.
 *
 * This file does not reimplement TradeLocker or MT5 authentication. The
 * TradeLocker panel below is the exact existing markup (same ids), just
 * moved from a permanently-visible section of the Accounts page into a
 * modal — every function that drives it (connectTradeLocker,
 * disconnectTradeLocker, loadTradeLockerAccounts, selectTradeLockerAccount,
 * loadTradeLockerState, etc.) already lives in app.js and is untouched.
 *
 * MT5 has a working backend (`GET /api/mt5/status`, `POST /api/mt5/disconnect`)
 * but — confirmed by inspecting mt5/mt5-routes.js — no connect/authenticate
 * endpoint and no prior frontend at all. Rather than invent a new MT5
 * authentication flow (explicitly out of scope), this file only wires up
 * the read-only pieces that already exist: status and disconnect.
 */

/* ---------------------------------------------------------------
   Broker-selection modal
   --------------------------------------------------------------- */

function openConnectAccountModal(){
  $("#connectAccountModal").classList.remove('hide');
}

function closeConnectAccountModal(){
  $("#connectAccountModal").classList.add('hide');
}

$("#connectAccountBtn").onclick=openConnectAccountModal;
$("#connectAccountClose").onclick=closeConnectAccountModal;
$("#connectAccountCancel").onclick=closeConnectAccountModal;
$("#connectAccountModal").onclick=e=>{
  if(e.target===$("#connectAccountModal"))closeConnectAccountModal();
};

$("#chooseMt5").onclick=()=>{
  closeConnectAccountModal();
  openMt5Modal();
};

$("#chooseTradeLocker").onclick=()=>{
  closeConnectAccountModal();
  openTradeLockerModal();
};

/* ---------------------------------------------------------------
   TradeLocker — existing implementation, reused as-is
   --------------------------------------------------------------- */

function openTradeLockerModal(){
  $("#tradeLockerConnectModal").classList.remove('hide');

  // Existing function (app.js) — reused untouched. It reads/writes the
  // same #tradelockerStatus / #tlEnvironment / #tlServer / etc. elements
  // that used to live inline on the Accounts page and now live in this
  // modal instead; nothing about how it works has changed.
  if(typeof loadTradeLockerConnection==='function'){
    loadTradeLockerConnection().catch(e=>
      console.warn('TradeLocker load:',e.message)
    );
  }
}

function closeTradeLockerModal(){
  $("#tradeLockerConnectModal").classList.add('hide');
}

$("#tradeLockerConnectClose").onclick=closeTradeLockerModal;
$("#tradeLockerConnectModal").onclick=e=>{
  if(e.target===$("#tradeLockerConnectModal"))closeTradeLockerModal();
};

// Back navigates to broker selection. It does not disconnect anything —
// it's the same connection state either way, just a different screen.
$("#tlBackBtn").onclick=()=>{
  closeTradeLockerModal();
  openConnectAccountModal();
};

/* ---------------------------------------------------------------
   MT5 — existing status/disconnect endpoints, reused as-is.
   No connect flow exists in the backend, so none is fabricated here.
   --------------------------------------------------------------- */

function openMt5Modal(){
  $("#mt5ConnectModal").classList.remove('hide');
  loadMt5Status().catch(e=>console.warn('MT5 status:',e.message));
}

function closeMt5Modal(){
  $("#mt5ConnectModal").classList.add('hide');
}

$("#mt5ConnectClose").onclick=closeMt5Modal;
$("#mt5ConnectModal").onclick=e=>{
  if(e.target===$("#mt5ConnectModal"))closeMt5Modal();
};

$("#mt5BackBtn").onclick=()=>{
  closeMt5Modal();
  openConnectAccountModal();
};

async function loadMt5Status(){
  const badge=$("#mt5StatusBadge");
  const message=$("#mt5Message");
  const connectedBox=$("#mt5ConnectedBox");
  const notAvailableBox=$("#mt5NotAvailableBox");
  const disconnectBtn=$("#disconnectMt5");

  try{
    const d=await api('/api/mt5/status');

    if(d.connected){
      badge.innerHTML='<span></span> Connected';
      badge.classList.add('connected');

      const c=d.connection||{};
      $("#mt5BrokerValue").textContent=c.broker||'—';
      $("#mt5ServerValue").textContent=c.server||'—';
      $("#mt5LoginValue").textContent=c.account_login||'—';
      $("#mt5AccountNameValue").textContent=c.account_name||'—';
      $("#mt5CurrencyValue").textContent=c.currency||'—';
      $("#mt5ConnStatusValue").textContent=c.status||'—';

      connectedBox.classList.remove('hide');
      notAvailableBox.classList.add('hide');
      disconnectBtn.classList.remove('hide');
      message.textContent='';
    }else{
      badge.innerHTML='<span></span> Not connected';
      badge.classList.remove('connected');

      connectedBox.classList.add('hide');
      notAvailableBox.classList.remove('hide');
      disconnectBtn.classList.add('hide');
      message.textContent='';
    }
  }catch(e){
    badge.innerHTML='<span></span> Not connected';
    badge.classList.remove('connected');
    message.textContent='Unable to check MT5 connection.';
  }
}

$("#disconnectMt5").onclick=async()=>{
  if(!confirm('Disconnect this MT5 account?'))return;

  try{
    const d=await api('/api/mt5/disconnect',{method:'POST'});
    $("#mt5Message").textContent=d.message||'MT5 disconnected.';
    await loadMt5Status();
    refreshConnectionBadges().catch(()=>{});
  }catch(e){
    showError(e.message);
  }
};

/* ---------------------------------------------------------------
   Compact connection-status pills (Accounts page header)
   --------------------------------------------------------------- */

async function refreshConnectionBadges(){
  const tlPill=$("#tlStatusPill");
  const mt5Pill=$("#mt5StatusPill");

  try{
    const d=await api('/api/tradelocker/status');
    tlPill.innerHTML=`<span></span> TradeLocker — ${d.connected?'Connected':'Not connected'}`;
    tlPill.classList.toggle('connected',!!d.connected);
  }catch(e){
    tlPill.innerHTML='<span></span> TradeLocker — Not connected';
    tlPill.classList.remove('connected');
  }

  try{
    const d=await api('/api/mt5/status');
    mt5Pill.innerHTML=`<span></span> MT5 — ${d.connected?'Connected':'Not connected'}`;
    mt5Pill.classList.toggle('connected',!!d.connected);
  }catch(e){
    mt5Pill.innerHTML='<span></span> MT5 — Not connected';
    mt5Pill.classList.remove('connected');
  }
}

$("#tlStatusPill").onclick=openTradeLockerModal;
$("#mt5StatusPill").onclick=openMt5Modal;
