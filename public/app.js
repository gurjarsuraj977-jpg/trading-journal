let currentTrades = [];
let editingTrade = null;

const $ = id => document.getElementById(id);
const money = n => {
  const x = Number(n || 0);
  return (x < 0 ? "-$" : "$") + Math.abs(x).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
};
const dateFmt = d => new Date(d).toLocaleString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"});
const toast = msg => {
  $("toast").textContent = msg;
  $("toast").className = "toast";
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => $("toast").className = "", 2800);
};
async function api(url, options={}) {
  const r = await fetch(url,{headers:{"Content-Type":"application/json"},...options});
  const data = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error || "Request failed");
  return data;
}
function showAuth(mode="login"){
  $("authScreen").classList.remove("hidden"); $("app").classList.add("hidden");
  $("loginForm").classList.toggle("hidden",mode!=="login");
  $("registerForm").classList.toggle("hidden",mode!=="register");
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.auth===mode));
}
function showApp(user){
  $("authScreen").classList.add("hidden"); $("app").classList.remove("hidden");
  $("userName").textContent=user.name; $("userEmail").textContent=user.email; $("avatar").textContent=user.name[0].toUpperCase();
}
async function boot(){
  try { const {user}=await api("/api/auth/me"); showApp(user); await loadDashboard(); }
  catch { showAuth(); }
}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>showAuth(b.dataset.auth));
$("loginForm").onsubmit=async e=>{
  e.preventDefault();
  try { const {user}=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("loginEmail").value,password:$("loginPassword").value})}); showApp(user); await loadDashboard(); }
  catch(err){toast(err.message)}
};
$("registerForm").onsubmit=async e=>{
  e.preventDefault();
  try { const {user}=await api("/api/auth/register",{method:"POST",body:JSON.stringify({name:$("regName").value,email:$("regEmail").value,password:$("regPassword").value})}); showApp(user); await loadDashboard(); }
  catch(err){toast(err.message)}
};
$("logoutBtn").onclick=async()=>{await api("/api/auth/logout",{method:"POST"});showAuth()};

document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  const page=b.dataset.page;
  $("dashboardPage").classList.toggle("hidden",page!=="dashboard");
  $("tradesPage").classList.toggle("hidden",page!=="trades");
  $("pageTitle").textContent=page==="dashboard"?"Dashboard":"Trades";
  if(page==="trades") loadTrades();
});
$("viewAllBtn").onclick=()=>document.querySelector('[data-page="trades"]').click();
$("addTradeBtn").onclick=()=>openModal();
$("closeModal").onclick=closeModal;
$("cancelTrade").onclick=closeModal;
$("modal").onclick=e=>{if(e.target===$("modal"))closeModal()};

function openModal(trade=null){
  editingTrade=trade;
  $("modalTitle").textContent=trade?"Edit Trade":"Add Trade";
  $("tradeId").value=trade?.id||"";
  $("account").value=trade?.account||"Main Account";
  $("symbol").value=trade?.symbol||"";
  $("direction").value=trade?.direction||"BUY";
  $("tradeDate").value=trade ? new Date(trade.trade_date).toISOString().slice(0,16) : new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  $("entry").value=trade?.entry??"";
  $("stopLoss").value=trade?.stop_loss??"";
  $("takeProfit").value=trade?.take_profit??"";
  $("exitPrice").value=trade?.exit_price??"";
  $("quantity").value=trade?.quantity??1;
  $("riskAmount").value=trade?.risk_amount??0;
  $("profitLoss").value=trade?.profit_loss??0;
  $("strategy").value=trade?.strategy||"";
  $("session").value=trade?.session||"";
  $("notes").value=trade?.notes||"";
  $("modal").classList.remove("hidden");
}
function closeModal(){$("modal").classList.add("hidden");editingTrade=null}
$("tradeForm").onsubmit=async e=>{
  e.preventDefault();
  const body={
    account:$("account").value,symbol:$("symbol").value,direction:$("direction").value,
    tradeDate:$("tradeDate").value,entry:$("entry").value,stopLoss:$("stopLoss").value,
    takeProfit:$("takeProfit").value,exitPrice:$("exitPrice").value,quantity:$("quantity").value,
    riskAmount:$("riskAmount").value,profitLoss:$("profitLoss").value,strategy:$("strategy").value,
    session:$("session").value,notes:$("notes").value
  };
  try{
    if(editingTrade) await api("/api/trades/"+editingTrade.id,{method:"PUT",body:JSON.stringify(body)});
    else await api("/api/trades",{method:"POST",body:JSON.stringify(body)});
    closeModal();toast(editingTrade?"Trade updated":"Trade saved");await loadDashboard();if(!$("tradesPage").classList.contains("hidden"))await loadTrades();
  }catch(err){toast(err.message)}
};

