require("dotenv").config();
const express=require("express"),path=require("path"),cookieParser=require("cookie-parser"),bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken");
const {createMarketDataRouter}=require("./market-data/market-data-routes");
const {createMarketDataProviderRouter}=require("./market-data/market-data-provider-routes");
const {calculateTrade}=require("./utils/trade-calculator");
const {getSymbolSpec}=require("./utils/symbol-specs");
const {n}=require("./utils/number");
const {pool,db}=require("./db/pool");
const createAuthMiddleware=require("./middleware/auth");
const init=require("./db/init");
const {createAuthRouter}=require("./routes/auth-routes");
const {createAccountRouter}=require("./routes/account-routes");
const {createPlaybookRouter}=require("./routes/playbook-routes");
const {createMissedRouter}=require("./routes/missed-routes");
const {createExecutionRouter}=require("./routes/execution-routes");
const {createSimulationRouter}=require("./routes/simulation-routes");
const {createAnalyticsRouter}=require("./routes/analytics-routes");
const {createCalendarRouter}=require("./routes/calendar-routes");
const {createPremiumRouter}=require("./routes/premium-routes");
const {createReplayRouter}=require("./routes/replay-routes");
const {createAiCoachRouter}=require("./routes/ai-coach-routes");
const {createImportRouter}=require("./routes/import-routes");
const {createExportRouter}=require("./routes/export-routes");
const {getCurrencyConversionRate}=require("./market-data/twelve-data");
const {createTradeLockerRouter}=require("./tradelocker/tradelocker-routes");
const {createMT5Router}=require("./mt5/mt5-routes");
const {createAdminRouter}=require("./routes/admin-routes");
/*
 * Batch 1B — JWT secret hardening.
 * Production must never silently sign tokens with the public
 * "dev-only-change-me" fallback. Development keeps the fallback
 * so local setup still works without extra config.
 */
if(process.env.NODE_ENV==="production"&&!process.env.JWT_SECRET){
  console.error("FATAL: JWT_SECRET must be set when NODE_ENV=production. Refusing to start with a default signing secret.");
  process.exit(1);
}
const app=express(),PORT=process.env.PORT||10000,SECRET=process.env.JWT_SECRET||"dev-only-change-me";
app.use(express.json({limit:"5mb"}));app.use(cookieParser());app.use(express.static(path.join(__dirname,"public")));
const auth=createAuthMiddleware({SECRET,db});

app.use("/api/market-data",createMarketDataRouter({db,auth}));
app.use("/api/market-data",createMarketDataProviderRouter({db,auth}));
app.use("/api/tradelocker",createTradeLockerRouter({db,auth}));
app.use("/api/mt5",createMT5Router({db,auth}));
function token(u){return jwt.sign({id:u.id,name:u.name,email:u.email,token_version:Number(u.token_version||0)},SECRET,{expiresIn:"7d"})}
const setCookie=(res,t)=>res.cookie("gt_token",t,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:604800000});
app.use("/api/auth",createAuthRouter({db,bcrypt,token,setCookie,auth}));
app.use("/api/accounts",createAccountRouter({db,auth,n}));
const fields="id,account,account_id,symbol,direction,entry,stop_loss,take_profit,exit_price,quantity,risk_amount,risk_percent,risk_level,profit_loss,planned_rr,actual_r,mfe_r,mae_r,max_favorable_price,max_adverse_price,rule_score,playbook_id,strategy,session,setup,entry_reason,exit_reason,emotion_before,emotion_after,mistakes,confidence,market_condition,screenshot_data,notes,trade_date";
/*
 * Batch A2 — normal trade-list responses must never carry the
 * (potentially multi-MB base64) screenshot_data column. listFields
 * is `fields` minus screenshot_data, used only for the ordinary
 * list endpoint below. Every other consumer (POST/PUT RETURNING,
 * the Replay/export/premium routers) keeps using `fields`
 * unchanged, since Batch A only targets GET /api/trades.
 */
