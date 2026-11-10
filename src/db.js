const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
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
