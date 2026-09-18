'use strict';

/**
 * Restore entries and their change history from a backup file made by `npm run backup`.
 *
 *   npm run restore -- data/backups/backup-2026-09-18.json
 *
 * Only runs into an empty database, so an existing database can never be overwritten by mistake.
 * Logins are not restored (backups never contain passwords): the first start after a restore
 * creates the default admin login again.
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const { ObjectId } = require('mongodb');

const revive = (doc) => {
  const out = { ...doc };
  if (out._id) out._id = ObjectId.isValid(String(out._id)) ? new ObjectId(String(out._id)) : out._id;
  if (out.entryId) out.entryId = ObjectId.isValid(String(out.entryId)) ? new ObjectId(String(out.entryId)) : out.entryId;
  for (const key of ['createdAt', 'updatedAt', 'closedAt', 'deletedAt', 'performedAt']) {
    if (out[key]) out[key] = new Date(out[key]);
  }
  return out;
};

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.log('Usage: npm run restore -- <backup file>');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

  await db.openDatabase();
  const existing = await db.collections.entries().countDocuments({}, { limit: 1 });
  if (existing > 0) {
    console.error('This database already has entries. Restore only runs into an empty database.');
    console.error('Point MONGODB_DB at an empty database, or clear the entries collection first.');
    await db.closeDatabase();
    process.exit(1);
  }

  if (data.entries && data.entries.length) await db.collections.entries().insertMany(data.entries.map(revive));
  if (data.auditLog && data.auditLog.length) await db.collections.auditLog().insertMany(data.auditLog.map(revive));
  await db.syncSrnCounter();

  console.log(`Restored ${data.entries ? data.entries.length : 0} entries from ${file}.`);
  console.log('Logins were not restored; start the server to create the default admin login again.');
  await db.closeDatabase();
}

main().catch(async (err) => {
  console.error('Restore failed:', err.message);
  await db.closeDatabase().catch(() => {});
  process.exit(1);
});
