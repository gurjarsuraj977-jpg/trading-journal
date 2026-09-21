const express=require("express");

/*
 * GhostTrader Accounts V2 — "Account Command Center".
 *
 * Everything in this file is scoped to req.user.id on every query, so an
 * account ID or account name a user does not own can never be read,
 * edited, archived, or deleted (IDOR-safe by construction — see the
 * `AND user_id=$` clause on every statement that touches `accounts` or
 * `trades`).
 *
 * Trade matching: a trade belongs to an account if either
 *   - trades.account_id = accounts.id (the real FK, added in Batch 1C), or
 *   - trades.account_id IS NULL AND trades.account = accounts.name
 *     (an older/unmatched trade whose free-text account name still lines
 *     up with this account — see migrations/013_trades_account_id.sql)
 * This mirrors exactly the backfill logic in db/init.js, so stats here
 * never silently drop a trade that every other part of the app still
 * counts as belonging to this account.
 */

const ACCOUNT_TYPES=["manual","prop","personal","demo","evaluation"];

function tradeMatchClause(accountIdParam,accountNameParam){
  return `(t.account_id=${accountIdParam} OR (t.account_id IS NULL AND t.account=${accountNameParam}))`;
}

function createAccountRouter({db,auth,n}){
  const router=express.Router();
  const {pool}=require("../db/pool");

  async function beginTx(){
    const client=await pool.connect();
    await client.query("BEGIN");
    return client;
  }

  // ---------------------------------------------------------------
  // GET / — account list + portfolio overview
  // ---------------------------------------------------------------
  router.get("/",auth,async(req,res)=>{
    try{
      const r=await db(
        `
        SELECT
          a.*,
          COALESCE(SUM(t.profit_loss),0)::numeric AS pnl,
          COUNT(t.id)::int AS trade_count,
          COUNT(t.id) FILTER (WHERE t.profit_loss>0)::int AS wins,
          COALESCE(AVG(t.risk_percent),0)::numeric AS avg_risk_percent,
          MAX(t.trade_date) AS last_trade_date
        FROM accounts a
        LEFT JOIN trades t
          ON t.user_id=a.user_id
          AND ${tradeMatchClause("a.id","a.name")}
        WHERE a.user_id=$1
        GROUP BY a.id
        ORDER BY a.is_primary DESC, a.active DESC, a.created_at ASC
        `,
        [req.user.id]
      );

      const accounts=r.rows.map(a=>({
        ...a,
        starting_balance:Number(a.starting_balance||0),
        pnl:Number(a.pnl||0),
        equity:Number(a.starting_balance||0)+Number(a.pnl||0),
        trade_count:Number(a.trade_count||0),
        win_rate:Number(a.trade_count||0)?Number(a.wins||0)/Number(a.trade_count||0)*100:0,
        avg_risk_percent:Number(a.avg_risk_percent||0)
      }));

      const activeAccounts=accounts.filter(a=>a.active!==false);

      const summary={
        totalAccounts:accounts.length,
        activeAccounts:activeAccounts.length,
        totalCapital:activeAccounts.reduce((s,a)=>s+a.starting_balance,0),
        currentEquity:activeAccounts.reduce((s,a)=>s+a.equity,0),
        totalPnl:activeAccounts.reduce((s,a)=>s+a.pnl,0)
      };

      res.json({accounts,summary});
    }catch(e){
      console.error(e);
      res.status(500).json({error:"Could not load accounts."});
    }
  });

  // ---------------------------------------------------------------
  // GET /:id — account detail: overview + performance + risk +
  // equity curve + (optionally filtered) trade list.
  // ---------------------------------------------------------------
  router.get("/:id",auth,async(req,res)=>{
    try{
      const id=Number(req.params.id);
      if(!Number.isInteger(id)||id<=0){
        return res.status(400).json({error:"Invalid account."});
      }

      const acctR=await db(
        "SELECT * FROM accounts WHERE id=$1 AND user_id=$2",
        [id,req.user.id]
      );
      if(!acctR.rowCount){
        return res.status(404).json({error:"Account not found."});
      }
      const account=acctR.rows[0];

      const v=[req.user.id,id,account.name];
      const w=["t.user_id=$1",tradeMatchClause("$2","$3")];

      if(req.query.symbol){
        v.push("%"+String(req.query.symbol).trim()+"%");
        w.push(`t.symbol ILIKE $${v.length}`);
      }
      if(["BUY","SELL"].includes(req.query.direction)){
        v.push(req.query.direction);
        w.push(`t.direction=$${v.length}`);
      }
      if(req.query.result==="win")w.push("t.profit_loss>0");
      if(req.query.result==="loss")w.push("t.profit_loss<0");
      if(req.query.strategy){
        v.push(String(req.query.strategy).trim());
        w.push(`t.strategy=$${v.length}`);
      }
      if(req.query.session){
        v.push(String(req.query.session).trim());
        w.push(`t.session=$${v.length}`);
      }
      if(req.query.playbookId&&Number.isInteger(Number(req.query.playbookId))){
        v.push(Number(req.query.playbookId));
        w.push(`t.playbook_id=$${v.length}`);
      }
      if(req.query.from&&/^\d{4}-\d{2}-\d{2}$/.test(req.query.from)){
        v.push(req.query.from);
        w.push(`t.trade_date >= $${v.length}::date::timestamp`);
      }
      if(req.query.to&&/^\d{4}-\d{2}-\d{2}$/.test(req.query.to)){
        v.push(req.query.to);
        w.push(`t.trade_date < ($${v.length}::date + INTERVAL '1 day')`);
      }

      const where=w.join(" AND ");

      const [summaryR,curveR,tradesR]=await Promise.all([
        db(
          `
          SELECT
            COUNT(*)::int total,
            COUNT(*) FILTER (WHERE t.profit_loss>0)::int wins,
            COUNT(*) FILTER (WHERE t.profit_loss<0)::int losses,
            COALESCE(SUM(t.profit_loss),0)::numeric pnl,
            COALESCE(SUM(t.profit_loss) FILTER (WHERE t.profit_loss>0),0)::numeric gp,
            ABS(COALESCE(SUM(t.profit_loss) FILTER (WHERE t.profit_loss<0),0))::numeric gl,
            COALESCE(AVG(t.actual_r),0)::numeric avgr,
            COALESCE(AVG(t.profit_loss) FILTER (WHERE t.profit_loss>0),0)::numeric aw,
            COALESCE(AVG(t.profit_loss) FILTER (WHERE t.profit_loss<0),0)::numeric al,
            COALESCE(AVG(t.risk_percent),0)::numeric avg_risk_percent,
            COALESCE(AVG(t.risk_amount),0)::numeric avg_risk_amount,
            COALESCE(MAX(t.risk_percent),0)::numeric largest_risk_percent,
            COALESCE(STDDEV_POP(t.risk_percent),0)::numeric risk_stddev,
            COALESCE(MAX(t.profit_loss),0)::numeric best_trade,
            COALESCE(MIN(t.profit_loss),0)::numeric worst_trade
          FROM trades t WHERE ${where}
          `,
          v
        ),
        db(`SELECT t.profit_loss,t.trade_date FROM trades t WHERE ${where} ORDER BY t.trade_date,t.id`,v),
        db(
          `SELECT t.id,t.account,t.symbol,t.direction,t.entry,t.exit_price,t.quantity,
                  t.risk_amount,t.risk_level,t.profit_loss,t.actual_r,t.strategy,t.session,t.trade_date
           FROM trades t WHERE ${where} ORDER BY t.trade_date DESC,t.id DESC LIMIT 500`,
          v
        )
      ]);

      const s=summaryR.rows[0];
      const t=Number(s.total),wins=Number(s.wins),losses=Number(s.losses);
      const gp=Number(s.gp),gl=Number(s.gl),aw=Number(s.aw),al=Math.abs(Number(s.al));
      const profitFactorInfinite=gl===0&&gp>0;
      const profitFactor=gl?gp/gl:0;
      const expectancy=t?wins/t*aw-losses/t*al:0;

      let eq=0,peak=0,dd=0,ws=0,ls=0,bw=0,bl=0;
      const equityCurve=curveR.rows.map(x=>{
        const p=Number(x.profit_loss);
        eq+=p;
        peak=Math.max(peak,eq);
        dd=Math.min(dd,eq-peak);
        if(p>0){ws++;ls=0;bw=Math.max(bw,ws)}
        else if(p<0){ls++;ws=0;bl=Math.max(bl,ls)}
        return{date:x.trade_date,equity:Number(account.starting_balance||0)+eq,pnl:eq};
      });

      const avgRiskPercent=Number(s.avg_risk_percent||0);
      const riskStddev=Number(s.risk_stddev||0);
      const riskConsistency=avgRiskPercent>0
        ?Math.max(0,Math.round(100-(riskStddev/avgRiskPercent)*100))
        :null;

      res.json({
        account:{
          ...account,
          starting_balance:Number(account.starting_balance||0)
        },
        performance:{
          total:t,wins,losses,
          pnl:Number(s.pnl),
          startingBalance:Number(account.starting_balance||0),
          currentEquity:Number(account.starting_balance||0)+Number(s.pnl),
          winRate:t?wins/t*100:0,
          profitFactor,profitFactorInfinite,
          avgWin:aw,avgLoss:al,avgR:Number(s.avgr),
          expectancy,
          maxDrawdown:Math.abs(dd),
          bestWinStreak:bw,bestLossStreak:bl,
          bestTrade:Number(s.best_trade),
          worstTrade:Number(s.worst_trade)
        },
        risk:{
          avgRiskPercent,
          avgRiskAmount:Number(s.avg_risk_amount||0),
          largestRiskPercent:Number(s.largest_risk_percent||0),
          riskConsistency
        },
        equityCurve,
        trades:tradesR.rows
      });
    }catch(e){
      console.error(e);
      res.status(500).json({error:"Could not load account detail."});
    }
  });

  // ---------------------------------------------------------------
  // POST / — create account
  // ---------------------------------------------------------------
  router.post("/",auth,async(req,res)=>{
    try{
      const name=String(req.body.name||"").trim();
      const currency=String(req.body.currency||"USD").trim().toUpperCase();
      const broker=req.body.broker!==undefined?(String(req.body.broker||"").trim().slice(0,80)||null):null;
      const accountType=ACCOUNT_TYPES.includes(req.body.accountType)?req.body.accountType:"manual";
      const wantsPrimary=!!req.body.isPrimary;

      if(name.length<2||name.length>100){
        return res.status(400).json({error:"Account name must be 2-100 characters."});
      }
      if(!/^[A-Z]{3,10}$/.test(currency)){
        return res.status(400).json({error:"Currency must be 3-10 letters."});
      }

      const existingCount=await db("SELECT COUNT(*)::int c FROM accounts WHERE user_id=$1",[req.user.id]);
      const isFirstAccount=Number(existingCount.rows[0].c)===0;

      const client=await beginTx();
      try{
        if(wantsPrimary||isFirstAccount){
          await client.query("UPDATE accounts SET is_primary=FALSE WHERE user_id=$1",[req.user.id]);
        }

        const r=await client.query(
          `INSERT INTO accounts(user_id,name,starting_balance,currency,broker,account_type,is_primary,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
          [req.user.id,name,n(req.body.startingBalance),currency,broker,accountType,wantsPrimary||isFirstAccount]
        );

        await client.query("COMMIT");
        res.status(201).json({account:r.rows[0]});
      }catch(e){
        await client.query("ROLLBACK");
        throw e;
      }finally{
        client.release();
      }
    }catch(e){
      console.error(e);
      res.status(400).json({error:e.code==="23505"?"That account already exists.":"Could not create account."});
    }
  });

  // ---------------------------------------------------------------
  // PUT /:id — update account
  // ---------------------------------------------------------------
  router.put("/:id",auth,async(req,res)=>{
    try{
      const id=Number(req.params.id);
      if(!Number.isInteger(id)||id<=0){
        return res.status(400).json({error:"Invalid account."});
      }

      const existing=await db("SELECT * FROM accounts WHERE id=$1 AND user_id=$2",[id,req.user.id]);
      if(!existing.rowCount){
        return res.status(404).json({error:"Account not found."});
      }
      const current=existing.rows[0];

      const startingBalance=req.body.startingBalance!==undefined
        ?Number(req.body.startingBalance)
        :Number(current.starting_balance);
      if(!Number.isFinite(startingBalance)||startingBalance<0){
        return res.status(400).json({error:"Starting balance must be a valid non-negative number."});
      }

      const active=req.body.active!==undefined?!!req.body.active:current.active;

      const name=req.body.name!==undefined?String(req.body.name).trim():current.name;
      if(name.length<2||name.length>100){
        return res.status(400).json({error:"Account name must be 2-100 characters."});
      }

      const broker=req.body.broker!==undefined
        ?(String(req.body.broker||"").trim().slice(0,80)||null)
        :current.broker;

      const accountType=req.body.accountType!==undefined
        ?(ACCOUNT_TYPES.includes(req.body.accountType)?req.body.accountType:current.account_type)
        :current.account_type;

      const wantsPrimary=req.body.isPrimary!==undefined?!!req.body.isPrimary:current.is_primary;

      const archivedAt=active===false
        ?(current.active!==false?new Date():current.archived_at)
        :null;

      const client=await beginTx();
      try{
        if(name!==current.name){
          // Keep trades.account (the free-text label several other
          // modules — execution, simulation, import/export, missed
          // trades — still filter on) in sync for every trade linked to
          // this account by ID, so a rename can't silently desync those
          // other screens. Unlinked trades (account_id IS NULL) are left
          // alone, exactly like the Batch 1C backfill does.
          await client.query(
            "UPDATE trades SET account=$1 WHERE user_id=$2 AND account_id=$3",
            [name,req.user.id,id]
          );
        }

        if(wantsPrimary&&!current.is_primary){
          await client.query("UPDATE accounts SET is_primary=FALSE WHERE user_id=$1",[req.user.id]);
        }

        const r=await client.query(
          `
          UPDATE accounts
          SET starting_balance=$1,active=$2,name=$3,broker=$4,account_type=$5,
              is_primary=$6,archived_at=$7,updated_at=NOW()
          WHERE id=$8 AND user_id=$9
          RETURNING *
          `,
          [startingBalance,active,name,broker,accountType,wantsPrimary,archivedAt,id,req.user.id]
        );

        if(!r.rows.length){
          await client.query("ROLLBACK");
          return res.status(404).json({error:"Account not found."});
        }

        await client.query("COMMIT");
        res.json({account:r.rows[0]});
      }catch(e){
        await client.query("ROLLBACK");
        throw e;
      }finally{
        client.release();
      }
    }catch(e){
      console.error(e);
      res.status(400).json({error:e.code==="23505"?"That account name is already in use.":"Could not update account."});
    }
  });

  // ---------------------------------------------------------------
  // DELETE /:id — hard delete, but ONLY when the account has no
  // trading history. An account with trades must be archived instead
  // (PUT { active:false }) — trading history is never cascade-deleted
  // just to make the UI easier.
  // ---------------------------------------------------------------
  router.delete("/:id",auth,async(req,res)=>{
    try{
      const id=Number(req.params.id);
      if(!Number.isInteger(id)||id<=0){
        return res.status(400).json({error:"Invalid account."});
      }

      const existing=await db("SELECT * FROM accounts WHERE id=$1 AND user_id=$2",[id,req.user.id]);
      if(!existing.rowCount){
        return res.status(404).json({error:"Account not found."});
      }
      const account=existing.rows[0];

      const tradeCount=await db(
        `SELECT COUNT(*)::int c FROM trades t WHERE t.user_id=$1 AND ${tradeMatchClause("$2","$3")}`,
        [req.user.id,id,account.name]
      );

      if(Number(tradeCount.rows[0].c)>0){
        return res.status(409).json({
          error:`This account has ${tradeCount.rows[0].c} trade(s) attached and can't be deleted. Archive it instead to keep your trading history intact.`,
          tradeCount:Number(tradeCount.rows[0].c)
        });
      }

      await db("DELETE FROM accounts WHERE id=$1 AND user_id=$2",[id,req.user.id]);
      res.json({ok:true});
    }catch(e){
      console.error(e);
      res.status(400).json({error:"Could not delete account."});
    }
  });

  return router;
}

module.exports={createAccountRouter};
