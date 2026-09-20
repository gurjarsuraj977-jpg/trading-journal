const holdLogout=$("#holdLogout");
if(holdLogout){
  holdLogout.onclick=async()=>{
    try{
      await api('/api/auth/logout',{method:'POST'});
    }finally{
      location.reload();
    }
  };
}

$("#logout").onclick=async()=>{
  try{
    await api('/api/auth/logout',{
      method:'POST'
    });
  }finally{
    location.reload();
  }
};

let register=false;

$("#switch").onclick=()=>{
  register=!register;

  $("#auth .auth-card").classList.toggle(
    'register',
    register
  );

  $("#af button").textContent=
    register?'Create account':'Login';

  $("#switch").textContent=
    register?'Back to login':'Create account';

  $("#an").required=register;

  if(!register)
    $("#an").value='';
};

$("#af").onsubmit=async e=>{
  e.preventDefault();

  const b=$("#af button");
  b.disabled=true;

  try{
    const d=await api(
      '/api/auth/'+(register?'register':'login'),
      {
        method:'POST',
        body:JSON.stringify({
          name:$("#an").value,
          email:$("#ae").value,
          password:$("#ap").value
        })
      }
    );

    state.user=d.user;
    $("#ap").value='';

    await boot();

  }catch(e){
    showError(e.message);
  }finally{
    b.disabled=false;
  }
};

function showPendingScreen(){
  $("#auth").classList.add('hide');
  $("#app").classList.add('hide');
  const hold=$("#accountHold");
  if(hold){
    hold.classList.remove('hide');
    const title=$("#holdTitle");
    const body=$("#holdBody");
    if(title)title.textContent='Account pending approval';
    if(body)body.textContent=
      'Your GhostTrader account is pending approval. An administrator needs to approve your account before you can access the journal.';
  }
}

function showBannedScreen(){
  $("#auth").classList.add('hide');
  $("#app").classList.add('hide');
  const hold=$("#accountHold");
  if(hold){
    hold.classList.remove('hide');
    const title=$("#holdTitle");
    const body=$("#holdBody");
    if(title)title.textContent='Account unavailable';
    if(body)body.textContent=
      'Your account is currently unavailable. Please contact support.';
  }
}

function updateAdminNav(){
  const link=$("#adminNavLink");
  if(!link)return;
  const isAdmin=
    state.user?.role==='admin'&&
    state.user?.status==='active';
  link.classList.toggle('hide',!isAdmin);
}

async function boot(){
  const status=state.user?.status;

  if(status==='banned'){
    showBannedScreen();
    return;
  }

  if(status==='pending'){
    showPendingScreen();
    return;
  }

  const hold=$("#accountHold");
  if(hold)hold.classList.add('hide');

  $("#auth").classList.add('hide');
  $("#app").classList.remove('hide');

  $("#sideName").textContent=
    state.user?.name||'Trader';

  $("#sideEmail").textContent=
    state.user?.email||'GhostTrader';

  $("#avatar").textContent=
    (state.user?.name||'G').charAt(0).toUpperCase();

  updateAdminNav();

await loadAccounts();
await loadPlaybooks();

await loadTradeLockerConnection()
  .catch(e=>console.warn(
    'TradeLocker connection:',
    e.message
  ));

await dashboard();
}

/* =========================================================
   APP BOOT
   ========================================================= */

(async()=>{

  try{

    const d=
      await api('/api/auth/me');

    state.user=d.user;

    await boot();

  }catch(e){}

})();
