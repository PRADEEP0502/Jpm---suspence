'use strict';

/**
 * Backup: writes the whole database to a dated JSON file in data/backups.
 *
 * MongoDB Atlas free clusters have no automatic backups, so the server takes one
 * copy per day while it is running, and `npm run backup` takes one on demand.
 */

const fs = require('fs');
const path = require('path');
const db = require('./db');
const config = require('./config');
const { todayISO } = require('./util');

async function exportAll() {
  const [entries, users, auditLog, counters] = await Promise.all([
    db.collections.entries().find({}).toArray(),
    db.collections.users().find({}, { projection: { passwordHash: 0 } }).toArray(),
    db.collections.auditLog().find({}).toArray(),
    db.collections.counters().find({}).toArray(),
  ]);
  return {
    takenAt: new Date().toISOString(),
    database: db.getDb().databaseName,
    note: 'Logins are included without passwords. Restore with: npm run restore -- <file>',
    counts: { entries: entries.length, users: users.length, auditLog: auditLog.length },
    entries,
    users,
    auditLog,
    counters,
  };
}

/** Write today's backup file if it does not exist yet. Returns the path, or null if already done. */
async function backupOncePerDay() {
  const target = path.join(config.BACKUP_DIR, `backup-${todayISO()}.json`);
  if (fs.existsSync(target)) return null;
  return writeBackup(target);
}

async function writeBackup(target) {
  fs.mkdirSync(config.BACKUP_DIR, { recursive: true });
  const data = await exportAll();
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  prune();
  return target;
}

function prune() {
  const old = fs
    .readdirSync(config.BACKUP_DIR)
    .filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse()
    .slice(config.BACKUP_KEEP_DAYS);
  old.forEach((f) => fs.rmSync(path.join(config.BACKUP_DIR, f), { force: true }));
}

/** Take a backup now, then once a day while the server runs. */
function startDailyBackups() {
  if (!config.AUTO_BACKUP) return;
  const run = () =>
    backupOncePerDay()
      .then((file) => {
        if (file) console.log(`[backup] Saved ${file}`);
      })
      .catch((err) => console.warn('[backup] Could not write backup:', err.message));
  run();
  setInterval(run, 6 * 3600 * 1000).unref();
}

module.exports = { exportAll, writeBackup, backupOncePerDay, startDailyBackups };