const listFields=fields.split(",").filter(f=>f!=="screenshot_data").join(",");
app.get("/api/trades",auth,async(req,res)=>{try{
  let v=[req.user.id],w=["user_id=$1"];
  if(req.query.symbol){v.push("%"+String(req.query.symbol).trim()+"%");w.push(`symbol ILIKE $${v.length}`)}
  if(["BUY","SELL"].includes(req.query.direction)){v.push(req.query.direction);w.push(`direction=$${v.length}`)}
  if(req.query.result==="win")w.push("profit_loss>0");
  if(req.query.result==="loss")w.push("profit_loss<0");
  if(req.query.account){v.push(String(req.query.account));w.push(`account=$${v.length}`)}
  if(req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from)){v.push(req.query.from);w.push(`trade_date >= $${v.length}::date::timestamp`)}
  if(req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to)){v.push(req.query.to);w.push(`trade_date < ($${v.length}::date + INTERVAL '1 day')`)}
  if(req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)){
    const tz=String(req.query.tz||"UTC");v.push(tz,req.query.date);
    w.push(`(trade_date AT TIME ZONE $${v.length-1})::date=$${v.length}::date`);
  }
  let r=await db(`SELECT ${listFields} FROM trades WHERE ${w.join(" AND ")} ORDER BY trade_date DESC,id DESC LIMIT 1000`,v);
  res.json({trades:r.rows});
}catch(e){console.error(e);res.status(500).json({error:"Could not load trades."})}});
/*
 * Batch A2 — targeted retrieval path for consumers that genuinely
 * need a single trade's full data, screenshot included (the edit
 * form's "keep existing screenshot unless a new file is chosen"
 * logic). Scoped to one trade at a time so it never re-introduces
 * the bulk-screenshot payload the list endpoint above just removed.
 */
