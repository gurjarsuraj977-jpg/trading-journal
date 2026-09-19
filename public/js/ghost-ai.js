function coachLab(){
  $('#coachQuestion').focus();
}

async function askGhost(q){
  if(!q?.trim())return;

  $('#coachChat').insertAdjacentHTML(
    'beforeend',
    `<div class="chat user">
      <b>You</b>
      <p>${E(q)}</p>
    </div>`
  );

  try{
    const d=await api(
      '/api/ai/coach',
      {
        method:'POST',
        body:JSON.stringify({
          question:q
        })
      }
    );

    $('#coachChat').insertAdjacentHTML(
      'beforeend',
      `<div class="chat ghost">
        <b>Ghost</b>
        <p>${E(d.answer).replace(/\n/g,'<br>')}</p>
        <small>
          Mode: ${E(d.mode||'local')}
        </small>
      </div>`
    );

    $('#coachChat').scrollTop=
      $('#coachChat').scrollHeight;

  }catch(e){
    showError(e.message);
  }
}

$('#askCoach').onclick=()=>{
  const q=$('#coachQuestion').value;

  $('#coachQuestion').value='';

  askGhost(q);
};

$('#coachQuestion').onkeydown=e=>{
  if(e.key==='Enter')
    $('#askCoach').click();
};

$$('.chip').forEach(b=>
  b.onclick=()=>
    askGhost(b.dataset.q)
);
