require("dotenv").config();
const express=require("express"),path=require("path"),cookieParser=require("cookie-parser"),bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),{Pool}=require("pg");
const {createMarketDataRouter}=require("./market-data/market-data-routes");
const {createMarketDataProviderRouter}=require("./market-data/market-data-provider-routes");
const {calculateTrade}=require("./utils/trade-calculator");
const {getSymbolSpec}=require("./utils/symbol-specs");
const {getCurrencyConversionRate}=require("./market-data/twelve-data");
const {createTradeLockerRouter}=require("./tradelocker/tradelocker-routes");
const {createMT5Router}=require("./mt5/mt5-routes");
const app=express(),PORT=process.env.PORT||10000,SECRET=process.env.JWT_SECRET||"dev-only-change-me";
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL&&!process.env.DATABASE_URL.includes("localhost")?{rejectUnauthorized:false}:false});
app.use(express.json({limit:"5mb"}));app.use(cookieParser());app.use(express.static(path.join(__dirname,"public")));
const db=(q,p=[])=>pool.query(q,p);
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
function auth(req,res,next){const t=req.cookies.gt_token;if(!t)return res.status(401).json({error:"Not authenticated"});try{req.user=jwt.verify(t,SECRET);next()}catch{return res.status(401).json({error:"Session expired"})}}

