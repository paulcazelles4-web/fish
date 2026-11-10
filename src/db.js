const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL || process.env.DATABASE_URL,
  // Neon requires TLS; use the pooled connection string for long-running bot workloads.
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      coins BIGINT NOT NULL DEFAULT 100,
      xp BIGINT NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      active_rod TEXT NOT NULL DEFAULT 'wooden',
      last_fished_at TIMESTAMPTZ,
      last_daily_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS catches (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES players(user_id) ON DELETE CASCADE,
      fish_id TEXT NOT NULL,
      fish_name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      value BIGINT NOT NULL,
      xp BIGINT NOT NULL,
      caught_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sold_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS owned_rods (
      user_id TEXT NOT NULL REFERENCES players(user_id) ON DELETE CASCADE,
      rod_id TEXT NOT NULL,
      purchased_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, rod_id)
    );
    CREATE INDEX IF NOT EXISTS catches_user_unsold_idx ON catches(user_id) WHERE sold_at IS NULL;
    CREATE INDEX IF NOT EXISTS catches_rarity_idx ON catches(rarity);

    -- Trading and marketplace migration. Safe to run on every startup.
    ALTER TABLE catches ADD COLUMN IF NOT EXISTS locked_by_trade BIGINT;
    ALTER TABLE catches ADD COLUMN IF NOT EXISTS market_listing_id BIGINT;
    CREATE INDEX IF NOT EXISTS catches_trade_lock_idx ON catches(locked_by_trade) WHERE locked_by_trade IS NOT NULL;

    CREATE TABLE IF NOT EXISTS market_listings (
      id BIGSERIAL PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES players(user_id),
      catch_id BIGINT NOT NULL REFERENCES catches(id),
      fish_name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      price BIGINT NOT NULL CHECK (price > 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','sold','cancelled','expired')),
      buyer_id TEXT REFERENCES players(user_id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
      sold_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_listing_per_catch
      ON market_listings(catch_id) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS market_active_price_idx ON market_listings(price) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS market_sales (
      id BIGSERIAL PRIMARY KEY,
      listing_id BIGINT NOT NULL,
      fish_name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      seller_id TEXT NOT NULL REFERENCES players(user_id),
      buyer_id TEXT NOT NULL REFERENCES players(user_id),
      sale_price BIGINT NOT NULL,
      tax_amount BIGINT NOT NULL DEFAULT 0,
      sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS market_sales_fish_date_idx ON market_sales(fish_name, sold_at DESC);
    CREATE INDEX IF NOT EXISTS market_sales_participants_idx ON market_sales(seller_id, buyer_id, sold_at DESC);

    CREATE TABLE IF NOT EXISTS trades (
      id BIGSERIAL PRIMARY KEY,
      proposer_id TEXT NOT NULL REFERENCES players(user_id),
      recipient_id TEXT NOT NULL REFERENCES players(user_id),
      proposer_coins BIGINT NOT NULL DEFAULT 0 CHECK (proposer_coins >= 0),
      recipient_coins BIGINT NOT NULL DEFAULT 0 CHECK (recipient_coins >= 0),
      proposer_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      recipient_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','cancelled','expired')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      closed_at TIMESTAMPTZ,
      CHECK (proposer_id <> recipient_id)
    );
    CREATE INDEX IF NOT EXISTS trades_expiry_idx ON trades(expires_at) WHERE status = 'open';

    CREATE TABLE IF NOT EXISTS trade_items (
      id BIGSERIAL PRIMARY KEY,
      trade_id BIGINT NOT NULL REFERENCES trades(id),
      owner_id TEXT NOT NULL REFERENCES players(user_id),
      catch_id BIGINT NOT NULL REFERENCES catches(id),
      fish_name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (trade_id, catch_id)
    );
    -- Locks on catches are the source of truth; old rows remain as trade audit history.
    DROP INDEX IF EXISTS one_open_trade_per_catch;
  `);
}

async function ensurePlayer(userId, username) {
  const result = await pool.query(
    `INSERT INTO players (user_id, username) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username RETURNING *`,
    [userId, username]
  );
  await pool.query(
    "INSERT INTO owned_rods (user_id, rod_id) VALUES ($1, 'wooden') ON CONFLICT DO NOTHING",
    [userId]
  );
  return result.rows[0];
}

module.exports = { pool, initDatabase, ensurePlayer };
