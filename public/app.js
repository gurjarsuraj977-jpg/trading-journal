const $=x=>document.querySelector(x), $$=x=>[...document.querySelectorAll(x)];
const M=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number(n||0));
const C=n=>Number(n||0)>=0?"positive":"negative";
const E=x=>String(x??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const state={user:null,accounts:[],trades:[],month:new Date(new Date().getFullYear(),new Date().getMonth(),1),edit:null};

async function api(url,opts={}){
  const headers={...(opts.body?{"Content-Type":"application/json"}:{}),...(opts.headers||{})};
  const r=await fetch(url,{credentials:"same-origin",...opts,headers});
  let d={}; try{d=await r.json()}catch{}
  if(r.status===401){if(!url.includes("/auth/")){location.reload();}throw Error(d.error||"Session expired");}
  if(!r.ok)throw Error(d.error||"Request failed");
  return d;
}
function page(p){
  $$(".page").forEach(x=>x.classList.add("hide"));
  const el=$("#"+p); if(!el)return;
  el.classList.remove("hide");
  $("#title").textContent=p[0].toUpperCase()+p.slice(1);
  try{
    if(p==="dashboard")dashboard();
    if(p==="trades")trades();
    if(p==="calendar")calendar();
    if(p==="analytics")analytics();
    if(p==="accounts")accounts();
  }catch(e){showError(e.message)}
}
function showError(msg){console.error(msg);alert(msg)}
$$("nav button").forEach(b=>b.onclick=()=>page(b.dataset.p));
$("#export").onclick=()=>{location.href="/api/export.csv"};
$("#logout").onclick=async()=>{try{await api("/api/auth/logout",{method:"POST"})}finally{location.reload()}};

let register=false;
$("#switch").onclick=()=>{
  register=!register;
  $("#auth .auth").classList.toggle("register",register);
  $("#af button").textContent=register?"Create account":"Login";
  $("#switch").textContent=register?"Back to login":"Create account";
  $("#an").required=register;
  if(!register)$("#an").value="";
};
$("#af").onsubmit=async e=>{
  e.preventDefault();
  const btn=$("#af button");btn.disabled=true;
  try{
    const d=await api("/api/auth/"+(register?"register":"login"),{method:"POST",body:JSON.stringify({
      name:$("#an").value,email:$("#ae").value,password:$("#ap").value
    })});
    state.user=d.user;$("#ap").value="";await boot();
  }catch(e){showError(e.message)}finally{btn.disabled=false}
};

async function boot(){
  $("#auth").classList.add("hide");$("#app").classList.remove("hide");
  await loadAccounts();await dashboard();
}
function accountOptions(selected=""){
  return state.accounts.map(a=>`<option value="${E(a.name)}" ${a.name===selected?"selected":""}>${E(a.name)}</option>`).join("");
}
async function loadAccounts(){
  const d=await api("/api/accounts");state.accounts=d.accounts||[];
  $("#ta").innerHTML=accountOptions($("#ta").value)||'<option value="">No account</option>';
}
function st(a,b,c=""){return `<div class="card stat"><small>${E(a)}</small><b class="${c}">${E(b)}</b></div>`}

async function dashboard(){
  const d=await api("/api/analytics?tz="+encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC")),s=d.summary||{};
  $("#stats").innerHTML=[
    st("Net P&L",M(s.pnl),C(s.pnl)),st("Win Rate",Number(s.winRate||0).toFixed(1)+"%"),
    st("Profit Factor",Number.isFinite(Number(s.profitFactor))?Number(s.profitFactor).toFixed(2):"∞"),
    st("Expectancy",M(s.expectancy),C(s.expectancy)),st("Max Drawdown",M(s.maxDrawdown),"negative")
  ].join("");
  $("#perf").innerHTML=[
    ["Trades",s.total||0],["Wins",s.wins||0],["Losses",s.losses||0],["Avg Win",M(s.avgWin)],
    ["Avg Loss",M(s.avgLoss)],["Avg R",Number(s.avgR||0).toFixed(2)+"R"],["Avg Risk",Number(s.avgRisk||0).toFixed(2)+"%"],
    ["Best Streak",s.bestWinStreak||0],["Worst Streak",s.bestLossStreak||0]
  ].map(x=>`<p><span>${E(x[0])}</span><b>${E(x[1])}</b></p>`).join("");
  draw(d.byDay||[]);
  const t=await api("/api/trades");state.trades=t.trades||[];
  $("#recent").innerHTML=table(state.trades.slice(0,8),false);
}

function draw(days){
  const c=$("#chart");if(!c)return;
  const box=c.parentElement;
  const w=Math.max(300,box.clientWidth-36),h=280,dpr=window.devicePixelRatio||1;
  c.style.width="100%";c.style.height=h+"px";c.width=Math.round(w*dpr);c.height=Math.round(h*dpr);
  const ctx=c.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const rows=(days||[]).filter(x=>x&&x.day).slice().sort((a,b)=>String(a.day).localeCompare(String(b.day)));
  const pad={l:62,r:18,t:28,b:38};
  ctx.font="11px system-ui";ctx.lineWidth=1;ctx.textAlign="left";ctx.textBaseline="middle";
  if(!rows.length){
    ctx.fillStyle="#89939b";ctx.textAlign="center";ctx.fillText("No closed trades yet",w/2,h/2);return;
  }
  let eq=0;const vals=rows.map(x=>eq+=Number(x.pnl||0));
  let mi=Math.min(0,...vals),ma=Math.max(0,...vals),rg=ma-mi||1;
  const xAt=i=>pad.l+i*(w-pad.l-pad.r)/Math.max(1,vals.length-1);
  const yAt=v=>pad.t+(ma-v)/rg*(h-pad.t-pad.b);
  // grid + labels
  ctx.strokeStyle="#222a30";ctx.fillStyle="#89939b";
  for(let i=0;i<=4;i++){
    const y=pad.t+i*(h-pad.t-pad.b)/4,val=ma-rg*i/4;
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
    ctx.textAlign="right";ctx.fillText(M(val),pad.l-8,y);
  }
  ctx.beginPath();ctx.moveTo(pad.l,yAt(0));ctx.lineTo(w-pad.r,yAt(0));ctx.stroke();
  // curve
  ctx.strokeStyle="#d8ff3e";ctx.lineWidth=2.5;ctx.beginPath();
  vals.forEach((v,i)=>{i?ctx.lineTo(xAt(i),yAt(v)):ctx.moveTo(xAt(i),yAt(v))});ctx.stroke();
  ctx.fillStyle="#d8ff3e";vals.forEach((v,i)=>{ctx.beginPath();ctx.arc(xAt(i),yAt(v),3,0,Math.PI*2);ctx.fill()});
  ctx.fillStyle="#89939b";ctx.textBaseline="alphabetic";
  ctx.textAlign="left";ctx.fillText(formatDay(rows[0].day),pad.l,h-10);
  ctx.textAlign="right";ctx.fillText(formatDay(rows[rows.length-1].day),w-pad.r,h-10);
  ctx.fillStyle="#edf1f2";ctx.textAlign="left";ctx.font="bold 12px system-ui";ctx.fillText("Equity P&L: "+M(vals[vals.length-1]),pad.l,13);
}
function formatDay(v){const d=new Date(String(v).length===10?v+"T12:00:00":v);return Number.isNaN(d.getTime())?"":d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}
let resizeTimer;
window.addEventListener("resize",()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!$("#dashboard").classList.contains("hide"))dashboard().catch(()=>{})},150)});

