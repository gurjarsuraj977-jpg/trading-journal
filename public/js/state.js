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

function accountOptions(selected=''){
  return state.accounts.map(a=>
    `<option value="${E(a.name)}" ${a.name===selected?'selected':''}>${E(a.name)}</option>`
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
