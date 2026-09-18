const express=require("express");

function createPremiumRouter({db,auth,fields}){
  const router=express.Router();

  router.get("/",auth,async(req,res)=>{try{
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

  return router;
}

module.exports={createPremiumRouter};