function table(t,full=true){
  if(!t.length)return"<p>No trades yet.</p>";
  return `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Symbol</th><th>Side</th><th>Account</th><th>P&L</th><th>R</th>${full?"<th>Strategy</th><th>Actions</th>":""}</tr></thead><tbody>${t.map(x=>`<tr>
<td>${E(formatDay(x.trade_date))}</td><td><b>${E(x.symbol)}</b></td><td>${E(x.direction)}</td><td>${E(x.account)}</td>
<td class="${C(x.profit_loss)}">${M(x.profit_loss)}</td><td>${Number(x.actual_r||0).toFixed(2)}R</td>
${full?`<td>${E(x.strategy||"—")}</td><td><button type="button" onclick="editTrade(${Number(x.id)})">Edit</button> <button type="button" onclick="delTrade(${Number(x.id)})">Delete</button></td>`:""}
</tr>`).join("")}</tbody></table></div>`;
}
async function trades(){
  const q=new URLSearchParams();
  if($("#fs").value.trim())q.set("symbol",$("#fs").value.trim());
  if($("#fd").value)q.set("direction",$("#fd").value);
  if($("#fr").value)q.set("result",$("#fr").value);
  if($("#tradeAccount")?.value)q.set("account",$("#tradeAccount").value);
  const d=await api("/api/trades?"+q);state.trades=d.trades||[];$("#tradeTable").innerHTML=table(state.trades);
}
["fs","fd","fr"].forEach(x=>$("#"+x).addEventListener("input",()=>trades().catch(e=>showError(e.message))));
$("#cf").onclick=()=>{["fs","fd","fr"].forEach(x=>$("#"+x).value="");trades().catch(e=>showError(e.message))};

