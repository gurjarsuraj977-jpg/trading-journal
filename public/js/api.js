async function api(url,opts={}){
  const headers={
    ...(opts.body?{"Content-Type":"application/json"}:{}),
    ...(opts.headers||{})
  };

  const r=await fetch(url,{
    credentials:"same-origin",
    ...opts,
    headers
  });

  let d={};
  try{
    d=await r.json();
  }catch{}

  if(r.status===401){
    if(!url.includes("/auth/"))location.reload();
    throw Error(d.error||"Session expired");
  }

  if(r.status===403){
    const err=Error(d.error||"Forbidden");
    err.status=403;
    err.code=d.status||null;
    throw err;
  }

  if(!r.ok)throw Error(d.error||"Request failed");

  return d;
}

function showError(m){
  console.error(m);
  alert(m);
}
