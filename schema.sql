-- ═══════════════════════════════════════════
-- Kỷ Niệm Lớp — Cloudflare D1 Schema
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  username     TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memories (
  id           TEXT PRIMARY KEY,
  image_key    TEXT NOT NULL,
  storage_type TEXT NOT NULL DEFAULT 'r2',
  uploader     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (uploader) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profiles (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  nickname   TEXT,
  photo_key  TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  memory_id  TEXT NOT NULL,
  username   TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reactions (
  id         TEXT PRIMARY KEY,
  memory_id  TEXT NOT NULL,
  username   TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(memory_id, username, emoji),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
  FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ─── Seed Owner Account ───
-- Password: hieu2011@  →  SHA-256 hash (pre-computed)
-- Hash is computed at runtime on first deploy via the init endpoint
