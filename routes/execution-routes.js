const express=require("express");

function createExecutionRouter({db,auth}){
  const router=express.Router();

  router.get("/",auth,async(req,res)=>{try{let w=["user_id=$1"],v=[req.user.id];if(req.query.account){v.push(String(req.query.account));w.push(`account=$${v.length}`)}const r=await db(`SELECT symbol,COUNT(*)::int trades,COALESCE(AVG(mfe_r),0)::numeric avg_mfe,COALESCE(AVG(mae_r),0)::numeric avg_mae,COALESCE(AVG(actual_r),0)::numeric avg_r,COALESCE(AVG(CASE WHEN mfe_r>0 THEN actual_r/NULLIF(mfe_r,0) END),0)::numeric exit_efficiency,COALESCE(AVG(rule_score),0)::numeric rule_score FROM trades WHERE ${w.join(" AND ")} GROUP BY symbol ORDER BY avg_r DESC`,v);const overall=await db(`SELECT COUNT(*)::int trades,COALESCE(AVG(mfe_r),0)::numeric avg_mfe,COALESCE(AVG(mae_r),0)::numeric avg_mae,COALESCE(AVG(actual_r),0)::numeric avg_r,COALESCE(AVG(CASE WHEN mfe_r>0 THEN actual_r/NULLIF(mfe_r,0) END),0)::numeric exit_efficiency,COALESCE(AVG(rule_score),0)::numeric rule_score FROM trades WHERE ${w.join(" AND ")}`,v);res.json({overall:overall.rows[0],bySymbol:r.rows})}catch(e){console.error(e);res.status(500).json({error:"Execution analytics failed."})}});

  return router;
}

module.exports={createExecutionRouter};
