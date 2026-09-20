module.exports=async function init({db}){
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

/*
 * Batch 1B — account lifecycle (archive/reactivate).
 * Additive, non-destructive: existing rows default to active=TRUE,
 * so no account or trade is affected until a user explicitly
 * archives an account. See migrations/012_accounts_active_lifecycle.sql
 * for the standalone migration form of this same statement.
 */
await db(`
  ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE
`);

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

/*
 * Fix Batch 2 — trades performance indexes.
 * See migrations/011_trades_performance_indexes.sql for the
 * standalone migration form of these same statements.
 */
await db(`
  CREATE INDEX IF NOT EXISTS idx_trades_user_date
  ON trades(user_id, trade_date)
`);

await db(`
  CREATE INDEX IF NOT EXISTS idx_trades_user_account
  ON trades(user_id, account)
`);

await db(`
  CREATE INDEX IF NOT EXISTS idx_trades_user_symbol
  ON trades(user_id, symbol)
`);

/*
 * Batch 1C — real trade -> account relationship.
 *
 * trades.account (free-text name) stays exactly as-is: many other
 * routes (analytics, execution, simulation, CSV import/export,
 * missed trades, etc.) filter/join on it and are out of scope for
 * this batch, so removing or renaming it would break them. This
 * adds trades.account_id purely additively alongside it, backfills
 * it from the existing name+user match, and only adds the FK once
 * backfill has run (NULL account_id values are simply skipped by
 * the FK check, so this is safe even for any row that can't be
 * matched). See migrations/013_trades_account_id.sql for the
 * standalone migration form of these same statements, including
 * the matched/unmatched diagnostics this logs on every boot.
 */
await db(`
  ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS account_id INTEGER
`);

await db(`
  UPDATE trades t
  SET account_id = a.id
  FROM accounts a
  WHERE t.account_id IS NULL
    AND t.user_id = a.user_id
    AND t.account = a.name
`);

await db(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_trades_account_id'
    ) THEN
      ALTER TABLE trades
      ADD CONSTRAINT fk_trades_account_id
      FOREIGN KEY (account_id) REFERENCES accounts(id)
      ON DELETE SET NULL;
    END IF;
  END $$;
`);

await db(`
  CREATE INDEX IF NOT EXISTS idx_trades_account_id
  ON trades(account_id)
`);

try{
  const diag=await db(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(account_id)::int AS populated
    FROM trades
  `);
  const {total,populated}=diag.rows[0];
  console.log(
    `[migration] trades.account_id: ${populated}/${total} rows populated, ${total-populated} unmatched (left NULL, not guessed)`
  );
}catch(e){
  console.error("[migration] trades.account_id diagnostic failed:",e.message);
}

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

/*
 * Admin Control Center — user role/status + audit log.
 * Additive: existing users default to role=user, status=active
 * so no existing trader is locked out. New registrations set
 * status=pending explicitly in auth-routes. See
 * migrations/014_user_admin_and_audit.sql for the numbered form.
 */
await db(`
  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by INTEGER,
    ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS banned_by INTEGER,
    ADD COLUMN IF NOT EXISTS ban_reason TEXT,
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0
`);

await db(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
    ) THEN
      ALTER TABLE users
        ADD CONSTRAINT users_role_check
        CHECK (role IN ('user', 'admin'));
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check'
    ) THEN
      ALTER TABLE users
        ADD CONSTRAINT users_status_check
        CHECK (status IN ('pending', 'active', 'banned'));
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'users_approved_by_fkey'
    ) THEN
      ALTER TABLE users
        ADD CONSTRAINT users_approved_by_fkey
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'users_banned_by_fkey'
    ) THEN
      ALTER TABLE users
        ADD CONSTRAINT users_banned_by_fkey
        FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
  END $$;
`);

await db(`
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id SERIAL PRIMARY KEY,
    admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    target_user_id INTEGER,
    action VARCHAR(40) NOT NULL,
    reason TEXT,
    metadata JSONB,
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

await db(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`);
await db(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
await db(`CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC)`);
await db(`CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email))`);
await db(`CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC)`);
await db(`CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_user_id, created_at DESC)`);
await db(`CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_user_id, created_at DESC)`);
await db(`CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action)`);

/*
 * Optional bootstrap: promote INITIAL_ADMIN_EMAIL to active admin.
 * Server-side only — no public endpoint.
 */
if (process.env.INITIAL_ADMIN_EMAIL) {
  const email = String(process.env.INITIAL_ADMIN_EMAIL).trim().toLowerCase();
  if (email) {
    try {
      const r = await db(
        `UPDATE users
         SET role = 'admin',
             status = 'active',
             approved_at = COALESCE(approved_at, NOW())
         WHERE LOWER(email) = $1
           AND (role IS DISTINCT FROM 'admin' OR status IS DISTINCT FROM 'active')
         RETURNING id, email`,
        [email]
      );
      if (r.rowCount) {
        console.log("[admin] Bootstrapped administrator for", email);
      }
    } catch (e) {
      console.error("[admin] Bootstrap failed:", e.message);
    }
  }
}
}

