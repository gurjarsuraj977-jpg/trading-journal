$("#newacc").onclick=async()=>{
  const n=prompt('Account name');

  if(!n?.trim())return;

  const b=prompt(
    'Starting balance',
    '10000'
  );

  if(b===null)return;

  try{
    await api('/api/accounts',{
      method:'POST',
      body:JSON.stringify({
        name:n.trim(),
        startingBalance:b,
        currency:'USD'
      })
    });

    await loadAccounts();
    await accounts();

  }catch(e){
    showError(e.message);
  }
};

async function accounts(){
  const d=await api('/api/accounts');

  $("#accountsList").innerHTML=
    (d.accounts||[]).map(a=>
      `<div class="account-card">
        <h3>${E(a.name)}</h3>
        <small>
          Starting balance · ${M(a.starting_balance)}
        </small>
        <strong class="${C(a.pnl)}">
          ${M(a.pnl)}
        </strong>
        <small>Net P&L</small>

        <button
          class="secondary"
          type="button"
          onclick="editAccountBalance(${a.id},${Number(a.starting_balance||0)})"
        >
          Edit Balance
        </button>
      </div>`
    ).join('')||
    '<p>No accounts yet.</p>';
}
async function editAccountBalance(id,currentBalance){
  const value=prompt(
    'Enter new starting balance:',
    Number(currentBalance||0).toFixed(2)
  );

  if(value===null)return;

  const startingBalance=Number(value);

  if(!Number.isFinite(startingBalance)||startingBalance<0){
    alert('Please enter a valid non-negative balance.');
    return;
  }

  try{
    await api(`/api/accounts/${id}`,{
      method:'PUT',
      body:JSON.stringify({
        startingBalance
      })
    });

    await loadAccounts();
    await accounts();
    await dashboard();
  }catch(e){
    showError(e.message);
  }
}
