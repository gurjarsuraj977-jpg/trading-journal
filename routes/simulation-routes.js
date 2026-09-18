const express=require("express");

function createSimulationRouter({db,auth,n}){
  const router=express.Router();

  router.post("/api/simulate",auth,async(req,res)=>{try{let w=["user_id=$1"],v=[req.user.id];if(req.body.account){v.push(String(req.body.account));w.push(`account=$${v.length}`)}if(req.body.symbol){v.push(String(req.body.symbol).trim().toUpperCase());w.push(`symbol=$${v.length}`)}const rows=(await db(`SELECT actual_r,mfe_r,mae_r,profit_loss,risk_amount FROM trades WHERE ${w.join(" AND ")} ORDER BY trade_date`,v)).rows;const target=n(req.body.targetR,2),stop=-Math.abs(n(req.body.stopR,1));let pnlR=0,wins=0,losses=0,usable=0;for(const x of rows){const mfe=n(x.mfe_r),mae=n(x.mae_r);if(!mfe&&!mae)continue;usable++;let rr=n(x.actual_r);if(mfe>=target)rr=target;else if(mae<=stop)rr=stop;wins+=rr>0?1:0;losses+=rr<0?1:0;pnlR+=rr}res.json({trades:rows.length,usable,wins,losses,targetR:target,stopR:stop,simulatedR:pnlR,winRate:usable?wins/usable*100:0,avgR:usable?pnlR/usable:0})}catch(e){console.error(e);res.status(500).json({error:"Simulation failed."})}});
  router.post("/api/backtests",auth,async(req,res)=>{try{const r=await db("INSERT INTO backtests(user_id,name,symbol,target_r,stop_r) VALUES($1,$2,$3,$4,$5) RETURNING *",[req.user.id,String(req.body.name||"Scenario"),String(req.body.symbol||""),n(req.body.targetR,2),Math.abs(n(req.body.stopR,1))]);res.status(201).json({backtest:r.rows[0]})}catch(e){res.status(500).json({error:"Could not save simulation."})}});

  return router;
}

module.exports={createSimulationRouter};
