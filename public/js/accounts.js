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
    (d.accounts||[]).map(a=>{
      const archived=a.active===false;

      return `<div class="account-card${archived?' archived':''}">
        <h3>${E(a.name)}${archived?' <small>(Archived)</small>':''}</h3>
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

        <button
          class="secondary"
          type="button"
          onclick="${archived?'reactivateAccount':'archiveAccount'}(${a.id})"
        >
          ${archived?'Reactivate':'Archive'}
        </button>
      </div>`;
    }).join('')||
    '<p>No accounts yet.</p>';
}

/*
 * Batch 1B: archive/reactivate an account. This never deletes the
 * account row or its trades — it only flips `active`, which excludes
 * the account from the "new trade" picker (see accountOptions() /
 * trades.js openModal) while leaving it fully visible in historical
 * filters, P&L, and existing trades.
 */
async function archiveAccount(id){
  if(!confirm(
    'Archive this account? It will no longer be selectable when adding new trades, but its balance, P&L and trade history stay exactly as they are. You can reactivate it anytime.'
  ))return;

  try{
    await api(`/api/accounts/${id}`,{
      method:'PUT',
      body:JSON.stringify({active:false})
    });

    await loadAccounts();
    await accounts();
    await dashboard();

  }catch(e){
    showError(e.message);
  }
}

async function reactivateAccount(id){
  try{
    await api(`/api/accounts/${id}`,{
      method:'PUT',
      body:JSON.stringify({active:true})
    });

    await loadAccounts();
    await accounts();
    await dashboard();

  }catch(e){
    showError(e.message);
  }
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
