'use strict';

/**
 * Settings, read from the environment and from a local .env file.
 *
 * .env holds this computer's own settings (database password!) and is never committed.
 * See .env.example for the format.
 */

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

function loadEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const rawLine of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Real environment variables win over the file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const flag = (name, fallback) => String(process.env[name] ?? fallback).toLowerCase() !== 'false';

module.exports = {
  ENV_FILE,
  MONGODB_URI: process.env.MONGODB_URI || '',
  MONGODB_DB: process.env.MONGODB_DB || 'jpm_suspense',
  // Some office networks / VPNs cannot resolve the SRV records that mongodb+srv:// needs;
  // these public resolvers are used only as a fallback when the system resolver fails.
  DNS_FALLBACK: (process.env.DNS_SERVERS || '8.8.8.8,1.1.1.1').split(',').map((s) => s.trim()).filter(Boolean),
  PORT: Number(process.env.PORT) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  TIMEZONE: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  SEED_SAMPLE_DATA: flag('SEED_SAMPLE_DATA', 'true'),
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'Admin@123',
  SESSION_HOURS: Number(process.env.SESSION_HOURS) || 12,
  COOKIE_SECURE: String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true',
  BACKUP_DIR: path.resolve(process.env.BACKUP_DIR || path.join(__dirname, '..', 'data', 'backups')),
  BACKUP_KEEP_DAYS: Number(process.env.BACKUP_KEEP_DAYS) || 30,
  AUTO_BACKUP: flag('AUTO_BACKUP', 'true'),
};
