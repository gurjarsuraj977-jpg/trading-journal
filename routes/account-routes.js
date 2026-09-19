const express=require("express");

function createAccountRouter({db,auth,n}){
  const router=express.Router();

  router.get("/",auth,async(req,res)=>{let r=await db(`SELECT a.*,COALESCE(SUM(t.profit_loss),0) pnl FROM accounts a LEFT JOIN trades t ON t.user_id=a.user_id AND t.account=a.name WHERE a.user_id=$1 GROUP BY a.id ORDER BY a.created_at`,[req.user.id]);res.json({accounts:r.rows})});
  router.post("/",auth,async(req,res)=>{try{let name=String(req.body.name||"").trim(),currency=String(req.body.currency||"USD").trim().toUpperCase();if(name.length<2||name.length>100)return res.status(400).json({error:"Account name must be 2-100 characters."});if(!/^[A-Z]{3,10}$/.test(currency))return res.status(400).json({error:"Currency must be 3-10 letters."});let r=await db("INSERT INTO accounts(user_id,name,starting_balance,currency) VALUES($1,$2,$3,$4) RETURNING *",[req.user.id,name,n(req.body.startingBalance),currency]);res.status(201).json({account:r.rows[0]})}catch(e){console.error(e);res.status(400).json({error:e.code==="23505"?"That account already exists.":"Could not create account."})}});
  router.put("/:id",auth,async(req,res)=>{
    try{
      const id=Number(req.params.id);

      if(!Number.isInteger(id)||id<=0){
        return res.status(400).json({error:"Invalid account."});
      }

      /*
       * Batch 1B — account lifecycle (archive/reactivate).
       * This endpoint now accepts an optional `active` boolean in
       * addition to the existing `startingBalance`, following the
       * same pattern the playbooks route already uses (a single
       * authenticated, ownership-checked PUT that can update either
       * field). Any field not present in the request body falls back
       * to the account's current stored value, so existing
       * balance-only calls behave exactly as before and an
       * archive/reactivate call does not need to resend the balance.
       */
      const existing=await db(
        "SELECT * FROM accounts WHERE id=$1 AND user_id=$2",
        [id,req.user.id]
      );

      if(!existing.rowCount){
        return res.status(404).json({error:"Account not found."});
      }

      const current=existing.rows[0];

      const startingBalance=req.body.startingBalance!==undefined
        ? Number(req.body.startingBalance)
        : Number(current.starting_balance);

      if(!Number.isFinite(startingBalance)||startingBalance<0){
        return res.status(400).json({error:"Starting balance must be a valid non-negative number."});
      }

      const active=req.body.active!==undefined
        ? !!req.body.active
        : current.active;

      const r=await db(
        `
        UPDATE accounts
        SET starting_balance=$1,active=$2
        WHERE id=$3 AND user_id=$4
        RETURNING *
        `,
        [startingBalance,active,id,req.user.id]
      );

      if(!r.rows.length){
        return res.status(404).json({error:"Account not found."});
      }

      res.json({account:r.rows[0]});
    }catch(e){
      console.error(e);
      res.status(400).json({error:"Could not update account."});
    }
  });

  return router;
}

module.exports={createAccountRouter};
