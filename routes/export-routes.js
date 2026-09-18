const express=require("express");

function createExportRouter({db,auth,fields}){
  const router=express.Router();

  router.get("/export.csv",auth,async(req,res)=>{try{let r=await db(`SELECT ${fields} FROM trades WHERE user_id=$1 ORDER BY trade_date DESC`,[req.user.id]),cols=fields.split(","),q=x=>`"${String(x??"").replace(/"/g,'""')}"`;res.setHeader("Content-Type","text/csv");res.setHeader("Content-Disposition",'attachment; filename="ghosttrader-trades.csv"');res.send([cols.join(","),...r.rows.map(x=>cols.map(c=>q(x[c])).join(","))].join("\n"))}catch(e){console.error(e);res.status(500).json({error:"Could not export trades."})}});

  return router;
}

module.exports={createExportRouter};
