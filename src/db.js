'use strict';

/**
 * SQLite storage via sql.js (SQLite compiled to WebAssembly — no native build needed).
 *
 * The whole database lives in memory and is written to disk after every committed
 * change using write-to-temp + rename, so a crash mid-write never corrupts the file.
 * A dated copy is kept in data/backups once per day (last BACKUP_KEEP_DAYS kept).
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const { todayISO, formatSrn } = require('./util');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'suspense.sqlite');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS) || 30;

// Schema history:
//   1 - first release (entry numbers ST-001)
//   2 - SRN (Suspense Reference Number): entry_no/entry_code renamed to srn_no/srn, codes become SRN-001
const SCHEMA_VERSION = 2;

let db = null;
let inTransaction = false;

async function openDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const SQL = await initSqlJs();
  const isNew = !fs.existsSync(DB_FILE);
  db = isNew ? new SQL.Database() : new SQL.Database(fs.readFileSync(DB_FILE));
  if (!isNew) dailyBackup(); // copy taken before any upgrade below
  migrate();
  return { isNew, file: DB_FILE };
}

function migrate() {
  const version = get('PRAGMA user_version').user_version;
  if (version >= SCHEMA_VERSION) return;

  if (version > 0) {
    // Keep an untouched copy of the database before changing its structure.
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `suspense-before-upgrade-v${version}-${todayISO()}.sqlite`));
  }

  transaction(() => {
    if (version === 0) createSchema();
    if (version === 1) upgradeToSrn();
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });
}

function createSchema() {
  db.run(`
    CREATE TABLE users (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name         TEXT NOT NULL,
      role                 TEXT NOT NULL CHECK (role IN ('ADMIN', 'ENTRY')),
      password_hash        TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      is_active            INTEGER NOT NULL DEFAULT 1,
      created_at           TEXT NOT NULL,
      updated_at           TEXT
    );

    CREATE TABLE sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE entries (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      srn_no             INTEGER NOT NULL UNIQUE,      -- running number behind the SRN, never reused
      srn                TEXT NOT NULL UNIQUE,         -- Suspense Reference Number, e.g. SRN-001; never changes
      entry_date         TEXT NOT NULL,                -- YYYY-MM-DD the amount was given
      whom               TEXT NOT NULL,
      particulars        TEXT NOT NULL,
      amount_paise       INTEGER NOT NULL CHECK (amount_paise > 0),
      remark             TEXT,
      status             TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
      closed_date        TEXT,                         -- YYYY-MM-DD, set automatically on close
      closed_at          TEXT,                         -- exact timestamp of closing
      closed_by          TEXT,
      closed_by_user_id  INTEGER,
      closing_remark     TEXT,
      is_deleted         INTEGER NOT NULL DEFAULT 0,   -- soft delete only (admin)
      deleted_at         TEXT,
      deleted_by         TEXT,
      delete_reason      TEXT,
      version            INTEGER NOT NULL DEFAULT 1,   -- optimistic locking for concurrent edits
      created_at         TEXT NOT NULL,
      created_by         TEXT NOT NULL,
      created_by_user_id INTEGER,
      updated_at         TEXT,
      updated_by         TEXT,
      CHECK ((status = 'OPEN' AND closed_date IS NULL) OR (status = 'CLOSED' AND closed_date IS NOT NULL))
    );
    CREATE INDEX idx_entries_state ON entries (is_deleted, status);
    CREATE INDEX idx_entries_whom ON entries (whom COLLATE NOCASE);
    CREATE INDEX idx_entries_date ON entries (entry_date);

    CREATE TABLE audit_log (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id             INTEGER REFERENCES entries(id),
      action               TEXT NOT NULL,   -- CREATE, UPDATE, CLOSE, REOPEN, DELETE, RESTORE, USER_*
      details              TEXT,            -- JSON
      performed_by         TEXT NOT NULL,
      performed_by_user_id INTEGER,
      performed_at         TEXT NOT NULL
    );
    CREATE INDEX idx_audit_entry ON audit_log (entry_id);
  `);
}

/** Version 1 -> 2: keep every entry's running number, re-label it as an SRN. */
function upgradeToSrn() {
  db.run(`
    ALTER TABLE entries RENAME COLUMN entry_no TO srn_no;
    ALTER TABLE entries RENAME COLUMN entry_code TO srn;
  `);
  for (const { id, srn_no: srnNo } of all('SELECT id, srn_no FROM entries')) {
    run('UPDATE entries SET srn = @srn WHERE id = @id', { srn: formatSrn(srnNo), id });
  }
  const srnById = new Map(all('SELECT id, srn FROM entries').map((r) => [r.id, r.srn]));
  for (const row of all("SELECT id, entry_id, details FROM audit_log WHERE details LIKE '%entryCode%'")) {
    const details = JSON.parse(row.details);
    const { entryCode, ...rest } = details;
    const srn = srnById.get(row.entry_id) || entryCode;
    run('UPDATE audit_log SET details = @details WHERE id = @id', {
      details: JSON.stringify({ srn, ...rest }),
      id: row.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Query helpers. Named parameters are written as @name in SQL and passed as
// plain objects ({ name: value }).
// ---------------------------------------------------------------------------

function bindParams(params) {
  if (params === undefined) return undefined;
  const normalize = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  if (Array.isArray(params)) return params.map(normalize);
  const out = {};
  for (const [k, v] of Object.entries(params)) out[`@${k}`] = normalize(v);
  return out;
}

function all(sql, params) {
  const stmt = db.prepare(sql);
  try {
    const bound = bindParams(params);
    if (bound !== undefined) stmt.bind(bound);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function get(sql, params) {
  return all(sql, params)[0];
}

function run(sql, params) {
  const stmt = db.prepare(sql);
  try {
    stmt.run(bindParams(params));
  } finally {
    stmt.free();
  }
  const changes = db.getRowsModified();
  const lastId = get('SELECT last_insert_rowid() AS id').id;
  if (!inTransaction) persist();
  return { changes, lastId };
}

/** Run fn inside BEGIN/COMMIT; persist to disk once after commit. */
function transaction(fn) {
  if (inTransaction) return fn();
  db.run('BEGIN');
  inTransaction = true;
  let result;
  try {
    result = fn();
    db.run('COMMIT');
  } catch (err) {
    try {
      db.run('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw err;
  } finally {
    inTransaction = false;
  }
  persist();
  return result;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function persist() {
  const bytes = Buffer.from(db.export());
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, bytes);
  try {
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    // Windows can briefly lock the target (antivirus / indexer). Fall back to a direct write.
    fs.writeFileSync(DB_FILE, bytes);
    fs.rmSync(tmp, { force: true });
  }
  dailyBackup();
}

function dailyBackup() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, `suspense-${todayISO()}.sqlite`);
    if (fs.existsSync(target)) return;
    fs.copyFileSync(DB_FILE, target);
    const old = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^suspense-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f))
      .sort()
      .reverse()
      .slice(BACKUP_KEEP_DAYS);
    old.forEach((f) => fs.rmSync(path.join(BACKUP_DIR, f), { force: true }));
  } catch (err) {
    console.warn('[backup] Could not write daily backup:', err.message);
  }
}

module.exports = { openDatabase, all, get, run, transaction, DB_FILE, DATA_DIR };
