const express=require("express");

function createPlaybookRouter({db,auth,n}){
  const router=express.Router();

  router.get("/",auth,async(req,res)=>{try{const p=await db("SELECT * FROM playbooks WHERE user_id=$1 ORDER BY created_at DESC",[req.user.id]);const r=await db("SELECT r.* FROM playbook_rules r JOIN playbooks p ON p.id=r.playbook_id WHERE p.user_id=$1 ORDER BY r.playbook_id,r.id",[req.user.id]);res.json({playbooks:p.rows,rules:r.rows})}catch(e){console.error(e);res.status(500).json({error:"Could not load playbooks."})}});
  router.post("/",auth,async(req,res)=>{try{const name=String(req.body.name||"").trim();if(name.length<2)return res.status(400).json({error:"Playbook name is required."});const p=await db("INSERT INTO playbooks(user_id,name,description,strategy,risk_limit) VALUES($1,$2,$3,$4,$5) RETURNING *",[req.user.id,name,String(req.body.description||""),String(req.body.strategy||""),n(req.body.riskLimit,1)]);const rules=Array.isArray(req.body.rules)?req.body.rules:[];for(const x of rules){const label=String(x.label||"").trim();if(label)await db("INSERT INTO playbook_rules(playbook_id,label,weight,required) VALUES($1,$2,$3,$4)",[p.rows[0].id,label,Math.max(1,Math.round(n(x.weight,1))),x.required!==false])}res.status(201).json({playbook:p.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not create playbook."})}});
  router.put("/:id",auth,async(req,res)=>{try{const id=Number(req.params.id);const p=await db("UPDATE playbooks SET name=$1,description=$2,strategy=$3,risk_limit=$4,active=$5 WHERE id=$6 AND user_id=$7 RETURNING *",[String(req.body.name||"").trim(),String(req.body.description||""),String(req.body.strategy||""),n(req.body.riskLimit,1),req.body.active!==false,id,req.user.id]);if(!p.rowCount)return res.status(404).json({error:"Playbook not found."});await db("DELETE FROM playbook_rules WHERE playbook_id=$1",[id]);for(const x of (Array.isArray(req.body.rules)?req.body.rules:[])){const label=String(x.label||"").trim();if(label)await db("INSERT INTO playbook_rules(playbook_id,label,weight,required) VALUES($1,$2,$3,$4)",[id,label,Math.max(1,Math.round(n(x.weight,1))),x.required!==false])}res.json({playbook:p.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not update playbook."})}});
  router.delete("/:id",auth,async(req,res)=>{try{const r=await db("DELETE FROM playbooks WHERE id=$1 AND user_id=$2",[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Playbook not found."});res.json({ok:true})}catch(e){console.error(e);res.status(500).json({error:"Could not delete playbook."})}});

  return router;
}

module.exports={createPlaybookRouter};
