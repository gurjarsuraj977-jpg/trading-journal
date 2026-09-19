const state={
  user:null,
  accounts:[],
  trades:[],
  month:new Date(new Date().getFullYear(),new Date().getMonth(),1),
  edit:null,
  range:"year",
  account:"",
  lastAnalytics:null
};

/*
 * Batch 1B: `activeOnly` defaults to false so every existing caller
 * (dashboard filter, journal filter, and the unqualified pre-fill
 * below) keeps showing every account, archived included — that
 * contract is preserved. Only the "create/edit a trade" account
 * picker opts into activeOnly, and only when adding a NEW trade
 * (see trades.js openModal), so an archived account can never be
 * silently dropped out from under an existing trade that's being
 * edited.
 */
function accountOptions(selected='',activeOnly=false){
  const list=activeOnly?state.accounts.filter(a=>a.active!==false):state.accounts;

  return list.map(a=>
    `<option value="${E(a.name)}" ${a.name===selected?'selected':''}>${E(a.name)}${a.active===false?' (archived)':''}</option>`
  ).join('');
}

async function loadAccounts(){
  const d=await api('/api/accounts');

  state.accounts=d.accounts||[];

  $("#ta").innerHTML=
    accountOptions($("#ta").value)||
    '<option value="">No account</option>';

  $("#dashAccount").innerHTML=
    '<option value="">All accounts</option>'+
    accountOptions(state.account);

  $("#tradeAccount").innerHTML=
    '<option value="">All accounts</option>'+
    accountOptions($("#tradeAccount").value);
}
