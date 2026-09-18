async function executionLab(){
  const d=await api(
    '/api/execution?'+
    new URLSearchParams(
      state.account?
        {account:state.account}:
        {}
    )
  );

  const o=d.overall||{};

  $('#executionStats').innerHTML=[
    st('Trades',o.trades||0),
    st(
      'Avg MFE',
      Number(o.avg_mfe||0).toFixed(2)+'R',
      '',
      C(o.avg_mfe)
    ),
    st(
      'Avg MAE',
      Number(o.avg_mae||0).toFixed(2)+'R',
      '',
      C(o.avg_mae)
    ),
    st(
      'Avg realized R',
      Number(o.avg_r||0).toFixed(2)+'R',
      '',
      C(o.avg_r)
    ),
    st(
      'Exit efficiency',
      Number(o.exit_efficiency||0)*100?
        (Number(o.exit_efficiency||0)*100).toFixed(1)+'%':
        '—'
    ),
    st(
      'Rule score',
      Number(o.rule_score||0).toFixed(0)+'%'
    )
  ].join('');

  $('#executionTable').innerHTML=
    `<div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Trades</th>
            <th>MFE</th>
            <th>MAE</th>
            <th>Realized R</th>
            <th>Exit efficiency</th>
            <th>Rule score</th>
          </tr>
        </thead>

        <tbody>
          ${
            (d.bySymbol||[]).map(x=>
              `<tr>
                <td><b>${E(x.symbol)}</b></td>
                <td>${x.trades}</td>
                <td class="positive">
                  ${Number(x.avg_mfe||0).toFixed(2)}R
                </td>
                <td class="negative">
                  ${Number(x.avg_mae||0).toFixed(2)}R
                </td>
                <td class="${C(x.avg_r)}">
                  ${Number(x.avg_r||0).toFixed(2)}R
                </td>
                <td>
                  ${(Number(x.exit_efficiency||0)*100).toFixed(1)}%
                </td>
                <td>
                  ${Number(x.rule_score||0).toFixed(0)}%
                </td>
              </tr>`
            ).join('')||
            '<tr><td colspan="7">No MFE/MAE data yet. Edit trades and record MFE/MAE.</td></tr>'
          }
        </tbody>
      </table>
    </div>`;
}
