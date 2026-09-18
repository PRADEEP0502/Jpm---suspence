'use strict';

/**
 * Save a copy of everything in the database to data/backups/backup-<date>.json.
 *
 *   npm run backup
 */

const path = require('path');
const db = require('../src/db');
const backup = require('../src/backup');
const config = require('../src/config');
const { todayISO } = require('../src/util');

async function main() {
  await db.openDatabase();
  const target = path.join(config.BACKUP_DIR, `backup-${todayISO()}.json`);
  const file = await backup.writeBackup(target);
  const data = await backup.exportAll();
  console.log(`Backup saved: ${file}`);
  console.log(`  entries: ${data.counts.entries}, logins: ${data.counts.users}, history records: ${data.counts.auditLog}`);
  await db.closeDatabase();
}

main().catch(async (err) => {
  console.error('Backup failed:', err.message);
  await db.closeDatabase().catch(() => {});
  process.exit(1);
});
