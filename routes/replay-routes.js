const express=require("express");

function createReplayRouter({db,auth,fields}){
  const router=express.Router();

  router.get("/:id",auth,async(req,res)=>{try{const r=await db(`SELECT ${fields} FROM trades WHERE id=$1 AND user_id=$2`,[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Trade not found."});res.json({trade:r.rows[0]})}catch(e){res.status(500).json({error:"Replay load failed."})}});

  return router;
}

module.exports={createReplayRouter};
