const express=require("express");

function createCalendarRouter({db,auth}){
  const router=express.Router();

  router.get("/",auth,async(req,res)=>{try{
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

  return router;
}

module.exports={createCalendarRouter};
