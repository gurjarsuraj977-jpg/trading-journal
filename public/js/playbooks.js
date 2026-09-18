async function loadPlaybooks(){
  try{
    const d=await api('/api/playbooks');

    state.playbooks=d.playbooks||[];
    state.playbookRules=d.rules||[];

    if($('#playbook')){
      $('#playbook').innerHTML=
        '<option value="">No playbook</option>'+
        state.playbooks.map(p=>
          `<option value="${p.id}">
            ${E(p.name)}
          </option>`
        ).join('');
    }

  }catch(e){
    console.warn(e.message);
  }
}

function playbookRulesFor(id){
  return(state.playbookRules||[])
    .filter(r=>Number(r.playbook_id)===Number(id));
}

async function playbooks(){
  await loadPlaybooks();

  $('#playbookList').innerHTML=
    (state.playbooks||[]).map(p=>{
      const rules=playbookRulesFor(p.id);

      return`
        <div class="playbook-card" data-id="${p.id}">
          <div>
            <h3>${E(p.name)}</h3>
            <p>${E(p.description||'')}</p>
            <small>
              ${E(p.strategy||'No strategy')} ·
              Risk cap ${Number(p.risk_limit||0).toFixed(2)}%
            </small>
          </div>

          <div class="playbook-actions">
            <b>${rules.length} rules</b>

            <button
              class="ghost"
              onclick="viewPlaybook(${p.id})"
            >
              View
            </button>

            <button
              class="ghost danger"
              onclick="deletePlaybook(${p.id})"
            >
              Delete
            </button>
          </div>
        </div>
      `;
    }).join('')||
    '<p class="muted">No playbooks yet. Create one from your best setup.</p>';
}

window.viewPlaybook=id=>{
  const p=(state.playbooks||[])
    .find(x=>Number(x.id)===Number(id));

  if(!p)return;

  const rules=playbookRulesFor(id);

  $('#playbookDetail').innerHTML=
    `<h2>${E(p.name)}</h2>
     <p>${E(p.description||'')}</p>

     <div class="checklist">
       ${
         rules.map((r,i)=>
           `<div>
             <span>${i+1}</span>
             <b>${E(r.label)}</b>
             <small>
               ${r.required?'Required':'Optional'} ·
               weight ${r.weight}
             </small>
           </div>`
         ).join('')||
         '<p class="muted">No checklist rules.</p>'
       }
     </div>`;
};

window.deletePlaybook=async id=>{
  if(!confirm('Delete this playbook?'))
    return;

  await api(
    '/api/playbooks/'+id,
    {method:'DELETE'}
  );

  await loadPlaybooks();
  await playbooks();
};

$('#newPlaybook').onclick=async()=>{
  const name=prompt('Playbook name');

  if(!name?.trim())return;

  const strategy=prompt(
    'Strategy / setup name',
    'Breakout'
  );

  const desc=prompt(
    'Description',
    'Rules for my highest-quality setup'
  );

  const raw=prompt(
    'Checklist rules, separated by |',
    'HTF bias aligned|Liquidity sweep confirmed|Entry trigger confirmed|Risk <= 1%|News checked'
  );

  const rules=(raw||'')
    .split('|')
    .map(x=>({
      label:x.trim(),
      required:true,
      weight:1
    }))
    .filter(x=>x.label);

  try{
    await api('/api/playbooks',{
      method:'POST',
      body:JSON.stringify({
        name:name.trim(),
        strategy,
        description:desc,
        riskLimit:1,
        rules
      })
    });

    await loadPlaybooks();
    await playbooks();

  }catch(e){
    showError(e.message);
  }
};