app.use("/api/market-data",createMarketDataRouter({db,auth}));
app.use("/api/market-data",createMarketDataProviderRouter({db,auth}));
app.use("/api/tradelocker",createTradeLockerRouter({db,auth}));
app.use("/api/mt5",createMT5Router({db,auth}));
async function init(){
 await db(`CREATE TABLE IF NOT EXISTS market_symbols(
 id SERIAL PRIMARY KEY,
 symbol VARCHAR(50) NOT NULL UNIQUE,
 display_name VARCHAR(120),
 asset_class VARCHAR(30) NOT NULL DEFAULT 'forex',
 base_asset VARCHAR(20),
 quote_asset VARCHAR(20),
 exchange VARCHAR(80),
 broker_symbol VARCHAR(80),
 price_decimals INTEGER NOT NULL DEFAULT 5,
 quantity_decimals INTEGER NOT NULL DEFAULT 2,
 tick_size NUMERIC(30,12),
 contract_size NUMERIC(30,12),
 active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );

 CREATE TABLE IF NOT EXISTS market_timeframes(
 id SERIAL PRIMARY KEY,
 code VARCHAR(20) NOT NULL UNIQUE,
 seconds INTEGER NOT NULL UNIQUE CHECK(seconds>0),
 display_name VARCHAR(50) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );

 CREATE TABLE IF NOT EXISTS market_candles(
 id BIGSERIAL PRIMARY KEY,
 symbol VARCHAR(50) NOT NULL,
 timeframe VARCHAR(20) NOT NULL,
 candle_time TIMESTAMPTZ NOT NULL,
 open NUMERIC(30,12) NOT NULL,
 high NUMERIC(30,12) NOT NULL,
 low NUMERIC(30,12) NOT NULL,
 close NUMERIC(30,12) NOT NULL,
 volume NUMERIC(30,12),
 tick_volume BIGINT,
 spread NUMERIC(30,12),
 source VARCHAR(80) NOT NULL DEFAULT 'unknown',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT market_candles_ohlc_valid CHECK(
 high>=low AND high>=open AND high>=close
 AND low<=open AND low<=close
 ),
 CONSTRAINT market_candles_unique UNIQUE(symbol,timeframe,candle_time)
 );

 CREATE TABLE IF NOT EXISTS market_data_imports(
 id BIGSERIAL PRIMARY KEY,
 symbol VARCHAR(50) NOT NULL,
 timeframe VARCHAR(20) NOT NULL,
 source VARCHAR(80) NOT NULL,
 requested_from TIMESTAMPTZ,
 requested_to TIMESTAMPTZ,
 rows_received INTEGER NOT NULL DEFAULT 0,
 rows_inserted INTEGER NOT NULL DEFAULT 0,
 rows_skipped INTEGER NOT NULL DEFAULT 0,
 status VARCHAR(30) NOT NULL DEFAULT 'pending',
 error_message TEXT,
 started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );

 CREATE INDEX IF NOT EXISTS idx_market_candles_lookup
 ON market_candles(symbol,timeframe,candle_time);

 CREATE INDEX IF NOT EXISTS idx_market_candles_time
 ON market_candles(candle_time);

 CREATE INDEX IF NOT EXISTS idx_market_candles_source
 ON market_candles(source);

 CREATE INDEX IF NOT EXISTS idx_market_imports_lookup
 ON market_data_imports(symbol,timeframe,created_at DESC);

 INSERT INTO market_timeframes(code,seconds,display_name) VALUES
 ('1m',60,'1 Minute'),
 ('5m',300,'5 Minutes'),
 ('15m',900,'15 Minutes'),
 ('30m',1800,'30 Minutes'),
 ('1h',3600,'1 Hour'),
 ('4h',14400,'4 Hours'),
 ('1d',86400,'1 Day')
 ON CONFLICT(code) DO NOTHING;

 INSERT INTO market_symbols
 (symbol,display_name,asset_class,base_asset,quote_asset,price_decimals)
 VALUES
 ('XAUUSD','Gold / US Dollar','metals','XAU','USD',2),
 ('EURUSD','Euro / US Dollar','forex','EUR','USD',5),
 ('GBPUSD','British Pound / US Dollar','forex','GBP','USD',5),
 ('USDJPY','US Dollar / Japanese Yen','forex','USD','JPY',3),
 ('AUDUSD','Australian Dollar / US Dollar','forex','AUD','USD',5),
 ('USDCAD','US Dollar / Canadian Dollar','forex','USD','CAD',5),
 ('USDCHF','US Dollar / Swiss Franc','forex','USD','CHF',5),
 ('BTCUSD','Bitcoin / US Dollar','crypto','BTC','USD',2),
 ('ETHUSD','Ethereum / US Dollar','crypto','ETH','USD',2)
 ON CONFLICT(symbol) DO NOTHING`);
  await db(`
  UPDATE market_symbols
  SET contract_size=100,
      updated_at=NOW()
  WHERE symbol='XAUUSD'
    AND (contract_size IS NULL OR contract_size=0)
 `);
 await db(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,name VARCHAR(80) NOT NULL,email VARCHAR(255) UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS accounts(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,name VARCHAR(100) NOT NULL,starting_balance NUMERIC(20,2) DEFAULT 0,currency VARCHAR(10) DEFAULT 'USD',created_at TIMESTAMPTZ DEFAULT NOW(),UNIQUE(user_id,name));
 CREATE TABLE IF NOT EXISTS trades(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,account VARCHAR(100) DEFAULT 'Main Account',symbol VARCHAR(30) NOT NULL,direction VARCHAR(10) NOT NULL CHECK(direction IN('BUY','SELL')),entry NUMERIC(20,8) NOT NULL,stop_loss NUMERIC(20,8),take_profit NUMERIC(20,8),exit_price NUMERIC(20,8),quantity NUMERIC(20,8) DEFAULT 1,risk_amount NUMERIC(20,2) DEFAULT 0,profit_loss NUMERIC(20,2) DEFAULT 0,strategy VARCHAR(100),session VARCHAR(40),notes TEXT,trade_date TIMESTAMPTZ DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW());`);
 const cols=[   ["risk_percent","NUMERIC(10,4) DEFAULT 0"],   ["risk_level","VARCHAR(20) DEFAULT 'UNKNOWN'"],   ["planned_rr","NUMERIC(10,4) DEFAULT 0"],   ["actual_r","NUMERIC(10,4) DEFAULT 0"],   ["setup","VARCHAR(120)"],   ["entry_reason","TEXT"],   ["exit_reason","TEXT"],   ["emotion_before","VARCHAR(50)"],   ["emotion_after","VARCHAR(50)"],   ["mistakes","TEXT"],   ["confidence","INTEGER DEFAULT 0"],   ["market_condition","VARCHAR(80)"],   ["screenshot_data","TEXT"],   ["mfe_r","NUMERIC(10,4) DEFAULT 0"],   ["mae_r","NUMERIC(10,4) DEFAULT 0"],   ["max_favorable_price","NUMERIC(20,8)"],   ["max_adverse_price","NUMERIC(20,8)"],   ["rule_score","INTEGER DEFAULT 0"],   ["playbook_id","INTEGER"] ];
for(const [a,b] of cols)await db(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS ${a} ${b}`);
 await db(`
  ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'manual'
`);

await db(`
  ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS external_trade_id VARCHAR(128)
`);

await db(`
  ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS external_position_id VARCHAR(128)
`);

await db(`
  ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS external_account_id VARCHAR(64)
`);

await db(`
  ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS external_imported_at TIMESTAMPTZ
`);

await db(`
  CREATE UNIQUE INDEX IF NOT EXISTS uq_trades_tradelocker_position
  ON trades(user_id, external_account_id, external_position_id)
  WHERE source = 'tradelocker'
    AND external_position_id IS NOT NULL
`);
 await db(`CREATE TABLE IF NOT EXISTS playbooks(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,name VARCHAR(120) NOT NULL,description TEXT DEFAULT '',strategy VARCHAR(120) DEFAULT '',risk_limit NUMERIC(10,4) DEFAULT 1,active BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS playbook_rules(id SERIAL PRIMARY KEY,playbook_id INTEGER REFERENCES playbooks(id) ON DELETE CASCADE,label VARCHAR(180) NOT NULL,weight INTEGER DEFAULT 1,required BOOLEAN DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS missed_trades(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,account VARCHAR(100),symbol VARCHAR(30) NOT NULL,direction VARCHAR(10),trade_date TIMESTAMPTZ DEFAULT NOW(),setup VARCHAR(120),reason VARCHAR(120),potential_r NUMERIC(10,4) DEFAULT 0,potential_pnl NUMERIC(20,2) DEFAULT 0,notes TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS replay_sessions(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,name VARCHAR(120) NOT NULL,symbol VARCHAR(30),starting_balance NUMERIC(20,2) DEFAULT 10000,status VARCHAR(30) DEFAULT 'draft',created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS replay_trades(id SERIAL PRIMARY KEY,session_id INTEGER REFERENCES replay_sessions(id) ON DELETE CASCADE,symbol VARCHAR(30),direction VARCHAR(10),entry NUMERIC(20,8),stop_loss NUMERIC(20,8),take_profit NUMERIC(20,8),exit_price NUMERIC(20,8),quantity NUMERIC(20,8) DEFAULT 1,profit_loss NUMERIC(20,2) DEFAULT 0,trade_date TIMESTAMPTZ DEFAULT NOW(),notes TEXT);
 CREATE TABLE IF NOT EXISTS backtests(id SERIAL PRIMARY KEY,user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,name VARCHAR(120) NOT NULL,symbol VARCHAR(30),target_r NUMERIC(10,4) DEFAULT 2,stop_r NUMERIC(10,4) DEFAULT 1,created_at TIMESTAMPTZ DEFAULT NOW());`);
 await db(`INSERT INTO accounts(user_id,name) SELECT id,'Main Account' FROM users u WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.user_id=u.id AND a.name='Main Account')`);
 await db(`
  CREATE TABLE IF NOT EXISTS tradelocker_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    environment VARCHAR(16) NOT NULL,
    server VARCHAR(128) NOT NULL,
    account_id VARCHAR(64),
    acc_num INTEGER,
    account_name VARCHAR(128),
    currency VARCHAR(16),
    status VARCHAR(32),
    last_error TEXT,
    last_connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_tradelocker_connections_user UNIQUE (user_id)
  )
`);
await db(`
  ALTER TABLE tradelocker_connections
  ADD COLUMN IF NOT EXISTS refresh_token TEXT
`);

await db(`
  ALTER TABLE tradelocker_connections
  ADD COLUMN IF NOT EXISTS email VARCHAR(255)
`);

await db(`
  ALTER TABLE tradelocker_connections
  ADD COLUMN IF NOT EXISTS selected_account_id VARCHAR(64)
`);

await db(`
  ALTER TABLE tradelocker_connections
  ADD COLUMN IF NOT EXISTS selected_acc_num INTEGER
`);

await db(`
  ALTER TABLE tradelocker_connections
  ADD COLUMN IF NOT EXISTS selected_account_name VARCHAR(128)
`);

await db(`
  ALTER TABLE tradelocker_connections
  ADD COLUMN IF NOT EXISTS token_updated_at TIMESTAMPTZ
`);
await db(`
  CREATE INDEX IF NOT EXISTS idx_tradelocker_connections_user_id
  ON tradelocker_connections(user_id)
`);

await db(`
  CREATE TABLE IF NOT EXISTS mt5_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    broker VARCHAR(128),
    server VARCHAR(128) NOT NULL,
    account_login VARCHAR(64) NOT NULL,

    account_name VARCHAR(128),
    currency VARCHAR(16),

    status VARCHAR(32) DEFAULT 'disconnected',
    last_error TEXT,

    last_connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_mt5_connections_user
      UNIQUE (user_id)
  )
`);

await db(`
  CREATE INDEX IF NOT EXISTS idx_mt5_connections_user_id
  ON mt5_connections(user_id)
`);
 }
