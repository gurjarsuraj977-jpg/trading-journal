const express=require("express");

function createMissedRouter({db,auth,n}){
  const router=express.Router();

  router.get("/",auth,async(req,res)=>{try{const r=await db("SELECT * FROM missed_trades WHERE user_id=$1 ORDER BY trade_date DESC,id DESC LIMIT 500",[req.user.id]);res.json({missed:r.rows})}catch(e){res.status(500).json({error:"Could not load missed trades."})}});
  router.post("/",auth,async(req,res)=>{try{const r=await db("INSERT INTO missed_trades(user_id,account,symbol,direction,trade_date,setup,reason,potential_r,potential_pnl,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[req.user.id,String(req.body.account||""),String(req.body.symbol||"").trim().toUpperCase(),String(req.body.direction||""),req.body.tradeDate?new Date(req.body.tradeDate):new Date(),String(req.body.setup||""),String(req.body.reason||""),n(req.body.potentialR),n(req.body.potentialPnl),String(req.body.notes||"")]);res.status(201).json({missed:r.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not save missed trade."})}});
  router.delete("/:id",auth,async(req,res)=>{try{const r=await db("DELETE FROM missed_trades WHERE id=$1 AND user_id=$2",[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Missed trade not found."});res.json({ok:true})}catch(e){res.status(500).json({error:"Could not delete missed trade."})}});

  return router;
}

module.exports={createMissedRouter};
