function symbolsForSim(){
  const vals=[
    ...new Set(
      (state.trades||[])
        .map(x=>x.symbol)
        .filter(Boolean)
    )
  ];

  $('#simSymbol').innerHTML=
    '<option value="">All symbols</option>'+
    vals.map(x=>
      `<option>${E(x)}</option>`
    ).join('');
}

async function simulationLab(){
  await trades();

  symbolsForSim();

  $('#simResult').innerHTML=
    '<p class="muted">Run a scenario to see simulated results.</p>';
}

$('#runSim').onclick=async()=>{
  try{
    const body={
      account:state.account||'',
      symbol:$('#simSymbol').value,
      targetR:$('#simTarget').value,
      stopR:$('#simStop').value
    };

    const d=await api(
      '/api/simulate',
      {
        method:'POST',
        body:JSON.stringify(body)
      }
    );

    $('#simResult').innerHTML=
      `<div class="sim-grid">
        <div>
          <small>Usable trades</small>
          <b>${d.usable}</b>
        </div>

        <div>
          <small>Simulated R</small>
          <b class="${C(d.simulatedR)}">
            ${Number(d.simulatedR).toFixed(2)}R
          </b>
        </div>

        <div>
          <small>Win rate</small>
          <b>${Number(d.winRate).toFixed(1)}%</b>
        </div>

        <div>
          <small>Avg R</small>
          <b class="${C(d.avgR)}">
            ${Number(d.avgR).toFixed(2)}R
          </b>
        </div>
      </div>

      <p>
        ${
          d.usable?
          `Scenario used target +${Number(d.targetR).toFixed(2)}R and stop -${Math.abs(Number(d.stopR)).toFixed(2)}R.`:
          'Add MFE/MAE values to your trades before simulating.'
        }
      </p>`;

    await api(
      '/api/backtests',
      {
        method:'POST',
        body:JSON.stringify({
          name:$('#simName').value,
          symbol:$('#simSymbol').value,
          targetR:$('#simTarget').value,
          stopR:$('#simStop').value
        })
      }
    );

  }catch(e){
    showError(e.message);
  }
};
