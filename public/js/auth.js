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

async function boot(){
  $("#auth").classList.add('hide');
  $("#app").classList.remove('hide');

  $("#sideName").textContent=
    state.user?.name||'Trader';

  $("#sideEmail").textContent=
    state.user?.email||'GhostTrader';

  $("#avatar").textContent=
    (state.user?.name||'G').charAt(0).toUpperCase();

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
