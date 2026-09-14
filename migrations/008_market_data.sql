BEGIN;

CREATE TABLE IF NOT EXISTS market_symbols (
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

CREATE TABLE IF NOT EXISTS market_timeframes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    seconds INTEGER NOT NULL UNIQUE CHECK (seconds > 0),
    display_name VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_candles (
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

    CONSTRAINT market_candles_ohlc_valid
        CHECK (
            high >= low
            AND high >= open
            AND high >= close
            AND low <= open
            AND low <= close
        ),

    CONSTRAINT market_candles_unique
        UNIQUE(symbol, timeframe, candle_time)
);

CREATE TABLE IF NOT EXISTS market_data_imports (
    id BIGSERIAL PRIMARY KEY,

    symbol VARCHAR(50) NOT NULL,
    timeframe VARCHAR(20) NOT NULL,
    source VARCHAR(80) NOT NULL,

    requested_from TIMESTAMPTZ,
    requested_to TIMESTAMPTZ,

    rows_received INTEGER NOT NULL DEFAULT 0,
    rows_inserted INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'running',
                'completed',
                'failed',
                'cancelled'
            )
        ),

    error_message TEXT,

    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_candles_lookup
    ON market_candles(symbol, timeframe, candle_time);

CREATE INDEX IF NOT EXISTS idx_market_candles_time
    ON market_candles(candle_time);

CREATE INDEX IF NOT EXISTS idx_market_candles_source
    ON market_candles(source);

CREATE INDEX IF NOT EXISTS idx_market_imports_lookup
    ON market_data_imports(symbol, timeframe, created_at DESC);

INSERT INTO market_timeframes(code, seconds, display_name)
VALUES
    ('1m', 60, '1 Minute'),
    ('5m', 300, '5 Minutes'),
    ('15m', 900, '15 Minutes'),
    ('30m', 1800, '30 Minutes'),
    ('1h', 3600, '1 Hour'),
    ('4h', 14400, '4 Hours'),
    ('1d', 86400, '1 Day')
ON CONFLICT (code) DO NOTHING;

INSERT INTO market_symbols
    (symbol, display_name, asset_class, base_asset, quote_asset, price_decimals)
VALUES
    ('XAUUSD', 'Gold / US Dollar', 'metals', 'XAU', 'USD', 2),
    ('EURUSD', 'Euro / US Dollar', 'forex', 'EUR', 'USD', 5),
    ('GBPUSD', 'British Pound / US Dollar', 'forex', 'GBP', 'USD', 5),
    ('USDJPY', 'US Dollar / Japanese Yen', 'forex', 'USD', 'JPY', 3),
    ('AUDUSD', 'Australian Dollar / US Dollar', 'forex', 'AUD', 'USD', 5),
    ('USDCAD', 'US Dollar / Canadian Dollar', 'forex', 'USD', 'CAD', 5),
    ('USDCHF', 'US Dollar / Swiss Franc', 'forex', 'USD', 'CHF', 5),
    ('BTCUSD', 'Bitcoin / US Dollar', 'crypto', 'BTC', 'USD', 2),
    ('ETHUSD', 'Ethereum / US Dollar', 'crypto', 'ETH', 'USD', 2)
ON CONFLICT (symbol) DO NOTHING;

COMMIT;
