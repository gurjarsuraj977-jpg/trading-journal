const express=require("express");

function createCalendarRouter({db,auth}){
  const router=express.Router();

  router.get("/",auth,async(req,res)=>{try{
    const m=String(req.query.month||"");
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))return res.status(400).json({error:"Invalid month."});
    const tz=String(req.query.tz||"UTC");
    /*
     * Batch 2: optional account filter, additive and backward
     * compatible - omitting it (as every existing caller still
     * does) returns every account's trades exactly as before.
     * Archived accounts are intentionally not excluded here: their
     * historical trades must keep showing up on the calendar, both
     * in "All accounts" and when that specific archived account is
     * selected.
     */
    const account=String(req.query.account||"").trim();
    const v=[req.user.id,m,tz],w=[
      "user_id=$1",
      "trade_date >= timezone($3,(($2||'-01')::date::timestamp))",
      "trade_date < timezone($3,((($2||'-01')::date + INTERVAL '1 month')::timestamp))"
    ];
    if(account){v.push(account);w.push(`account=$${v.length}`)}
    const r=await db(`SELECT timezone($3,trade_date)::date AS day,COUNT(*)::int AS trades,COALESCE(SUM(profit_loss),0)::numeric AS pnl
      FROM trades WHERE ${w.join(" AND ")}
      GROUP BY timezone($3,trade_date)::date ORDER BY day`,v);
    res.json({days:r.rows});
  }catch(e){console.error(e);res.status(500).json({error:"Calendar failed."})}});

  return router;
}

module.exports={createCalendarRouter};
