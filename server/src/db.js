import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILE } from './config.js';

if (DB_FILE !== ':memory:') fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male','female','other')),
  interested_in TEXT NOT NULL DEFAULT 'everyone',
  looking_for TEXT NOT NULL DEFAULT 'both',
  dob TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  hobbies TEXT NOT NULL DEFAULT '[]',
  likes TEXT NOT NULL DEFAULT '[]',
  favorite_cuisine TEXT,
  weekend_style TEXT,
  chronotype TEXT,
  dream_destination TEXT,
  has_photo INTEGER NOT NULL DEFAULT 0,
  photo_version INTEGER NOT NULL DEFAULT 0,
  is_host INTEGER NOT NULL DEFAULT 0,
  host_available INTEGER NOT NULL DEFAULT 0,
  host_headline TEXT NOT NULL DEFAULT '',
  wallet_paise INTEGER NOT NULL DEFAULT 0 CHECK (wallet_paise >= 0),
  earnings_paise INTEGER NOT NULL DEFAULT 0 CHECK (earnings_paise >= 0),
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_banned INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS puzzle_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visitor_id INTEGER NOT NULL REFERENCES users(id),
  target_id INTEGER NOT NULL REFERENCES users(id),
  questions TEXT NOT NULL,
  current_index INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  revealed TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','solved','failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_puzzle_pair ON puzzle_attempts(visitor_id, target_id, id);
CREATE INDEX IF NOT EXISTS idx_puzzle_target ON puzzle_attempts(target_id, status);

CREATE TABLE IF NOT EXISTS discover_skips (
  visitor_id INTEGER NOT NULL REFERENCES users(id),
  target_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (visitor_id, target_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, read_at);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id),
  blocked_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reported_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  caller_id INTEGER NOT NULL REFERENCES users(id),
  callee_id INTEGER NOT NULL REFERENCES users(id),
  media TEXT NOT NULL CHECK (media IN ('audio','video')),
  mode TEXT NOT NULL CHECK (mode IN ('paid','free')),
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','active','ended','missed','rejected','failed')),
  rate_key TEXT,
  rate_paise_per_min INTEGER NOT NULL DEFAULT 0,
  billed_minutes INTEGER NOT NULL DEFAULT 0,
  caller_paid_paise INTEGER NOT NULL DEFAULT 0,
  host_earned_paise INTEGER NOT NULL DEFAULT 0,
  platform_fee_paise INTEGER NOT NULL DEFAULT 0,
  end_reason TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id, id);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_id, id);

CREATE TABLE IF NOT EXISTS credit_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  package_id TEXT NOT NULL,
  rate_key TEXT NOT NULL,
  minutes_total INTEGER NOT NULL,
  minutes_left INTEGER NOT NULL CHECK (minutes_left >= 0),
  paise_per_minute INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lots_user ON credit_lots(user_id, rate_key, expires_at);

-- Ledger. user_id NULL = platform account. account: wallet | earnings | package | platform
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  account TEXT NOT NULL,
  type TEXT NOT NULL,
  amount_paise INTEGER NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed')),
  provider_payment_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount_paise INTEGER NOT NULL,
  upi_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT
);
`);

/** Run fn inside a write transaction; rolls back on throw. Not re-entrant. */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const one = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);