function localNow(){
  const d=new Date();d.setSeconds(0,0);
  const off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16);
}
function openModal(t){
  state.edit=t||null;$("#mh").textContent=t?"Edit Trade":"Add Trade";$("#tf").reset();
  $("#ta").innerHTML=accountOptions(t?.account||state.accounts[0]?.name||"");
  $("#tt").value=localNow();
  if(t){
    const map={tid:"id",ts:"symbol",td:"direction",te:"entry",sl:"stop_loss",tp:"take_profit",ex:"exit_price",qty:"quantity",risk:"risk_amount",riskp:"risk_percent",pl:"profit_loss",prr:"planned_rr",ar:"actual_r",strategy:"strategy",setup:"setup",session:"session",mc:"market_condition",conf:"confidence",eb:"emotion_before",ea:"emotion_after",mist:"mistakes",er:"entry_reason",xr:"exit_reason",notes:"notes"};
    $("#ta").value=t.account||"";
    Object.entries(map).forEach(([a,b])=>{if($("#"+a))$("#"+a).value=t[b]??""});
    const dt=new Date(t.trade_date);if(!Number.isNaN(dt.getTime())){const off=dt.getTimezoneOffset();$("#tt").value=new Date(dt.getTime()-off*60000).toISOString().slice(0,16)}
  }
  $("#shot").value="";$("#modal").classList.remove("hide");
}
$("#add").onclick=()=>openModal();
$("#close").onclick=()=>$("#modal").classList.add("hide");
$("#modal").addEventListener("click",e=>{if(e.target===$("#modal"))$("#modal").classList.add("hide")});
document.addEventListener("keydown",e=>{if(e.key==="Escape")$("#modal").classList.add("hide")});
function fileData(f){return new Promise((r,j)=>{const x=new FileReader();x.onload=()=>r(x.result);x.onerror=j;x.readAsDataURL(f)})}

$("#save").onclick=async()=>{
  const btn=$("#save");btn.disabled=true;
  try{
    if(!$("#ta").value)throw Error("Create an account before adding a trade.");
    if(!$("#ts").value.trim())throw Error("Symbol is required.");
    if(!$("#te").value)throw Error("Entry price is required.");
    const f=$("#shot").files[0];let img=state.edit?.screenshot_data||"";
    if(f){if(!f.type.startsWith("image/"))throw Error("Please select an image.");if(f.size>3e6)throw Error("Screenshot must be under 3MB");img=await fileData(f)}
    const b={account:$("#ta").value,symbol:$("#ts").value,direction:$("#td").value,tradeDate:$("#tt").value,entry:$("#te").value,stopLoss:$("#sl").value,takeProfit:$("#tp").value,exitPrice:$("#ex").value,quantity:$("#qty").value,riskAmount:$("#risk").value,riskPercent:$("#riskp").value,profitLoss:$("#pl").value,plannedRr:$("#prr").value,actualR:$("#ar").value,strategy:$("#strategy").value,setup:$("#setup").value,session:$("#session").value,marketCondition:$("#mc").value,confidence:$("#conf").value,emotionBefore:$("#eb").value,emotionAfter:$("#ea").value,mistakes:$("#mist").value,entryReason:$("#er").value,exitReason:$("#xr").value,notes:$("#notes").value,screenshotData:img};
    await api(state.edit?"/api/trades/"+state.edit.id:"/api/trades",{method:state.edit?"PUT":"POST",body:JSON.stringify(b)});
    $("#modal").classList.add("hide");state.edit=null;await loadAccounts();await trades();await dashboard();
  }catch(e){showError(e.message)}finally{btn.disabled=false}
};
window.editTrade=async id=>{try{let t=state.trades.find(x=>Number(x.id)===Number(id));if(!t)t=(await api("/api/trades")).trades.find(x=>Number(x.id)===Number(id));if(!t)throw Error("Trade not found.");openModal(t)}catch(e){showError(e.message)}};
window.delTrade=async id=>{if(!confirm("Delete this trade permanently?"))return;try{await api("/api/trades/"+id,{method:"DELETE"});await loadAccounts();await trades();await dashboard()}catch(e){showError(e.message)}};

