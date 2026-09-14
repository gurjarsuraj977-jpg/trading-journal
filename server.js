require("dotenv").config();
const express=require("express"),path=require("path"),cookieParser=require("cookie-parser"),bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),{Pool}=require("pg");
const app=express(),PORT=process.env.PORT||10000,SECRET=process.env.JWT_SECRET||"dev-only-change-me";
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL&&!process.env.DATABASE_URL.includes("localhost")?{rejectUnauthorized:false}:false});
app.use(express.json({limit:"5mb"}));app.use(cookieParser());app.use(express.static(path.join(__dirname,"public")));
const db=(q,p=[])=>pool.query(q,p);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
function auth(req,res,next){const t=req.cookies.gt_token;if(!t)return res.status(401).json({error:"Not authenticated"});try{req.user=jwt.verify(t,SECRET);next()}catch{return res.status(401).json({error:"Session expired"})}}
async function init(){
 await db(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,name VARCHAR(80) NOT NULL,email VARCHAR(255) UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS accounts(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,name VARCHAR(100) NOT NULL,starting_balance NUMERIC(20,2) DEFAULT 0,currency VARCHAR(10) DEFAULT 'USD',created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(user_id,name));
 CREATE TABLE IF NOT EXISTS trades(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,account VARCHAR(100) DEFAULT 'Main Account',symbol VARCHAR(30) NOT NULL,direction VARCHAR(10) NOT NULL CHECK(direction IN('BUY','SELL')),entry NUMERIC(20,8) NOT NULL,stop_loss NUMERIC(20,8),take_profit NUMERIC(20,8),exit_price NUMERIC(20,8),quantity NUMERIC(20,8) DEFAULT 1,risk_amount NUMERIC(20,2) DEFAULT 0,profit_loss NUMERIC(20,2) DEFAULT 0,strategy VARCHAR(100),session VARCHAR(40),notes TEXT,trade_date TIMESTAMPTZ DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW());`);
 const cols=[["risk_percent","NUMERIC(10,4) DEFAULT 0"],["planned_rr","NUMERIC(10,4) DEFAULT 0"],["actual_r","NUMERIC(10,4) DEFAULT 0"],["setup","VARCHAR(120)"],["entry_reason","TEXT"],["exit_reason","TEXT"],["emotion_before","VARCHAR(50)"],["emotion_after","VARCHAR(50)"],["mistakes","TEXT"],["confidence","INTEGER DEFAULT 0"],["market_condition","VARCHAR(80)"],["screenshot_data","TEXT"]];
 for(const [a,b] of cols)await db(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS ${a} ${b}`);
 await db(`INSERT INTO accounts(user_id,name) SELECT id,'Main Account' FROM users u WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.user_id=u.id AND a.name='Main Account')`);
}
function token(u){return jwt.sign({id:u.id,name:u.name,email:u.email},SECRET,{expiresIn:"7d"})}
const setCookie=(res,t)=>res.cookie("gt_token",t,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:604800000});
app.post("/api/auth/register",async(req,res)=>{try{let name=String(req.body.name||"").trim(),email=String(req.body.email||"").trim().toLowerCase(),pw=String(req.body.password||"");if(name.length<2||!email.includes("@")||pw.length<6)return res.status(400).json({error:"Name, valid email and 6+ character password required."});if((await db("SELECT id FROM users WHERE email=$1",[email])).rowCount)return res.status(409).json({error:"Email already registered."});let r=await db("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",[name,email,await bcrypt.hash(pw,12)]);await db("INSERT INTO accounts(user_id,name) VALUES($1,'Main Account')",[r.rows[0].id]);setCookie(res,token(r.rows[0]));res.json({user:r.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Registration failed."})}});
app.post("/api/auth/login",async(req,res)=>{try{let email=String(req.body.email||"").trim().toLowerCase(),pw=String(req.body.password||""),r=await db("SELECT * FROM users WHERE email=$1",[email]);if(!r.rowCount||!(await bcrypt.compare(pw,r.rows[0].password_hash)))return res.status(401).json({error:"Invalid email or password."});let u={id:r.rows[0].id,name:r.rows[0].name,email:r.rows[0].email};setCookie(res,token(u));res.json({user:u})}catch(e){res.status(500).json({error:"Login failed."})}});
app.post("/api/auth/logout",(req,res)=>{res.clearCookie("gt_token");res.json({ok:true})});app.get("/api/auth/me",auth,(req,res)=>res.json({user:req.user}));
app.get("/api/accounts",auth,async(req,res)=>{let r=await db(`SELECT a.*,COALESCE(SUM(t.profit_loss),0) pnl FROM accounts a LEFT JOIN trades t ON t.user_id=a.user_id AND t.account=a.name WHERE a.user_id=$1 GROUP BY a.id ORDER BY a.created_at`,[req.user.id]);res.json({accounts:r.rows})});
app.post("/api/accounts",auth,async(req,res)=>{try{let name=String(req.body.name||"").trim(),currency=String(req.body.currency||"USD").trim().toUpperCase();if(name.length<2||name.length>100)return res.status(400).json({error:"Account name must be 2-100 characters."});if(!/^[A-Z]{3,10}$/.test(currency))return res.status(400).json({error:"Currency must be 3-10 letters."});let r=await db("INSERT INTO accounts(user_id,name,starting_balance,currency) VALUES($1,$2,$3,$4) RETURNING *",[req.user.id,name,n(req.body.startingBalance),currency]);res.status(201).json({account:r.rows[0]})}catch(e){console.error(e);res.status(400).json({error:e.code==="23505"?"That account already exists.":"Could not create account."})}});
const fields="id,account,symbol,direction,entry,stop_loss,take_profit,exit_price,quantity,risk_amount,risk_percent,profit_loss,planned_rr,actual_r,strategy,session,setup,entry_reason,exit_reason,emotion_before,emotion_after,mistakes,confidence,market_condition,screenshot_data,notes,trade_date";
app.get("/api/trades",auth,async(req,res)=>{try{
  let v=[req.user.id],w=["user_id=$1"];
  if(req.query.symbol){v.push("%"+String(req.query.symbol).trim()+"%");w.push(`symbol ILIKE $${v.length}`)}
  if(["BUY","SELL"].includes(req.query.direction)){v.push(req.query.direction);w.push(`direction=$${v.length}`)}
  if(req.query.result==="win")w.push("profit_loss>0");
  if(req.query.result==="loss")w.push("profit_loss<0");
  if(req.query.account){v.push(String(req.query.account));w.push(`account=$${v.length}`)}
  if(req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)){v.push(req.query.from);w.push(`trade_date >= $${v.length}::date::timestamp`)}
  if(req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)){v.push(req.query.to);w.push(`trade_date < ($${v.length}::date + INTERVAL '1 day')`)}
  if(req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)){
    const tz=String(req.query.tz||"UTC");v.push(tz,req.query.date);
    w.push(`(trade_date AT TIME ZONE $${v.length-1})::date=$${v.length}::date`);
  }
  let r=await db(`SELECT ${fields} FROM trades WHERE ${w.join(" AND ")} ORDER BY trade_date DESC,id DESC LIMIT 1000`,v);
  res.json({trades:r.rows});
}catch(e){console.error(e);res.status(500).json({error:"Could not load trades."})}});
app.post("/api/trades",auth,async(req,res)=>{try{let b=req.body,s=String(b.symbol||"").trim().toUpperCase(),d=String(b.direction||"").toUpperCase(),acct=String(b.account||"Main Account").trim();if(!s||!["BUY","SELL"].includes(d))return res.status(400).json({error:"Symbol and direction are required."});let ac=await db("SELECT 1 FROM accounts WHERE user_id=$1 AND name=$2",[req.user.id,acct]);if(!ac.rowCount)return res.status(400).json({error:"Selected account does not exist."});let r=await db(`INSERT INTO trades(user_id,account,symbol,direction,entry,stop_loss,take_profit,exit_price,quantity,risk_amount,risk_percent,profit_loss,planned_rr,actual_r,strategy,session,setup,entry_reason,exit_reason,emotion_before,emotion_after,mistakes,confidence,market_condition,screenshot_data,notes,trade_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) RETURNING ${fields}`,[req.user.id,acct,s,d,n(b.entry),b.stopLoss===""?null:n(b.stopLoss,null),b.takeProfit===""?null:n(b.takeProfit,null),b.exitPrice===""?null:n(b.exitPrice,null),n(b.quantity,1),n(b.riskAmount),n(b.riskPercent),n(b.profitLoss),n(b.plannedRr),n(b.actualR),b.strategy||"",b.session||"",b.setup||"",b.entryReason||"",b.exitReason||"",b.emotionBefore||"",b.emotionAfter||"",b.mistakes||"",Math.max(0,Math.min(100,Math.round(n(b.confidence)))),b.marketCondition||"",String(b.screenshotData||"").slice(0,4500000),b.notes||"",b.tradeDate?new Date(b.tradeDate):new Date()]);res.status(201).json({trade:r.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not save trade."})}});
app.put("/api/trades/:id",auth,async(req,res)=>{try{let b=req.body,acct=String(b.account||"Main Account").trim(),sym=String(b.symbol||"").trim().toUpperCase(),dir=String(b.direction||"").toUpperCase();if(!sym||!["BUY","SELL"].includes(dir))return res.status(400).json({error:"Symbol and direction are required."});let ac=await db("SELECT 1 FROM accounts WHERE user_id=$1 AND name=$2",[req.user.id,acct]);if(!ac.rowCount)return res.status(400).json({error:"Selected account does not exist."});let r=await db(`UPDATE trades SET account=$1,symbol=$2,direction=$3,entry=$4,stop_loss=$5,take_profit=$6,exit_price=$7,quantity=$8,risk_amount=$9,risk_percent=$10,profit_loss=$11,planned_rr=$12,actual_r=$13,strategy=$14,session=$15,setup=$16,entry_reason=$17,exit_reason=$18,emotion_before=$19,emotion_after=$20,mistakes=$21,confidence=$22,market_condition=$23,screenshot_data=$24,notes=$25,trade_date=$26 WHERE id=$27 AND user_id=$28 RETURNING ${fields}`,[acct,sym,dir,n(b.entry),b.stopLoss===""?null:n(b.stopLoss,null),b.takeProfit===""?null:n(b.takeProfit,null),b.exitPrice===""?null:n(b.exitPrice,null),n(b.quantity,1),n(b.riskAmount),n(b.riskPercent),n(b.profitLoss),n(b.plannedRr),n(b.actualR),b.strategy||"",b.session||"",b.setup||"",b.entryReason||"",b.exitReason||"",b.emotionBefore||"",b.emotionAfter||"",b.mistakes||"",Math.max(0,Math.min(100,Math.round(n(b.confidence)))),b.marketCondition||"",String(b.screenshotData||"").slice(0,4500000),b.notes||"",b.tradeDate?new Date(b.tradeDate):new Date(),Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Trade not found."});res.json({trade:r.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not update trade."})}});
app.delete("/api/trades/:id",auth,async(req,res)=>{try{let r=await db("DELETE FROM trades WHERE id=$1 AND user_id=$2",[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Trade not found."});res.json({ok:true})}catch(e){console.error(e);res.status(500).json({error:"Could not delete trade."})}});
app.get("/api/analytics",auth,async(req,res)=>{try{
  const tz=String(req.query.tz||"UTC");
  const account=String(req.query.account||"").trim();
  const from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||""))?String(req.query.from):"";
  const to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||""))?String(req.query.to):"";
  const v=[req.user.id],w=["user_id=$1"];
  if(account){v.push(account);w.push(`account=$${v.length}`)}
  if(from){v.push(from);w.push(`trade_date >= $${v.length}::date::timestamp`)}
  if(to){v.push(to);w.push(`trade_date < ($${v.length}::date + INTERVAL '1 day')`)}
  const where=w.join(" AND ");
  const baseParams=[...v];
  const summary=await db(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE profit_loss>0)::int wins,COUNT(*) FILTER(WHERE profit_loss<0)::int losses,COALESCE(SUM(profit_loss),0)::numeric pnl,COALESCE(SUM(profit_loss) FILTER(WHERE profit_loss>0),0)::numeric gp,ABS(COALESCE(SUM(profit_loss) FILTER(WHERE profit_loss<0),0))::numeric gl,COALESCE(AVG(actual_r),0)::numeric avgr,COALESCE(AVG(profit_loss) FILTER(WHERE profit_loss>0),0)::numeric aw,COALESCE(AVG(profit_loss) FILTER(WHERE profit_loss<0),0)::numeric al,COALESCE(AVG(risk_percent),0)::numeric ar FROM trades WHERE ${where}` ,baseParams);
  const s=summary.rows[0],t=Number(s.total),wins=Number(s.wins),losses=Number(s.losses),gl=Number(s.gl),gp=Number(s.gp),al=Math.abs(Number(s.al)),aw=Number(s.aw),exp=t?wins/t*aw-losses/t*al:0;
  const balanceQuery=account?await db("SELECT COALESCE(starting_balance,0)::numeric starting_balance FROM accounts WHERE user_id=$1 AND name=$2",[req.user.id,account]):await db("SELECT COALESCE(SUM(starting_balance),0)::numeric starting_balance FROM accounts WHERE user_id=$1",[req.user.id]);
  const startingBalance=Number(balanceQuery.rows[0]?.starting_balance||0);
  const make=(sql,extra=[])=>db(sql,[...baseParams,...extra]);
  const idx=v.length;
  const [sym,strat,sess,dir,days,curve]=await Promise.all([
    make(`SELECT symbol,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY symbol ORDER BY pnl DESC`),
    make(`SELECT COALESCE(strategy,'Unspecified') strategy,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY strategy ORDER BY pnl DESC`),
    make(`SELECT COALESCE(session,'Unspecified') session,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY session ORDER BY pnl DESC`),
    make(`SELECT direction,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY direction ORDER BY direction`),
    make(`SELECT timezone($${idx+1},trade_date)::date AS day,COALESCE(SUM(profit_loss),0)::numeric AS pnl,COUNT(*)::int AS trades FROM trades WHERE ${where} GROUP BY timezone($${idx+1},trade_date)::date ORDER BY day`,[tz]),
    make(`SELECT profit_loss,trade_date FROM trades WHERE ${where} ORDER BY trade_date,id`)
  ]);
  let eq=0,peak=0,dd=0,ws=0,ls=0,bw=0,bl=0;
  curve.rows.forEach(x=>{const p=Number(x.profit_loss);eq+=p;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);if(p>0){ws++;ls=0;bw=Math.max(bw,ws)}else if(p<0){ls++;ws=0;bl=Math.max(bl,ls)}});
  res.json({summary:{total:t,wins,losses,pnl:Number(s.pnl),startingBalance,currentEquity:startingBalance+Number(s.pnl),winRate:t?wins/t*100:0,profitFactor:gl?gp/gl:(gp?Infinity:0),avgWin:aw,avgLoss:al,avgR:Number(s.avgr),avgRisk:Number(s.ar),expectancy:exp,maxDrawdown:Math.abs(dd),bestWinStreak:bw,bestLossStreak:bl},bySymbol:sym.rows,byStrategy:strat.rows,bySession:sess.rows,byDirection:dir.rows,byDay:days.rows});
}catch(e){console.error(e);res.status(500).json({error:"Analytics failed."})}});
app.get("/api/calendar",auth,async(req,res)=>{try{
  const m=String(req.query.month||"");
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))return res.status(400).json({error:"Invalid month."});
  const tz=String(req.query.tz||"UTC");
  const r=await db(`SELECT timezone($3,trade_date)::date AS day,COUNT(*)::int AS trades,COALESCE(SUM(profit_loss),0)::numeric AS pnl
    FROM trades WHERE user_id=$1
      AND trade_date >= timezone($3,(($2||'-01')::date::timestamp))
      AND trade_date < timezone($3,((($2||'-01')::date + INTERVAL '1 month')::timestamp))
    GROUP BY timezone($3,trade_date)::date ORDER BY day`,[req.user.id,m,tz]);
  res.json({days:r.rows});
}catch(e){console.error(e);res.status(500).json({error:"Calendar failed."})}});
app.get("/api/premium",auth,async(req,res)=>{try{
  const account=String(req.query.account||"").trim();
  const range=String(req.query.range||"all");
  const v=[req.user.id],w=["user_id=$1"];
  if(account){v.push(account);w.push(`account=$${v.length}`)}
  const now=new Date();
  if(range!=="all"){
    const from=new Date(now);
    if(range==="month")from.setMonth(from.getMonth(),1);
    else if(range==="3m")from.setMonth(from.getMonth()-2,1);
    else if(range==="6m")from.setMonth(from.getMonth()-5,1);
    else from.setFullYear(from.getFullYear()-1);
    const iso=from.toISOString().slice(0,10);
    v.push(iso);w.push(`trade_date >= $${v.length}::date`);
  }
  const r=await db(`SELECT ${fields} FROM trades WHERE ${w.join(" AND ")} ORDER BY trade_date ASC,id ASC LIMIT 5000`,v);
  const rows=r.rows.map(x=>({...x,pnl:Number(x.profit_loss||0),r:Number(x.actual_r||0),risk:Number(x.risk_percent||0),conf:Number(x.confidence||0)}));
  const groupBy=(keyFn)=>{const m=new Map();for(const x of rows){const k=String(keyFn(x)||"Unspecified");if(!m.has(k))m.set(k,[]);m.get(k).push(x)}return [...m].map(([name,a])=>{const wins=a.filter(x=>x.pnl>0).length,pnl=a.reduce((z,x)=>z+x.pnl,0),grossWin=a.filter(x=>x.pnl>0).reduce((z,x)=>z+x.pnl,0),grossLoss=Math.abs(a.filter(x=>x.pnl<0).reduce((z,x)=>z+x.pnl,0));return{name,trades:a.length,pnl,winRate:a.length?wins/a.length*100:0,profitFactor:grossLoss?grossWin/grossLoss:(grossWin?Infinity:0),avgR:a.length?a.reduce((z,x)=>z+x.r,0)/a.length:0}})};
  const edge=(arr)=>arr.filter(x=>x.trades>=3).sort((a,b)=>b.pnl-a.pnl);
  const symbols=edge(groupBy(x=>x.symbol)),strategies=edge(groupBy(x=>x.strategy)),setups=edge(groupBy(x=>x.setup)),sessions=edge(groupBy(x=>x.session)),markets=edge(groupBy(x=>x.market_condition));
  const emotions=edge(groupBy(x=>x.emotion_before)),confidence=[
    {name:"High (80–100)",min:80,max:100},{name:"Medium (50–79)",min:50,max:79},{name:"Low (0–49)",min:0,max:49}
  ].map(g=>{const a=rows.filter(x=>x.conf>=g.min&&x.conf<=g.max);const wins=a.filter(x=>x.pnl>0).length;return{...g,trades:a.length,pnl:a.reduce((z,x)=>z+x.pnl,0),winRate:a.length?wins/a.length*100:0,avgR:a.length?a.reduce((z,x)=>z+x.r,0)/a.length:0}}).filter(x=>x.trades);
  const avgRisk=rows.length?rows.reduce((z,x)=>z+x.risk,0)/rows.length:0;
  const riskOutliers=avgRisk?rows.filter(x=>x.risk>avgRisk*1.5).length:0;
  let cur=0,peak=0,maxDD=0,lossStreak=0,bestLossStreak=0,winStreak=0,bestWinStreak=0;
  for(const x of rows){cur+=x.pnl;if(cur>peak)peak=cur;maxDD=Math.min(maxDD,cur-peak);if(x.pnl<0){lossStreak++;winStreak=0;bestLossStreak=Math.max(bestLossStreak,lossStreak)}else if(x.pnl>0){winStreak++;lossStreak=0;bestWinStreak=Math.max(bestWinStreak,winStreak)}}
  const processFlags=rows.map(x=>({id:x.id,symbol:x.symbol,pnl:x.pnl,date:x.trade_date,reasons:[x.risk>avgRisk*1.5&&avgRisk>0?"Risk above your average":null,!x.stop_loss?"No stop loss recorded":null,!x.take_profit?"No take profit recorded":null,x.conf>0&&x.conf<40?"Low confidence":null,x.mistakes?"Mistake logged":null].filter(Boolean)})).filter(x=>x.reasons.length);
  const coach=[];
  if(rows.length){
    const best=[...symbols,...strategies,...setups].filter(x=>x.trades>=5).sort((a,b)=>b.pnl-a.pnl)[0];
    const worst=[...symbols,...strategies,...setups].filter(x=>x.trades>=5).sort((a,b)=>a.pnl-b.pnl)[0];
    if(best)coach.push({type:"EDGE",title:`Your strongest edge is ${best.name}`,body:`${best.trades} trades · ${best.winRate.toFixed(1)}% win rate · ${best.pnl>=0?"+":""}${best.pnl.toFixed(2)} P&L.`});
    if(worst&&worst.pnl<0)coach.push({type:"LEAK",title:`Your biggest performance leak is ${worst.name}`,body:`${worst.trades} trades · ${worst.winRate.toFixed(1)}% win rate · ${worst.pnl.toFixed(2)} P&L.`});
    if(riskOutliers)coach.push({type:"RISK",title:`${riskOutliers} trades were risk outliers`,body:`They used more than 1.5× your average recorded risk. Review these before increasing size.`});
    if(bestLossStreak>=3)coach.push({type:"DISCIPLINE",title:`Your worst losing streak is ${bestLossStreak}`,body:`Consider a hard daily stop or cooldown rule after consecutive losses.`});
    if(processFlags.length)coach.push({type:"PROCESS",title:`${processFlags.length} trades have process flags`,body:`Use the Process Review below to clean up missing protection, low-confidence entries, and mistakes.`});
  }
  const monday=new Date(now);const day=monday.getDay();const diff=(day+6)%7;monday.setDate(monday.getDate()-diff);monday.setHours(0,0,0,0);const weekRows=rows.filter(x=>new Date(x.trade_date)>=monday);const prevStart=new Date(monday);prevStart.setDate(prevStart.getDate()-7);const prevRows=rows.filter(x=>{const d=new Date(x.trade_date);return d>=prevStart&&d<monday});
  const stats=a=>{const pnl=a.reduce((z,x)=>z+x.pnl,0),wins=a.filter(x=>x.pnl>0).length;return{trades:a.length,pnl,winRate:a.length?wins/a.length*100:0,avgR:a.length?a.reduce((z,x)=>z+x.r,0)/a.length:0}};
  res.json({edge:{symbols,strategies,setups,sessions,markets},psychology:{emotions,confidence},risk:{avgRisk,maxDrawdown:Math.abs(maxDD),riskOutliers,bestLossStreak,bestWinStreak},processFlags:processFlags.slice(-30).reverse(),coach,weekly:{current:stats(weekRows),previous:stats(prevRows)}});
}catch(e){console.error(e);res.status(500).json({error:"Premium analytics failed."})}});
app.get("/api/export.csv",auth,async(req,res)=>{let r=await db(`SELECT ${fields} FROM trades WHERE user_id=$1 ORDER BY trade_date DESC`,[req.user.id]),cols=fields.split(","),q=x=>`"${String(x??"").replace(/"/g,'""')}"`;res.setHeader("Content-Type","text/csv");res.setHeader("Content-Disposition",'attachment; filename="ghosttrader-trades.csv"');res.send([cols.join(","),...r.rows.map(x=>cols.map(c=>q(x[c])).join(","))].join("\\n"))});
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
init().then(()=>app.listen(PORT,"0.0.0.0",()=>console.log("GhostTrader V2 running on "+PORT))).catch(e=>{console.error(e);process.exit(1)});
