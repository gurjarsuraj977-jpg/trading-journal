async function missedLab(){
  const d=await api('/api/missed');

  const rows=d.missed||[];

  $('#missedList').innerHTML=
    rows.length?
    `
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Symbol</th>
              <th>Direction</th>
              <th>Setup</th>
              <th>Reason</th>
              <th>Potential R</th>
              <th>Potential P&L</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${
              rows.map(x=>
                `<tr>
                  <td>${E(formatDay(x.trade_date))}</td>
                  <td><b>${E(x.symbol)}</b></td>
                  <td>${E(x.direction||'')}</td>
                  <td>${E(x.setup||'')}</td>
                  <td>${E(x.reason||'')}</td>
                  <td>
                    ${Number(x.potential_r||0).toFixed(2)}R
                  </td>
                  <td class="${C(x.potential_pnl)}">
                    ${M(x.potential_pnl)}
                  </td>
                  <td>
                    <button
                      class="ghost danger"
                      onclick="deleteMissed(${x.id})"
                    >
                      Delete
                    </button>
                  </td>
                </tr>`
              ).join('')
            }
          </tbody>
        </table>
      </div>
    `:
    '<p class="muted">No missed trades recorded.</p>';
}

window.deleteMissed=async id=>{
  if(!confirm(
    'Delete this missed trade?'
  ))return;

  await api(
    '/api/missed/'+id,
    {method:'DELETE'}
  );

  await missedLab();
};

$('#newMissed').onclick=async()=>{
  const symbol=prompt(
    'Symbol',
    'XAUUSD'
  );

  if(!symbol)return;

  const direction=prompt(
    'Direction',
    'BUY'
  );

  const setup=prompt(
    'Setup',
    'Breakout'
  );

  const reason=prompt(
    'Why missed?',
    'Fear'
  );

  const pr=prompt(
    'Potential R',
    '2'
  );

  const pp=prompt(
    'Potential P&L',
    '0'
  );

  try{
    await api(
      '/api/missed',
      {
        method:'POST',
        body:JSON.stringify({
          symbol,
          direction,
          setup,
          reason,
          potentialR:pr,
          potentialPnl:pp,
          account:state.account
        })
      }
    );

    await missedLab();

  }catch(e){
    showError(e.message);
  }
};