function token(u){return jwt.sign({id:u.id,name:u.name,email:u.email},SECRET,{expiresIn:"7d"})}
const setCookie=(res,t)=>res.cookie("gt_token",t,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:604800000});
app.post("/api/auth/register",async(req,res)=>{try{let name=String(req.body.name||"").trim(),email=String(req.body.email||"").trim().toLowerCase(),pw=String(req.body.password||"");if(name.length<2||!email.includes("@")||pw.length<6)return res.status(400).json({error:"Name, valid email and 6+ character password required."});if((await db("SELECT id FROM users WHERE email=$1",[email])).rowCount)return res.status(409).json({error:"Email already registered."});let r=await db("INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email",[name,email,await bcrypt.hash(pw,12)]);await db("INSERT INTO accounts(user_id,name) VALUES($1,'Main Account')",[r.rows[0].id]);setCookie(res,token(r.rows[0]));res.json({user:r.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Registration failed."})}});
app.post("/api/auth/login",async(req,res)=>{try{let email=String(req.body.email||"").trim().toLowerCase(),pw=String(req.body.password||""),r=await db("SELECT * FROM users WHERE email=$1",[email]);if(!r.rowCount||!(await bcrypt.compare(pw,r.rows[0].password_hash)))return res.status(401).json({error:"Invalid email or password."});let u={id:r.rows[0].id,name:r.rows[0].name,email:r.rows[0].email};setCookie(res,token(u));res.json({user:u})}catch(e){res.status(500).json({error:"Login failed."})}});
app.post("/api/auth/logout",(req,res)=>{res.clearCookie("gt_token");res.json({ok:true})});app.get("/api/auth/me",auth,(req,res)=>res.json({user:req.user}));
app.get("/api/accounts",auth,async(req,res)=>{let r=await db(`SELECT a.*,COALESCE(SUM(t.profit_loss),0) pnl FROM accounts a LEFT JOIN trades t ON t.user_id=a.user_id AND t.account=a.name WHERE a.user_id=$1 GROUP BY a.id ORDER BY a.created_at`,[req.user.id]);res.json({accounts:r.rows})});
app.post("/api/accounts",auth,async(req,res)=>{try{let name=String(req.body.name||"").trim(),currency=String(req.body.currency||"USD").trim().toUpperCase();if(name.length<2||name.length>100)return res.status(400).json({error:"Account name must be 2-100 characters."});if(!/^[A-Z]{3,10}$/.test(currency))return res.status(400).json({error:"Currency must be 3-10 letters."});let r=await db("INSERT INTO accounts(user_id,name,starting_balance,currency) VALUES($1,$2,$3,$4) RETURNING *",[req.user.id,name,n(req.body.startingBalance),currency]);res.status(201).json({account:r.rows[0]})}catch(e){console.error(e);res.status(400).json({error:e.code==="23505"?"That account already exists.":"Could not create account."})}});
app.put("/api/accounts/:id",auth,async(req,res)=>{
  try{
    const id=Number(req.params.id);
    const startingBalance=Number(req.body.startingBalance);

    if(!Number.isInteger(id)||id<=0){
      return res.status(400).json({error:"Invalid account."});
    }

    if(!Number.isFinite(startingBalance)||startingBalance<0){
      return res.status(400).json({error:"Starting balance must be a valid non-negative number."});
    }

    const r=await db(
      `
      UPDATE accounts
      SET starting_balance=$1
      WHERE id=$2 AND user_id=$3
      RETURNING *
      `,
      [startingBalance,id,req.user.id]
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
const fields="id,account,symbol,direction,entry,stop_loss,take_profit,exit_price,quantity,risk_amount,risk_percent,risk_level,profit_loss,planned_rr,actual_r,mfe_r,mae_r,max_favorable_price,max_adverse_price,rule_score,playbook_id,strategy,session,setup,entry_reason,exit_reason,emotion_before,emotion_after,mistakes,confidence,market_condition,screenshot_data,notes,trade_date";
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
  let r=await db(`SELECT ${fields} FROM trades WHERE ${w.join(" AND ")} ORDER BY trade_date DESC,id DESC LIMIT 1000`,v);
  res.json({trades:r.rows});
}catch(e){console.error(e);res.status(500).json({error:"Could not load trades."})}});
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

const ac=await db(
  "SELECT starting_balance,currency FROM accounts WHERE user_id=$1 AND name=$2",
  [req.user.id,acct]
);

    if(!ac.rowCount){
      return res.status(400).json({
        error:"Selected account does not exist."
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
if(calculated.error){
  return res.status(400).json({
    error: calculated.error,
    calculationStatus: calculated.calculationStatus || "INVALID"
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
  $32,$33,$34
)
      RETURNING ${fields}
    `,[
  req.user.id,
  acct,
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

    const ac=await db(
      `
      SELECT starting_balance,currency
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

    const entry=n(
      b.entry!==undefined ? b.entry : current.entry
    );

    const stopLoss=n(
      b.stop_loss!==undefined
        ? b.stop_loss
        : current.stop_loss
    );

    const takeProfit=n(
      b.take_profit!==undefined
        ? b.take_profit
        : current.take_profit
    );

    const exitPrice=n(
      b.exit_price!==undefined
        ? b.exit_price
        : current.exit_price
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

await db(
  `
  UPDATE trades
  SET
    account=$1,
    symbol=$2,
    direction=$3,
    entry=$4,
    stop_loss=$5,
    take_profit=$6,
    exit_price=$7,
    quantity=$8,
    risk_amount=$9,
    risk_percent=$10,
    risk_level=$11,
    profit_loss=$12,
    planned_rr=$13,
    actual_r=$14
  WHERE id=$15 AND user_id=$16
  `,
  [
    acct,
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
app.get("/api/analytics",auth,async(req,res)=>{try{
  const tz=String(req.query.tz||"UTC");
  const account=String(req.query.account||"").trim();
  const from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from||""))?String(req.query.from):"";
  const to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to||""))?String(req.query.to):"";
  const v=[req.user.id],w=["user_id=$1"];
  if(account){v.push(account);w.push(`account=$${v.length}`)}
  if(from){v.push(from);w.push(`trade_date >= $${v.length}::date::timestamp`)}
  if(to){v.push(to);w.push(`trade_date < ($${v.length}::date + INTERVAL '1 day')`)}
  const where=w.join(" AND ");
  const baseParams=[...v];
  const summary=await db(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE profit_loss>0)::int wins,COUNT(*) FILTER(WHERE profit_loss<0)::int losses,COALESCE(SUM(profit_loss),0)::numeric pnl,COALESCE(SUM(profit_loss) FILTER(WHERE profit_loss>0),0)::numeric gp,ABS(COALESCE(SUM(profit_loss) FILTER(WHERE profit_loss<0),0))::numeric gl,COALESCE(AVG(actual_r),0)::numeric avgr,COALESCE(AVG(profit_loss) FILTER(WHERE profit_loss>0),0)::numeric aw,COALESCE(AVG(profit_loss) FILTER(WHERE profit_loss<0),0)::numeric al,COALESCE(AVG(risk_percent),0)::numeric ar FROM trades WHERE ${where}` ,baseParams);
  const s=summary.rows[0],t=Number(s.total),wins=Number(s.wins),losses=Number(s.losses),gl=Number(s.gl),gp=Number(s.gp),al=Math.abs(Number(s.al)),aw=Number(s.aw),exp=t?wins/t*aw-losses/t*al:0;
  const balanceQuery=account?await db("SELECT COALESCE(starting_balance,0)::numeric starting_balance FROM accounts WHERE user_id=$1 AND name=$2",[req.user.id,account]):await db("SELECT COALESCE(SUM(starting_balance),0)::numeric starting_balance FROM accounts WHERE user_id=$1",[req.user.id]);
  const startingBalance=Number(balanceQuery.rows[0]?.starting_balance||0);
  const make=(sql,extra=[])=>db(sql,[...baseParams,...extra]);
  const idx=v.length;
  const [sym,strat,sess,dir,days,curve]=await Promise.all([
    make(`SELECT symbol,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY symbol ORDER BY pnl DESC`),
    make(`SELECT COALESCE(strategy,'Unspecified') strategy,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY strategy ORDER BY pnl DESC`),
    make(`SELECT COALESCE(session,'Unspecified') session,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY session ORDER BY pnl DESC`),
    make(`SELECT direction,COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl FROM trades WHERE ${where} GROUP BY direction ORDER BY direction`),
    make(`SELECT timezone($${idx+1},trade_date)::date AS day,COALESCE(SUM(profit_loss),0)::numeric AS pnl,COUNT(*)::int AS trades FROM trades WHERE ${where} GROUP BY timezone($${idx+1},trade_date)::date ORDER BY day`,[tz]),
    make(`SELECT profit_loss,trade_date FROM trades WHERE ${where} ORDER BY trade_date,id`)
  ]);
  let eq=0,peak=0,dd=0,ws=0,ls=0,bw=0,bl=0;
  curve.rows.forEach(x=>{const p=Number(x.profit_loss);eq+=p;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);if(p>0){ws++;ls=0;bw=Math.max(bw,ws)}else if(p<0){ls++;ws=0;bl=Math.max(bl,ls)}});
  res.json({summary:{total:t,wins,losses,pnl:Number(s.pnl),startingBalance,currentEquity:startingBalance+Number(s.pnl),winRate:t?wins/t*100:0,profitFactor:gl?gp/gl:(gp?Infinity:0),avgWin:aw,avgLoss:al,avgR:Number(s.avgr),avgRisk:Number(s.ar),expectancy:exp,maxDrawdown:Math.abs(dd),bestWinStreak:bw,bestLossStreak:bl},bySymbol:sym.rows,byStrategy:strat.rows,bySession:sess.rows,byDirection:dir.rows,byDay:days.rows});
}catch(e){console.error(e);res.status(500).json({error:"Analytics failed."})}});
app.get("/api/calendar",auth,async(req,res)=>{try{
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
app.get("/api/premium",auth,async(req,res)=>{try{
  const account=String(req.query.account||"").trim();
  const range=String(req.query.range||"all");
  const v=[req.user.id],w=["user_id=$1"];
  if(account){v.push(account);w.push(`account=$${v.length}`)}
  const now=new Date();
  if(range!=="all"){
    const from=new Date(now);
    if(range==="month")from.setMonth(from.getMonth(),1);
    else if(range==="3m")from.setMonth(from.getMonth()-2,1);
    else if(range==="6m")from.setMonth(from.getMonth()-5,1);
    else from.setFullYear(from.getFullYear()-1);
    const iso=from.toISOString().slice(0,10);
    v.push(iso);w.push(`trade_date >= $${v.length}::date`);
  }
  const r=await db(`SELECT ${fields} FROM trades WHERE ${w.join(" AND ")} ORDER BY trade_date ASC,id ASC LIMIT 5000`,v);
  const rows=r.rows.map(x=>({...x,pnl:Number(x.profit_loss||0),r:Number(x.actual_r||0),risk:Number(x.risk_percent||0),conf:Number(x.confidence||0)}));
  const groupBy=(keyFn)=>{const m=new Map();for(const x of rows){const k=String(keyFn(x)||"Unspecified");if(!m.has(k))m.set(k,[]);m.get(k).push(x)}return [...m].map(([name,a])=>{const wins=a.filter(x=>x.pnl>0).length,pnl=a.reduce((z,x)=>z+x.pnl,0),grossWin=a.filter(x=>x.pnl>0).reduce((z,x)=>z+x.pnl,0),grossLoss=Math.abs(a.filter(x=>x.pnl<0).reduce((z,x)=>z+x.pnl,0));return{name,trades:a.length,pnl,winRate:a.length?wins/a.length*100:0,profitFactor:grossLoss?grossWin/grossLoss:(grossWin?Infinity:0),avgR:a.length?a.reduce((z,x)=>z+x.r,0)/a.length:0}})};
  const edge=(arr)=>arr.filter(x=>x.trades>=3).sort((a,b)=>b.pnl-a.pnl);
  const symbols=edge(groupBy(x=>x.symbol)),strategies=edge(groupBy(x=>x.strategy)),setups=edge(groupBy(x=>x.setup)),sessions=edge(groupBy(x=>x.session)),markets=edge(groupBy(x=>x.market_condition));
  const emotions=edge(groupBy(x=>x.emotion_before)),confidence=[
    {name:"High (80–100)",min:80,max:100},{name:"Medium (50–79)",min:50,max:79},{name:"Low (0–49)",min:0,max:49}
  ].map(g=>{const a=rows.filter(x=>x.conf>=g.min&&x.conf<=g.max);const wins=a.filter(x=>x.pnl>0).length;return{...g,trades:a.length,pnl:a.reduce((z,x)=>z+x.pnl,0),winRate:a.length?wins/a.length*100:0,avgR:a.length?a.reduce((z,x)=>z+x.r,0)/a.length:0}}).filter(x=>x.trades);
  const avgRisk=rows.length?rows.reduce((z,x)=>z+x.risk,0)/rows.length:0;
  const riskOutliers=avgRisk?rows.filter(x=>x.risk>avgRisk*1.5).length:0;
  let cur=0,peak=0,maxDD=0,lossStreak=0,bestLossStreak=0,winStreak=0,bestWinStreak=0;
  for(const x of rows){cur+=x.pnl;if(cur>peak)peak=cur;maxDD=Math.min(maxDD,cur-peak);if(x.pnl<0){lossStreak++;winStreak=0;bestLossStreak=Math.max(bestLossStreak,lossStreak)}else if(x.pnl>0){winStreak++;lossStreak=0;bestWinStreak=Math.max(bestWinStreak,winStreak)}}
  const processFlags=rows.map(x=>({id:x.id,symbol:x.symbol,pnl:x.pnl,date:x.trade_date,reasons:[x.risk>avgRisk*1.5&&avgRisk>0?"Risk above your average":null,!x.stop_loss?"No stop loss recorded":null,!x.take_profit?"No take profit recorded":null,x.conf>0&&x.conf<40?"Low confidence":null,x.mistakes?"Mistake logged":null].filter(Boolean)})).filter(x=>x.reasons.length);
  const coach=[];
  if(rows.length){
    const best=[...symbols,...strategies,...setups].filter(x=>x.trades>=5).sort((a,b)=>b.pnl-a.pnl)[0];
    const worst=[...symbols,...strategies,...setups].filter(x=>x.trades>=5).sort((a,b)=>a.pnl-b.pnl)[0];
    if(best)coach.push({type:"EDGE",title:`Your strongest edge is ${best.name}`,body:`${best.trades} trades · ${best.winRate.toFixed(1)}% win rate · ${best.pnl>=0?"+":""}${best.pnl.toFixed(2)} P&L.`});
    if(worst&&worst.pnl<0)coach.push({type:"LEAK",title:`Your biggest performance leak is ${worst.name}`,body:`${worst.trades} trades · ${worst.winRate.toFixed(1)}% win rate · ${worst.pnl.toFixed(2)} P&L.`});
    if(riskOutliers)coach.push({type:"RISK",title:`${riskOutliers} trades were risk outliers`,body:`They used more than 1.5× your average recorded risk. Review these before increasing size.`});
    if(bestLossStreak>=3)coach.push({type:"DISCIPLINE",title:`Your worst losing streak is ${bestLossStreak}`,body:`Consider a hard daily stop or cooldown rule after consecutive losses.`});
    if(processFlags.length)coach.push({type:"PROCESS",title:`${processFlags.length} trades have process flags`,body:`Use the Process Review below to clean up missing protection, low-confidence entries, and mistakes.`});
  }
  const monday=new Date(now);const day=monday.getDay();const diff=(day+6)%7;monday.setDate(monday.getDate()-diff);monday.setHours(0,0,0,0);const weekRows=rows.filter(x=>new Date(x.trade_date)>=monday);const prevStart=new Date(monday);prevStart.setDate(prevStart.getDate()-7);const prevRows=rows.filter(x=>{const d=new Date(x.trade_date);return d>=prevStart&&d<monday});
  const stats=a=>{const pnl=a.reduce((z,x)=>z+x.pnl,0),wins=a.filter(x=>x.pnl>0).length;return{trades:a.length,pnl,winRate:a.length?wins/a.length*100:0,avgR:a.length?a.reduce((z,x)=>z+x.r,0)/a.length:0}};
  res.json({edge:{symbols,strategies,setups,sessions,markets},psychology:{emotions,confidence},risk:{avgRisk,maxDrawdown:Math.abs(maxDD),riskOutliers,bestLossStreak,bestWinStreak},processFlags:processFlags.slice(-30).reverse(),coach,weekly:{current:stats(weekRows),previous:stats(prevRows)}});
}catch(e){console.error(e);res.status(500).json({error:"Premium analytics failed."})}});

// V5/V6/V7 premium execution, playbooks, simulation and AI routes
app.get("/api/playbooks",auth,async(req,res)=>{try{const p=await db("SELECT * FROM playbooks WHERE user_id=$1 ORDER BY created_at DESC",[req.user.id]);const r=await db("SELECT r.* FROM playbook_rules r JOIN playbooks p ON p.id=r.playbook_id WHERE p.user_id=$1 ORDER BY r.playbook_id,r.id",[req.user.id]);res.json({playbooks:p.rows,rules:r.rows})}catch(e){console.error(e);res.status(500).json({error:"Could not load playbooks."})}});
app.post("/api/playbooks",auth,async(req,res)=>{try{const name=String(req.body.name||"").trim();if(name.length<2)return res.status(400).json({error:"Playbook name is required."});const p=await db("INSERT INTO playbooks(user_id,name,description,strategy,risk_limit) VALUES($1,$2,$3,$4,$5) RETURNING *",[req.user.id,name,String(req.body.description||""),String(req.body.strategy||""),n(req.body.riskLimit,1)]);const rules=Array.isArray(req.body.rules)?req.body.rules:[];for(const x of rules){const label=String(x.label||"").trim();if(label)await db("INSERT INTO playbook_rules(playbook_id,label,weight,required) VALUES($1,$2,$3,$4)",[p.rows[0].id,label,Math.max(1,Math.round(n(x.weight,1))),x.required!==false])}res.status(201).json({playbook:p.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not create playbook."})}});
app.put("/api/playbooks/:id",auth,async(req,res)=>{try{const id=Number(req.params.id);const p=await db("UPDATE playbooks SET name=$1,description=$2,strategy=$3,risk_limit=$4,active=$5 WHERE id=$6 AND user_id=$7 RETURNING *",[String(req.body.name||"").trim(),String(req.body.description||""),String(req.body.strategy||""),n(req.body.riskLimit,1),req.body.active!==false,id,req.user.id]);if(!p.rowCount)return res.status(404).json({error:"Playbook not found."});await db("DELETE FROM playbook_rules WHERE playbook_id=$1",[id]);for(const x of (Array.isArray(req.body.rules)?req.body.rules:[])){const label=String(x.label||"").trim();if(label)await db("INSERT INTO playbook_rules(playbook_id,label,weight,required) VALUES($1,$2,$3,$4)",[id,label,Math.max(1,Math.round(n(x.weight,1))),x.required!==false])}res.json({playbook:p.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not update playbook."})}});
app.delete("/api/playbooks/:id",auth,async(req,res)=>{try{const r=await db("DELETE FROM playbooks WHERE id=$1 AND user_id=$2",[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Playbook not found."});res.json({ok:true})}catch(e){console.error(e);res.status(500).json({error:"Could not delete playbook."})}});
app.get("/api/missed",auth,async(req,res)=>{try{const r=await db("SELECT * FROM missed_trades WHERE user_id=$1 ORDER BY trade_date DESC,id DESC LIMIT 500",[req.user.id]);res.json({missed:r.rows})}catch(e){res.status(500).json({error:"Could not load missed trades."})}});
app.post("/api/missed",auth,async(req,res)=>{try{const r=await db("INSERT INTO missed_trades(user_id,account,symbol,direction,trade_date,setup,reason,potential_r,potential_pnl,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",[req.user.id,String(req.body.account||""),String(req.body.symbol||"").trim().toUpperCase(),String(req.body.direction||""),req.body.tradeDate?new Date(req.body.tradeDate):new Date(),String(req.body.setup||""),String(req.body.reason||""),n(req.body.potentialR),n(req.body.potentialPnl),String(req.body.notes||"")]);res.status(201).json({missed:r.rows[0]})}catch(e){console.error(e);res.status(500).json({error:"Could not save missed trade."})}});
app.delete("/api/missed/:id",auth,async(req,res)=>{try{const r=await db("DELETE FROM missed_trades WHERE id=$1 AND user_id=$2",[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Missed trade not found."});res.json({ok:true})}catch(e){res.status(500).json({error:"Could not delete missed trade."})}});
app.get("/api/execution",auth,async(req,res)=>{try{let w=["user_id=$1"],v=[req.user.id];if(req.query.account){v.push(String(req.query.account));w.push(`account=$${v.length}`)}const r=await db(`SELECT symbol,COUNT(*)::int trades,COALESCE(AVG(mfe_r),0)::numeric avg_mfe,COALESCE(AVG(mae_r),0)::numeric avg_mae,COALESCE(AVG(actual_r),0)::numeric avg_r,COALESCE(AVG(CASE WHEN mfe_r>0 THEN actual_r/NULLIF(mfe_r,0) END),0)::numeric exit_efficiency,COALESCE(AVG(rule_score),0)::numeric rule_score FROM trades WHERE ${w.join(" AND ")} GROUP BY symbol ORDER BY avg_r DESC`,v);const overall=await db(`SELECT COUNT(*)::int trades,COALESCE(AVG(mfe_r),0)::numeric avg_mfe,COALESCE(AVG(mae_r),0)::numeric avg_mae,COALESCE(AVG(actual_r),0)::numeric avg_r,COALESCE(AVG(CASE WHEN mfe_r>0 THEN actual_r/NULLIF(mfe_r,0) END),0)::numeric exit_efficiency,COALESCE(AVG(rule_score),0)::numeric rule_score FROM trades WHERE ${w.join(" AND ")}`,v);res.json({overall:overall.rows[0],bySymbol:r.rows})}catch(e){console.error(e);res.status(500).json({error:"Execution analytics failed."})}});
app.get("/api/replay/:id",auth,async(req,res)=>{try{const r=await db(`SELECT ${fields} FROM trades WHERE id=$1 AND user_id=$2`,[Number(req.params.id),req.user.id]);if(!r.rowCount)return res.status(404).json({error:"Trade not found."});res.json({trade:r.rows[0]})}catch(e){res.status(500).json({error:"Replay load failed."})}});
app.post("/api/simulate",auth,async(req,res)=>{try{let w=["user_id=$1"],v=[req.user.id];if(req.body.account){v.push(String(req.body.account));w.push(`account=$${v.length}`)}if(req.body.symbol){v.push(String(req.body.symbol).trim().toUpperCase());w.push(`symbol=$${v.length}`)}const rows=(await db(`SELECT actual_r,mfe_r,mae_r,profit_loss,risk_amount FROM trades WHERE ${w.join(" AND ")} ORDER BY trade_date`,v)).rows;const target=n(req.body.targetR,2),stop=-Math.abs(n(req.body.stopR,1));let pnlR=0,wins=0,losses=0,usable=0;for(const x of rows){const mfe=n(x.mfe_r),mae=n(x.mae_r);if(!mfe&&!mae)continue;usable++;let rr=n(x.actual_r);if(mfe>=target)rr=target;else if(mae<=stop)rr=stop;wins+=rr>0?1:0;losses+=rr<0?1:0;pnlR+=rr}res.json({trades:rows.length,usable,wins,losses,targetR:target,stopR:stop,simulatedR:pnlR,winRate:usable?wins/usable*100:0,avgR:usable?pnlR/usable:0})}catch(e){console.error(e);res.status(500).json({error:"Simulation failed."})}});
app.post("/api/backtests",auth,async(req,res)=>{try{const r=await db("INSERT INTO backtests(user_id,name,symbol,target_r,stop_r) VALUES($1,$2,$3,$4,$5) RETURNING *",[req.user.id,String(req.body.name||"Scenario"),String(req.body.symbol||""),n(req.body.targetR,2),Math.abs(n(req.body.stopR,1))]);res.status(201).json({backtest:r.rows[0]})}catch(e){res.status(500).json({error:"Could not save simulation."})}});
app.post("/api/ai/coach",auth,async(req,res)=>{try{const q=String(req.body.question||"").trim()||"Review my trading performance and tell me what to improve.";const d=await db(`SELECT COUNT(*)::int trades,COALESCE(SUM(profit_loss),0)::numeric pnl,COALESCE(AVG(actual_r),0)::numeric avg_r,COALESCE(AVG(risk_percent),0)::numeric avg_risk,COALESCE(AVG(confidence),0)::numeric confidence,COUNT(*) FILTER(WHERE profit_loss>0)::int wins,COUNT(*) FILTER(WHERE profit_loss<0)::int losses,COALESCE(AVG(mfe_r),0)::numeric mfe,COALESCE(AVG(mae_r),0)::numeric mae FROM trades WHERE user_id=$1`,[req.user.id]);const s=d.rows[0];let local=`You have ${s.trades} recorded trades, ${Number(s.pnl).toFixed(2)} net P&L, ${s.trades?((Number(s.wins)/s.trades)*100).toFixed(1):0}% win rate, ${Number(s.avg_r).toFixed(2)}R average R, ${Number(s.avg_risk).toFixed(2)}% average risk, ${Number(s.confidence).toFixed(0)} average confidence, ${Number(s.mfe).toFixed(2)}R average MFE and ${Number(s.mae).toFixed(2)}R average MAE. `;if(Number(s.avg_risk)>2)local+="Your recorded risk is elevated; consider enforcing a hard risk cap. ";if(Number(s.avg_r)<0)local+="Your average R is negative; prioritize setup quality and review losing clusters. ";if(Number(s.confidence)<50)local+="Confidence is low on average; compare confidence bands before changing strategy. ";if(Number(s.mfe)>0&&Number(s.avg_r)>0&&Number(s.avg_r)/Number(s.mfe)<0.5)local+="Your realized R is less than half of average MFE; review exits for premature profit-taking. ";if(!s.trades)local+="Start logging trades with MFE, MAE, risk, confidence and playbook fields for deeper coaching. ";if(process.env.OPENAI_API_KEY){try{const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||"gpt-5.6-luna",input:[{role:"system",content:"You are Ghost AI, a trading-journal coach. Analyze only the supplied journal statistics. Do not give guaranteed profit claims or personalized financial instructions. Give concise process-focused observations."},{role:"user",content:`Journal statistics: ${local}\nQuestion: ${q}`} ]})});const j=await r.json();const text=(j.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||"").filter(Boolean).join("\n");if(r.ok&&text)return res.json({answer:text,mode:"openai"})}catch(e){console.error("AI provider fallback:",e.message)}}res.json({answer:`${local}\n\nQuestion: ${q}\n\nNext action: review the Execution Lab and Edge Finder, then test one rule change at a time.` ,mode:"local"});}catch(e){console.error(e);res.status(500).json({error:"Coach unavailable."})}});
app.post("/api/import",auth,async(req,res)=>{
  try{
    const rows=Array.isArray(req.body.rows)?req.body.rows:[];

    if(!rows.length)
      return res.status(400).json({error:"No CSV rows supplied."});

    let count=0;

    for(const b of rows.slice(0,2000)){
      const symbol=String(
        b.symbol||b.Symbol||b.ticker||b.Ticker||""
      ).trim().toUpperCase();

      const direction=String(
        b.direction||b.Direction||b.side||b.Side||""
      ).trim().toUpperCase();

      if(!symbol||!["BUY","SELL"].includes(direction))
        continue;

      let acct=String(
        b.account||b.Account||"Main Account"
      ).trim();

      const ac=await db(
        "SELECT starting_balance,currency FROM accounts WHERE user_id=$1 AND name=$2",
        [req.user.id,acct]
      );

      if(!ac.rowCount){
        acct="Main Account";

        const main=await db(
          "SELECT starting_balance,currency FROM accounts WHERE user_id=$1 AND name=$2",
          [req.user.id,acct]
        );

        if(!main.rowCount)
          continue;

        ac.rows=main.rows;
      }

const accountBalance=n(ac.rows[0].starting_balance,0);
const accountCurrency=String(
  ac.rows[0].currency||"USD"
).trim().toUpperCase();

const symbolSpec=getSymbolSpec(symbol);

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

const entry=n(b.entry??b.Entry,null);
      const stopLoss=n(
        b.stop_loss??b.stopLoss??b.SL,
        null
      );
      const takeProfit=n(
        b.take_profit??b.takeProfit??b.TP,
        null
      );
      const exitPrice=n(
        b.exit_price??b.exitPrice??b.Exit,
        null
      );
      const quantity=Number(b.quantity??b.Quantity??b.qty);

      const calculated=calculateTrade({
        symbol,
        direction,
        entry,
        stopLoss,
        takeProfit,
        exitPrice,
        quantity,
        accountBalance,
        accountCurrency
      });

      if(calculated.error)
        continue;

      await db(`
        INSERT INTO trades(
          user_id,
          account,
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
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
          $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
        )
      `,[
        req.user.id,
        acct,
        symbol,
        direction,
        entry,
        stopLoss,
        takeProfit,
        exitPrice,
        quantity,

        // Risk Engine values
        calculated.riskAmount,
        calculated.riskPercent,
        calculated.riskLevel,
        calculated.profitLoss,
        calculated.plannedRr,
        calculated.actualR,

        // Existing CSV values
        n(b.mfe_r??b.mfeR),
        n(b.mae_r??b.maeR),
        n(b.max_favorable_price??b.maxFavorablePrice,null),
        n(b.max_adverse_price??b.maxAdversePrice,null),
        Math.max(
          0,
          Math.min(
            100,
            Math.round(n(b.rule_score??b.ruleScore))
          )
        ),
        b.playbook_id?Number(b.playbook_id):null,
        b.strategy||"",
        b.session||"",
        b.setup||"",
        b.entry_reason||"",
        b.exit_reason||"",
        b.emotion_before||"",
        b.emotion_after||"",
        b.mistakes||"",
        Math.max(
          0,
          Math.min(
            100,
            Math.round(n(b.confidence))
          )
        ),
        b.market_condition||"",
        String(b.screenshot_data||"").slice(0,4500000),
        b.notes||"",
        b.trade_date?new Date(b.trade_date):new Date()
      ]);

      count++;
    }

    res.json({
      imported:count,
      received:rows.length
    });

  }catch(e){
    console.error(e);
    res.status(500).json({
      error:"CSV import failed."
    });
  }
});app.get("/api/export.csv",auth,async(req,res)=>{let r=await db(`SELECT ${fields} FROM trades WHERE user_id=$1 ORDER BY trade_date DESC`,[req.user.id]),cols=fields.split(","),q=x=>`"${String(x??"").replace(/"/g,'""')}"`;res.setHeader("Content-Type","text/csv");res.setHeader("Content-Disposition",'attachment; filename="ghosttrader-trades.csv"');res.send([cols.join(","),...r.rows.map(x=>cols.map(c=>q(x[c])).join(","))].join("\\n"))});
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
init().then(()=>app.listen(PORT,"0.0.0.0",()=>console.log("GhostTrader V2 running on "+PORT))).catch(e=>{console.error(e);process.exit(1)});