function calKey(y,m,d){return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`}
async function calendar(){
  const y=state.month.getFullYear(),mo=state.month.getMonth()+1,m=String(mo).padStart(2,"0");
  const tz=Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC";
  const d=await api(`/api/calendar?month=${y}-${m}&tz=${encodeURIComponent(tz)}`);
  const map=Object.fromEntries((d.days||[]).map(x=>[String(x.day).slice(0,10),x]));
  const first=new Date(y,mo-1,1),days=new Date(y,mo,0).getDate(),off=(first.getDay()+6)%7;
  $("#mt").textContent=state.month.toLocaleString(undefined,{month:"long",year:"numeric"});
  let h="";for(let i=0;i<off;i++)h+='<div class="day empty"></div>';
  for(let i=1;i<=days;i++){
    const x=map[calKey(y,mo,i)],p=x?Number(x.pnl):0;
    h+=`<div class="day ${p>0?"win":p<0?"loss":""}" ${x?`title="${E(M(p)+" · "+x.trades+" trade"+(Number(x.trades)===1?"":"s"))}" data-day="${calKey(y,mo,i)}"`:""}>
      <b>${i}</b>${x?`<p class="${C(p)}">${M(p)}<br>${x.trades} trade${Number(x.trades)===1?"":"s"}</p>`:""}
    </div>`;
  }
  $("#gridcal").innerHTML=h;
  $$("#gridcal .day[data-day]").forEach(el=>el.onclick=()=>{
    $("#fs").value="";$("#fd").value="";$("#fr").value="";
    page("trades");
    const q=new URLSearchParams({date:el.dataset.day}); // date filtering is supported by the upgraded server
    api("/api/trades?"+q).then(d=>{state.trades=d.trades||[];$("#tradeTable").innerHTML=table(state.trades)}).catch(e=>showError(e.message));
  });
}
$("#prev").onclick=()=>{state.month=new Date(state.month.getFullYear(),state.month.getMonth()-1,1);calendar().catch(e=>showError(e.message))};
$("#next").onclick=()=>{state.month=new Date(state.month.getFullYear(),state.month.getMonth()+1,1);calendar().catch(e=>showError(e.message))};

function bars(a,key){
  if(!a?.length)return"<p>No data yet.</p>";
  const mx=Math.max(...a.map(x=>Math.abs(Number(x.pnl||0))),1);
  return a.map(x=>`<div class="barrow"><b>${E(x[key]||"Unspecified")}</b><div class="bar"><i style="width:${Math.min(100,Math.abs(Number(x.pnl||0))/mx*100)}%"></i></div><span class="${C(x.pnl)}">${M(x.pnl)}</span></div>`).join("");
}
async function analytics(){
  const d=await api("/api/analytics?tz="+encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC")),s=d.summary||{};
  $("#astats").innerHTML=[st("Trades",s.total||0),st("P&L",M(s.pnl),C(s.pnl)),st("Win Rate",Number(s.winRate||0).toFixed(1)+"%"),st("Avg R",Number(s.avgR||0).toFixed(2)+"R"),st("Expectancy",M(s.expectancy),C(s.expectancy)),st("Drawdown",M(s.maxDrawdown),"negative")].join("");
  $("#sym").innerHTML=bars(d.bySymbol,"symbol");$("#strat").innerHTML=bars(d.byStrategy,"strategy");$("#sess").innerHTML=bars(d.bySession,"session");$("#dir").innerHTML=bars(d.byDirection,"direction");
}
$("#newacc").onclick=async()=>{
  const n=prompt("Account name");if(!n?.trim())return;
  const b=prompt("Starting balance","10000");if(b===null)return;
  try{await api("/api/accounts",{method:"POST",body:JSON.stringify({name:n.trim(),startingBalance:b,currency:"USD"})});await loadAccounts();await accounts()}catch(e){showError(e.message)}
};
async function accounts(){
  const d=await api("/api/accounts");
  $("#accountsList").innerHTML=(d.accounts||[]).map(a=>`<div class="row"><div><b>${E(a.name)}</b><small>Start ${M(a.starting_balance)} · P&L <span class="${C(a.pnl)}">${M(a.pnl)}</span></small></div></div>`).join("")||"<p>No accounts.</p>";
}
(async()=>{try{const d=await api("/api/auth/me");state.user=d.user;await boot()}catch(e){/* logged out */}})();