app.get("/api/trades/:id",auth,async(req,res)=>{try{
  const id=Number(req.params.id);
  if(!Number.isInteger(id)||id<=0)return res.status(400).json({error:"Invalid trade ID."});
  let r=await db(`SELECT ${fields} FROM trades WHERE id=$1 AND user_id=$2`,[id,req.user.id]);
  if(!r.rowCount)return res.status(404).json({error:"Trade not found."});
  res.json({trade:r.rows[0]});
}catch(e){console.error(e);res.status(500).json({error:"Could not load trade."})}});
app.post("/api/trades",auth,async(req,res)=>{
  try{
    const b=req.body;

    const s=String(b.symbol||"").trim().toUpperCase();
    const d=String(b.direction||"").toUpperCase();
    const acct=String(b.account||"Main Account").trim();

    if(!s||!["BUY","SELL"].includes(d)){
      return res.status(400).json({
        error:"Symbol and direction are required."
      });
    }

/*
 * Batch 1C — resolve the account's id/active status alongside the
 * balance/currency the calculation already needed. A brand-new
 * trade must never be attached to an archived account: the
 * frontend already hides archived accounts from the "add trade"
 * picker, but the backend is the actual enforcement layer since a
 * caller could otherwise submit an archived account name directly.
 */
const ac=await db(
  "SELECT id,starting_balance,currency,active FROM accounts WHERE user_id=$1 AND name=$2",
  [req.user.id,acct]
);

    if(!ac.rowCount){
      return res.status(400).json({
        error:"Selected account does not exist."
      });
    }

    if(ac.rows[0].active===false){
      return res.status(400).json({
        error:"Selected account is archived. Reactivate it or choose an active account to add new trades."
      });
    }

    const entry=n(b.entry);

    const stopLoss=
      b.stopLoss===""||
      b.stopLoss===null||
      b.stopLoss===undefined
        ? null
        : n(b.stopLoss,null);

    const takeProfit=
      b.takeProfit===""||
      b.takeProfit===null||
      b.takeProfit===undefined
        ? null
        : n(b.takeProfit,null);

    const exitPrice=
      b.exitPrice===""||
      b.exitPrice===null||
      b.exitPrice===undefined
        ? null
        : n(b.exitPrice,null);

const quantity=n(b.quantity,1);

const accountCurrency=String(
  ac.rows[0].currency||"USD"
).trim().toUpperCase();

const symbolSpec=getSymbolSpec(s);

let pnlConversionRate=null;

if(
  symbolSpec.known &&
  symbolSpec.pnlCurrency &&
  accountCurrency &&
  symbolSpec.pnlCurrency.toUpperCase()!==accountCurrency
){
  const conversion=await getCurrencyConversionRate({
    fromCurrency:symbolSpec.pnlCurrency,
    toCurrency:accountCurrency
  });

  pnlConversionRate=conversion.rate;
}

/*
 * IMPORTANT:
 * Backend calculation is now authoritative.
 * Frontend-calculated values are NOT trusted.
 */
const calculated=calculateTrade({
  symbol:s,
  direction:d,
  entry,
  stopLoss,
  takeProfit,
  exitPrice,
  quantity,
  accountBalance:n(
    ac.rows[0].starting_balance,
    0
  ),
  accountCurrency,
  pnlConversionRate
});

    /*
     * Batch A1 — POST must reject the same way PUT already does:
     * an unknown/unconvertible symbol or missing conversion means
     * calculateTrade() returns calculated.error, and an invalid or
     * zero-value trade must never reach the database.
     */
    if(calculated.error){
      return res.status(400).json({
        error:calculated.error,
        calculation:calculated
      });
    }

    let mfeR=n(b.mfeR);
    let maeR=n(b.maeR);

    const maxFavorable=
      b.maxFavorablePrice===""||
      b.maxFavorablePrice===null||
      b.maxFavorablePrice===undefined
        ? null
        : n(b.maxFavorablePrice,null);

    const maxAdverse=
      b.maxAdversePrice===""||
      b.maxAdversePrice===null||
      b.maxAdversePrice===undefined
        ? null
        : n(b.maxAdversePrice,null);

    if(
      calculated.riskAmount>0&&
      calculated.entrySlDistance>0
    ){

      if(maxFavorable!==null){
        const favorableDistance=
          d==="BUY"
            ? maxFavorable-entry
            : entry-maxFavorable;

        mfeR=
          favorableDistance/
          calculated.entrySlDistance;
      }

      if(maxAdverse!==null){
        const adverseDistance=
          d==="BUY"
            ? entry-maxAdverse
            : maxAdverse-entry;

        maeR=
          adverseDistance/
          calculated.entrySlDistance;
      }
    }

    const r=await db(`
      INSERT INTO trades(
        user_id,
        account,
        account_id,
        symbol,
        direction,
        entry,
        stop_loss,
        take_profit,
        exit_price,
        quantity,
risk_amount,
risk_percent,
risk_level,
profit_loss,
        planned_rr,
        actual_r,
        mfe_r,
        mae_r,
        max_favorable_price,
        max_adverse_price,
        rule_score,
        playbook_id,
        strategy,
        session,
        setup,
        entry_reason,
        exit_reason,
        emotion_before,
        emotion_after,
        mistakes,
        confidence,
        market_condition,
        screenshot_data,
        notes,
        trade_date
      )
VALUES(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
  $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
  $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,
  $32,$33,$34,$35
)
      RETURNING ${fields}
    `,[
  req.user.id,
  acct,
  ac.rows[0].id,
  s,
  d,
  entry,
  stopLoss,
  takeProfit,
  exitPrice,
  quantity,
  calculated.riskAmount,
  calculated.riskPercent,
  calculated.riskLevel,
  calculated.profitLoss,
  calculated.plannedRr,
  calculated.actualR,
  mfeR,
  maeR,
  maxFavorable,
  maxAdverse,
  Math.max(0,Math.min(100,Math.round(n(b.ruleScore)))),
  b.playbookId ? Number(b.playbookId) : null,
  b.strategy || "",
  b.session || "",
  b.setup || "",
  b.entryReason || "",
  b.exitReason || "",
  b.emotionBefore || "",
  b.emotionAfter || "",
  b.mistakes || "",
  Math.max(0,Math.min(100,Math.round(n(b.confidence)))),
  b.marketCondition || "",
  String(b.screenshotData || "").slice(0,4500000),
  b.notes || "",
  b.tradeDate ? new Date(b.tradeDate) : new Date()
]);

    res.status(201).json({
      trade:r.rows[0],
      calculation:calculated
    });

  }catch(e){
    console.error(e);

    res.status(500).json({
      error:"Could not save trade."
    });
  }
});
app.put("/api/trades/:id",auth,async(req,res)=>{
  try{
    const b=req.body;
    const id=Number(req.params.id);

    if(!Number.isInteger(id)||id<=0){
      return res.status(400).json({error:"Invalid trade ID."});
    }

    const existing=await db(
      `
      SELECT *
      FROM trades
      WHERE id=$1 AND user_id=$2
      `,
      [id,req.user.id]
    );

    if(!existing.rowCount){
      return res.status(404).json({error:"Trade not found."});
    }

    const current=existing.rows[0];

    const s=String(
      b.symbol!==undefined ? b.symbol : current.symbol
    ).trim().toUpperCase();

    const d=String(
      b.direction!==undefined ? b.direction : current.direction
    ).toUpperCase();

    const acct=String(
      b.account!==undefined ? b.account : current.account
    ).trim();

    if(!s||!["BUY","SELL"].includes(d)){
      return res.status(400).json({
        error:"Symbol and direction are required."
      });
    }

    /*
     * Batch 1C — same account resolution as POST, but the archived
     * check only fires when the account is actually changing.
     * Comparing the resolved name against current.account means:
     *   - no `account` in the body at all -> acct===current.account
     *     -> editing an already-archived account's trade keeps
     *        working, exactly as before.
     *   - `account` resent with its existing value -> same as above.
     *   - `account` set to a genuinely different name -> only then
     *     must that account be active, so a trade can never be
     *     silently (or explicitly) moved onto an archived account.
     */
    const ac=await db(
      `
      SELECT id,starting_balance,currency,active
      FROM accounts
      WHERE user_id=$1 AND name=$2
      `,
      [req.user.id,acct]
    );

    if(!ac.rowCount){
      return res.status(400).json({
        error:"Selected account does not exist."
      });
    }

    if(acct!==current.account&&ac.rows[0].active===false){
      return res.status(400).json({
        error:"Cannot move this trade to an archived account. Reactivate it first or choose an active account."
      });
    }

    const entry=n(
      b.entry!==undefined ? b.entry : current.entry
    );

    /*
     * NOTE: the frontend (and POST /api/trades) send these as
     * camelCase (stopLoss/takeProfit/exitPrice), matching the
     * existing POST handler's field names. Reading snake_case
     * here meant edits to these fields were silently ignored.
     */
    const stopLoss=
      b.stopLoss===""||b.stopLoss===null
        ? null
        : n(
            b.stopLoss!==undefined ? b.stopLoss : current.stop_loss,
            null
          );

    const takeProfit=
      b.takeProfit===""||b.takeProfit===null
        ? null
        : n(
            b.takeProfit!==undefined ? b.takeProfit : current.take_profit,
            null
          );

    const exitPrice=
      b.exitPrice===""||b.exitPrice===null
        ? null
        : n(
            b.exitPrice!==undefined ? b.exitPrice : current.exit_price,
            null
          );

    const quantity=n(
      b.quantity!==undefined
        ? b.quantity
        : current.quantity,
      1
    );

    const accountCurrency=String(
      ac.rows[0].currency||"USD"
    ).trim().toUpperCase();

    const symbolSpec=getSymbolSpec(s);

    let pnlConversionRate=null;

    if(
      symbolSpec.known &&
      symbolSpec.pnlCurrency &&
      accountCurrency &&
      symbolSpec.pnlCurrency.toUpperCase()!==accountCurrency
    ){
      const conversion=await getCurrencyConversionRate({
        fromCurrency:symbolSpec.pnlCurrency,
        toCurrency:accountCurrency
      });

      pnlConversionRate=conversion.rate;
    }

    const calculated=calculateTrade({
      symbol:s,
      direction:d,
      entry,
      stopLoss,
      takeProfit,
      exitPrice,
      quantity,
      accountBalance:n(
        ac.rows[0].starting_balance,
        0
      ),
      accountCurrency,
      pnlConversionRate
    });

    if(calculated.error){
      return res.status(400).json({
        error:calculated.error,
        calculation:calculated
      });
    }

    const maxFavorable=
      b.maxFavorablePrice===""||
      b.maxFavorablePrice===null
        ? null
        : n(
            b.maxFavorablePrice!==undefined
              ? b.maxFavorablePrice
              : current.max_favorable_price,
            null
          );

    const maxAdverse=
      b.maxAdversePrice===""||
      b.maxAdversePrice===null
        ? null
        : n(
            b.maxAdversePrice!==undefined
              ? b.maxAdversePrice
              : current.max_adverse_price,
            null
          );

    let mfeR=n(
      b.mfeR!==undefined ? b.mfeR : current.mfe_r
    );

    let maeR=n(
      b.maeR!==undefined ? b.maeR : current.mae_r
    );

    /*
     * Same recompute POST /api/trades already performs: if a
     * max favorable/adverse PRICE is known, that price is the
     * source of truth for the R-multiple, not the raw stored R.
     */
    if(
      calculated.riskAmount>0&&
      calculated.entrySlDistance>0
    ){
      if(maxFavorable!==null){
        const favorableDistance=
          d==="BUY"
            ? maxFavorable-entry
            : entry-maxFavorable;

        mfeR=
          favorableDistance/
          calculated.entrySlDistance;
      }

      if(maxAdverse!==null){
        const adverseDistance=
          d==="BUY"
            ? entry-maxAdverse
            : maxAdverse-entry;

        maeR=
          adverseDistance/
          calculated.entrySlDistance;
      }
    }

    const ruleScore=Math.max(
      0,
      Math.min(
        100,
        Math.round(
          n(
            b.ruleScore!==undefined ? b.ruleScore : current.rule_score
          )
        )
      )
    );

    const confidence=Math.max(
      0,
      Math.min(
        100,
        Math.round(
          n(
            b.confidence!==undefined ? b.confidence : current.confidence
          )
        )
      )
    );

    const playbookId=
      b.playbookId!==undefined
        ? (b.playbookId ? Number(b.playbookId) : null)
        : current.playbook_id;

    const strategy=
      b.strategy!==undefined ? (b.strategy||"") : (current.strategy||"");

    const session=
      b.session!==undefined ? (b.session||"") : (current.session||"");

    const setup=
      b.setup!==undefined ? (b.setup||"") : (current.setup||"");

    const entryReason=
      b.entryReason!==undefined
        ? (b.entryReason||"")
        : (current.entry_reason||"");

    const exitReason=
      b.exitReason!==undefined
        ? (b.exitReason||"")
        : (current.exit_reason||"");

    const emotionBefore=
      b.emotionBefore!==undefined
        ? (b.emotionBefore||"")
        : (current.emotion_before||"");

    const emotionAfter=
      b.emotionAfter!==undefined
        ? (b.emotionAfter||"")
        : (current.emotion_after||"");

    const mistakes=
      b.mistakes!==undefined ? (b.mistakes||"") : (current.mistakes||"");

    const marketCondition=
      b.marketCondition!==undefined
        ? (b.marketCondition||"")
        : (current.market_condition||"");

    const screenshotData=
      b.screenshotData!==undefined
        ? String(b.screenshotData||"").slice(0,4500000)
        : (current.screenshot_data||"");

    const notes=
      b.notes!==undefined ? (b.notes||"") : (current.notes||"");

    const tradeDate=
      b.tradeDate!==undefined && b.tradeDate
        ? new Date(b.tradeDate)
        : current.trade_date;

await db(
  `
  UPDATE trades
  SET
    account=$1,
    account_id=$2,
    symbol=$3,
    direction=$4,
    entry=$5,
    stop_loss=$6,
    take_profit=$7,
    exit_price=$8,
    quantity=$9,
    risk_amount=$10,
    risk_percent=$11,
    risk_level=$12,
    profit_loss=$13,
    planned_rr=$14,
    actual_r=$15,
    mfe_r=$16,
    mae_r=$17,
    max_favorable_price=$18,
    max_adverse_price=$19,
    rule_score=$20,
    playbook_id=$21,
    strategy=$22,
    session=$23,
    setup=$24,
    entry_reason=$25,
    exit_reason=$26,
    emotion_before=$27,
    emotion_after=$28,
    mistakes=$29,
    confidence=$30,
    market_condition=$31,
    screenshot_data=$32,
    notes=$33,
    trade_date=$34
  WHERE id=$35 AND user_id=$36
  `,
  [
    acct,
    ac.rows[0].id,
    s,
    d,
    entry,
    stopLoss,
    takeProfit,
    exitPrice,
    quantity,
    calculated.riskAmount,
    calculated.riskPercent,
    calculated.riskLevel,
    calculated.profitLoss,
    calculated.plannedRr,
    calculated.actualR,
    mfeR,
    maeR,
    maxFavorable,
    maxAdverse,
    ruleScore,
    playbookId,
    strategy,
    session,
    setup,
    entryReason,
    exitReason,
    emotionBefore,
    emotionAfter,
    mistakes,
    confidence,
    marketCondition,
    screenshotData,
    notes,
    tradeDate,
    id,
    req.user.id
  ]
);

    res.json({
      success:true,
      calculation:calculated
    });

  }catch(e){
    console.error("Trade update error:",e);
    res.status(500).json({
      error:e.message||"Failed to update trade."
    });
  }
});
app.delete("/api/trades/:id",auth,async(req,res)=>{try{let r=await db("DELETE FROM trades WHERE id=$1 AND user_id=$2",[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Trade not found."});res.json({ok:true})}catch(e){console.error(e);res.status(500).json({error:"Could not delete trade."})}});
app.use("/api/analytics",createAnalyticsRouter({db,auth}));
app.use("/api/calendar",createCalendarRouter({db,auth}));
app.use("/api/premium",createPremiumRouter({db,auth,fields}));

// V5/V6/V7 premium execution, playbooks, simulation and AI routes
app.use("/api/playbooks",createPlaybookRouter({db,auth,n}));
app.use("/api/missed",createMissedRouter({db,auth,n}));
app.use("/api/execution",createExecutionRouter({db,auth}));
app.use("/api/replay",createReplayRouter({db,auth,fields}));
app.use(createSimulationRouter({db,auth,n}));
app.use("/api/ai",createAiCoachRouter({db,auth}));
app.use("/api/import",createImportRouter({db,auth,n}));
app.use("/api",createExportRouter({db,auth,fields}));
app.use("/api/admin",createAdminRouter({db,auth}));
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
init({db}).then(()=>app.listen(PORT,"0.0.0.0",()=>console.log("GhostTrader V2 running on "+PORT))).catch(e=>{console.error(e);process.exit(1)});
