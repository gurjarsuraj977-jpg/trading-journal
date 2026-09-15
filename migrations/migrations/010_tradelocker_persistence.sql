ALTER TABLE tradelocker_connections
ADD COLUMN IF NOT EXISTS refresh_token TEXT;

ALTER TABLE tradelocker_connections
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

ALTER TABLE tradelocker_connections
ADD COLUMN IF NOT EXISTS selected_account_id VARCHAR(64);

ALTER TABLE tradelocker_connections
ADD COLUMN IF NOT EXISTS selected_acc_num INTEGER;

ALTER TABLE tradelocker_connections
ADD COLUMN IF NOT EXISTS selected_account_name VARCHAR(128);

ALTER TABLE tradelocker_connections
ADD COLUMN IF NOT EXISTS token_updated_at TIMESTAMPTZ;
