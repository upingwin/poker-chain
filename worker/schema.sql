-- Poker Chain · D1 Database Schema
-- Run: wrangler d1 execute poker-chain --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  user_id    INTEGER PRIMARY KEY,
  first_name TEXT    NOT NULL DEFAULT '',
  username   TEXT,
  avatar_url TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS scores (
  user_id    INTEGER NOT NULL,
  level_id   INTEGER NOT NULL,
  score      INTEGER NOT NULL DEFAULT 0,
  stars      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, level_id)
);

-- Fast lookup: top N players for a given level
CREATE INDEX IF NOT EXISTS idx_scores_level ON scores (level_id, score DESC);
-- Fast lookup: all scores for a given user
CREATE INDEX IF NOT EXISTS idx_scores_user  ON scores (user_id);

CREATE TABLE IF NOT EXISTS skin_purchases (
  user_id      INTEGER NOT NULL,
  skin_id      INTEGER NOT NULL,
  purchased_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, skin_id)
);