async function loadDashboard(){
  try{
    const data=await api("/api/dashboard"),s=data.stats;
    $("statPnl").textContent=money(s.pnl);$("statPnl").className=s.pnl>=0?"pos":"neg";
    $("statWin").textContent=s.winRate.toFixed(1)+"%";$("statWinSub").textContent=`${s.wins} wins / ${s.total} trades`;
    $("statPf").textContent=Number.isFinite(s.profitFactor)?s.profitFactor.toFixed(2):"∞";
    $("statTrades").textContent=s.total;$("statWL").textContent=`${s.wins}W / ${s.losses}L`;
    $("avgWin").textContent=money(s.avgWin);$("avgLoss").textContent=money(s.avgLoss);
    $("totalRisk").textContent=money(s.totalRisk);$("wins").textContent=s.wins;$("losses").textContent=s.losses;
    renderRecent(data.recent);drawChart(data.curve);
  }catch(err){toast(err.message)}
}
function renderRecent(trades){
  $("recentBody").innerHTML=trades.map(t=>`<tr>
    <td>${dateFmt(t.trade_date)}</td><td><b>${t.symbol}</b></td>
    <td class="${t.direction==="BUY"?"side-buy":"side-sell"}">${t.direction}</td>
    <td>${t.entry}</td><td>${t.exit_price??"—"}</td>
    <td class="${Number(t.profit_loss)>=0?"pos":"neg"}">${money(t.profit_loss)}</td>
    <td>${t.strategy||"—"}</td></tr>`).join("");
  $("recentEmpty").classList.toggle("hidden",trades.length>0);
}
function drawChart(rows){
  const c=$("equityChart"),ctx=c.getContext("2d"),wrap=c.parentElement;
  c.width=wrap.clientWidth*devicePixelRatio;c.height=wrap.clientHeight*devicePixelRatio;
  ctx.scale(devicePixelRatio,devicePixelRatio);const w=wrap.clientWidth,h=wrap.clientHeight;
  ctx.clearRect(0,0,w,h);
  if(!rows.length){$("emptyChart").classList.remove("hidden");return}
  $("emptyChart").classList.add("hidden");
  let sum=0,vals=rows.map(r=>sum+=Number(r.profit_loss));
  const min=Math.min(0,...vals),max=Math.max(0,...vals),range=max-min||1;
  ctx.strokeStyle="#27303c";ctx.lineWidth=1;
  for(let i=0;i<5;i++){let y=18+i*(h-36)/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
  ctx.beginPath();
  vals.forEach((v,i)=>{const x=vals.length===1?w/2:(i/(vals.length-1))*w;const y=18+(max-v)/range*(h-36);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
  ctx.strokeStyle="#d8ff3e";ctx.lineWidth=2.5;ctx.stroke();
}
async function loadTrades(){
  try{
    const p=new URLSearchParams();
    if($("searchSymbol").value)p.set("symbol",$("searchSymbol").value);
    if($("filterDirection").value)p.set("direction",$("filterDirection").value);
    if($("filterResult").value)p.set("result",$("filterResult").value);
    const {trades}=await api("/api/trades?"+p.toString());currentTrades=trades;
    $("tradesBody").innerHTML=trades.map((t,i)=>`<tr>
      <td>${dateFmt(t.trade_date)}</td><td>${t.account}</td><td><b>${t.symbol}</b></td>
      <td class="${t.direction==="BUY"?"side-buy":"side-sell"}">${t.direction}</td><td>${t.entry}</td><td>${t.exit_price??"—"}</td>
      <td>${t.quantity}</td><td>${money(t.risk_amount)}</td><td class="${Number(t.profit_loss)>=0?"pos":"neg"}">${money(t.profit_loss)}</td>
      <td>${t.strategy||"—"}</td><td class="actions"><button onclick="editTrade(${i})">Edit</button><button onclick="deleteTrade(${t.id})">Delete</button></td></tr>`).join("");
    $("tradesEmpty").classList.toggle("hidden",trades.length>0);
  }catch(err){toast(err.message)}
}
window.editTrade=i=>openModal(currentTrades[i]);
window.deleteTrade=async id=>{
  if(!confirm("Delete this trade? This cannot be undone."))return;
  try{await api("/api/trades/"+id,{method:"DELETE"});toast("Trade deleted");await loadTrades();await loadDashboard()}catch(err){toast(err.message)}
};
$("filterBtn").onclick=loadTrades;
$("clearFilterBtn").onclick=()=>{$("searchSymbol").value="";$("filterDirection").value="";$("filterResult").value="";loadTrades()};
window.addEventListener("resize",()=>loadDashboard());
boot();
