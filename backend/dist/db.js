import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(backendRoot, process.env.DATABASE_PATH ?? "./data/pixel-wall.db");
mkdirSync(dirname(path), { recursive: true });
export const db = new DatabaseSync(path);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_active TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS pixels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(x, y)
  );
  CREATE TABLE IF NOT EXISTS pixel_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    batch_id TEXT NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    previous_color TEXT,
    new_color TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS canvas_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    origin_x INTEGER NOT NULL,
    origin_y INTEGER NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('email', 'username', 'network')),
    value_hash TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(kind, value_hash)
  );
  CREATE TABLE IF NOT EXISTS moderation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    batch_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'allowed', 'review', 'blocked', 'error')),
    score REAL,
    categories_json TEXT NOT NULL DEFAULT '[]',
    snapshot_json TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    network_hash TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS moderation_appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    receipt_hash TEXT NOT NULL UNIQUE,
    statement TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'recommended_restore', 'recommended_deny', 'review', 'restored', 'denied', 'error')),
    recommendation TEXT,
    confidence REAL,
    rationale TEXT,
    network_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_history_user ON pixel_history(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_history_created ON pixel_history(created_at);
  CREATE INDEX IF NOT EXISTS idx_tokens_hash ON auth_tokens(token_hash);
  CREATE INDEX IF NOT EXISTS idx_blacklist_lookup ON blacklist(kind, value_hash);
  CREATE INDEX IF NOT EXISTS idx_moderation_status ON moderation_events(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_appeals_user_status ON moderation_appeals(user_id, status, created_at);
`);
const userColumns = db.prepare("PRAGMA table_info(users)").all();
if (!userColumns.some((column) => column.name === "email")) {
    db.exec("ALTER TABLE users ADD COLUMN email TEXT COLLATE NOCASE");
    db.exec("UPDATE users SET email = lower(username) || '@pixelwall.local' WHERE email IS NULL");
}
if (!userColumns.some((column) => column.name === "banned_at")) {
    db.exec("ALTER TABLE users ADD COLUMN banned_at TEXT");
}
if (!userColumns.some((column) => column.name === "ban_reason")) {
    db.exec("ALTER TABLE users ADD COLUMN ban_reason TEXT");
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE)");
const historyColumns = db.prepare("PRAGMA table_info(pixel_history)").all();
if (!historyColumns.some((column) => column.name === "operation")) {
    db.exec("ALTER TABLE pixel_history ADD COLUMN operation TEXT NOT NULL DEFAULT 'paint'");
}
if (!historyColumns.some((column) => column.name === "previous_user_id")) {
    db.exec("ALTER TABLE pixel_history ADD COLUMN previous_user_id INTEGER");
}
if (!historyColumns.some((column) => column.name === "hidden_at")) {
    db.exec("ALTER TABLE pixel_history ADD COLUMN hidden_at TEXT");
}
const moderationColumns = db.prepare("PRAGMA table_info(moderation_events)").all();
if (!moderationColumns.some((column) => column.name === "snapshot_json")) {
    db.exec("ALTER TABLE moderation_events ADD COLUMN snapshot_json TEXT NOT NULL DEFAULT '[]'");
}
