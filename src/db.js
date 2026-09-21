'use strict';

/**
 * MongoDB storage (MongoDB Atlas, or any MongoDB server).
 *
 * Collections
 *   entries    one document per suspense entry (permanent SRN, amounts in paise)
 *   users      Entry/Admin logins
 *   sessions   active logins; MongoDB removes them automatically when they expire
 *   counters   the SRN running number
 *   audit_log  change history
 *
 * The connection string lives in .env and is never committed. See src/config.js.
 */

const dns = require('dns');
const { MongoClient, ObjectId } = require('mongodb');
const config = require('./config');

let client = null;
let db = null;
let healthy = false;

const collections = {
  entries: () => db.collection('entries'),
  users: () => db.collection('users'),
  sessions: () => db.collection('sessions'),
  counters: () => db.collection('counters'),
  auditLog: () => db.collection('audit_log'),
};

const isDnsFailure = (err) =>
  /querySrv|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ESERVFAIL|getaddrinfo/i.test(`${err.code || ''} ${err.message || ''}`);

async function connect(uri) {
  const c = new MongoClient(uri, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
    socketTimeoutMS: 45000,
    maxPoolSize: 20,
    retryWrites: true,
    retryReads: true,
  });
  await c.connect();
  await c.db(config.MONGODB_DB).command({ ping: 1 });
  return c;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Connect, retrying a few times so a brief network hiccup at start-up is not fatal. */
async function connectWithRetry(uri, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await connect(uri);
    } catch (err) {
      lastError = err;
      if (isDnsFailure(err) && config.DNS_FALLBACK.length && attempt === 1) {
        // The system resolver could not look up the cluster; try public DNS servers instead.
        console.warn('[db] System DNS could not find the cluster; retrying via', config.DNS_FALLBACK.join(', '));
        dns.setServers([...config.DNS_FALLBACK, ...dns.getServers()]);
        continue;
      }
      if (attempt < attempts) {
        console.warn(`[db] Connection attempt ${attempt} failed (${err.message.split('\n')[0]}); retrying...`);
        await wait(2000 * attempt);
      }
    }
  }
  throw lastError;
}

async function openDatabase() {
  if (!config.MONGODB_URI) {
    throw new Error(
      'No database connection string (MONGODB_URI). Expected something like:\n' +
        '  mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority'
    );
  }

  client = await connectWithRetry(config.MONGODB_URI);
  client.on('serverHeartbeatFailed', () => {
    healthy = false;
  });
  client.on('serverHeartbeatSucceeded', () => {
    healthy = true;
  });

  db = client.db(config.MONGODB_DB);
  healthy = true;
  await upgradeEntriesForReturns();
  await upgradeForRoles();
  await ensureIndexes();
  const isNew =
    (await collections.entries().countDocuments({}, { limit: 1 })) === 0 &&
    (await collections.users().countDocuments({}, { limit: 1 })) === 0;
  return { isNew, name: db.databaseName, host: hostLabel() };
}

/** Cluster host for the start-up message (never includes the password). */
function hostLabel() {
  const m = /@([^/?]+)/.exec(config.MONGODB_URI);
  return m ? m[1] : 'MongoDB';
}

/**
 * Entries created before partial returns existed have no returns list.
 * Open ones start with nothing returned; already-closed ones count as returned in full,
 * so that Original Amount = Returned Amount + Balance Amount holds for every record.
 */
async function upgradeEntriesForReturns() {
  const missing = await collections.entries().countDocuments({ returnedPaise: { $exists: false } }, { limit: 1 });
  if (!missing) return;
  const open = await collections
    .entries()
    .updateMany({ returnedPaise: { $exists: false }, status: { $ne: 'CLOSED' } }, { $set: { returns: [], returnedPaise: 0 } });
  const closed = await collections
    .entries()
    .updateMany({ returnedPaise: { $exists: false }, status: 'CLOSED' }, [
      { $set: { returns: [], returnedPaise: '$amountPaise' } },
    ]);
  console.log(
    `[setup] Prepared existing entries for partial returns (${open.modifiedCount} pending, ${closed.modifiedCount} closed).`
  );
}

/**
 * Role-based access upgrade (safe to run on every start):
 *  - users get a lower-cased display name (used to link people to their records)
 *  - entries get givenToUserId, the link that decides which records a Normal User may see
 *  - closed entries get finalAgeDays, the age at the moment they were closed
 */
async function upgradeForRoles() {
  const users = await collections.users().find({ displayNameLower: { $exists: false } }).toArray();
  for (const u of users) {
    await collections.users().updateOne({ _id: u._id }, { $set: { displayNameLower: String(u.displayName).toLowerCase() } });
  }

  const unlinked = await collections.entries().find({ givenToUserId: { $exists: false } }).project({ whomLower: 1 }).toArray();
  if (unlinked.length) {
    const byName = new Map();
    for (const u of await collections.users().find({}).toArray()) byName.set(u.displayNameLower, u._id);
    let linked = 0;
    for (const e of unlinked) {
      const userId = byName.get(e.whomLower) || null;
      if (userId) linked += 1;
      await collections.entries().updateOne({ _id: e._id }, { $set: { givenToUserId: userId } });
    }
    console.log(`[setup] Linked ${linked} of ${unlinked.length} existing entries to employee logins.`);
  }

  const closed = await collections.entries().find({ status: 'CLOSED', finalAgeDays: { $exists: false } }).toArray();
  for (const e of closed) {
    const [y1, m1, d1] = String(e.entryDate).split('-').map(Number);
    const [y2, m2, d2] = String(e.closedDate || e.entryDate).split('-').map(Number);
    const days = Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000));
    await collections.entries().updateOne({ _id: e._id }, { $set: { finalAgeDays: days } });
  }
}

async function ensureIndexes() {
  await collections.entries().createIndexes([
    { key: { srn: 1 }, unique: true, name: 'srn_unique' },
    { key: { srnNo: 1 }, unique: true, name: 'srn_no_unique' },
    { key: { isDeleted: 1, status: 1 }, name: 'state' },
    { key: { entryDate: 1 }, name: 'entry_date' },
    { key: { whomLower: 1 }, name: 'whom' },
    { key: { particularsLower: 1 }, name: 'particulars' },
    { key: { givenToUserId: 1, isDeleted: 1 }, name: 'given_to_user' },
  ]);
  await collections.users().createIndexes([{ key: { usernameLower: 1 }, unique: true, name: 'username_unique' }]);
  try {
    // One login per person name, so a name can never link to two different employees.
    await collections.users().createIndexes([{ key: { displayNameLower: 1 }, unique: true, name: 'display_name_unique' }]);
  } catch (err) {
    console.warn('[db] Could not enforce unique employee names (two logins share a name):', err.message.split(String.fromCharCode(10))[0]);
  }
  await collections.sessions().createIndexes([
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'session_expiry' },
    { key: { userId: 1 }, name: 'session_user' },
  ]);
  await collections.auditLog().createIndexes([{ key: { entryId: 1, _id: 1 }, name: 'audit_entry' }]);
}

async function closeDatabase() {
  if (changeStream) {
    try {
      await changeStream.close();
    } catch (_) {
      /* ignore */
    }
    changeStream = null;
  }
  if (client) await client.close();
  client = null;
  db = null;
  healthy = false;
}

/** Is the database reachable right now? Used by /api/health. */
async function ping() {
  if (!db) return { connected: false, error: 'Not connected' };
  const started = Date.now();
  try {
    await db.command({ ping: 1 });
    healthy = true;
    return { connected: true, responseMs: Date.now() - started };
  } catch (err) {
    healthy = false;
    return { connected: false, error: err.message.split('\n')[0] };
  }
}

const isHealthy = () => healthy;

let changeStream = null;

/**
 * Watch the entries collection so changes made anywhere (another server, Atlas, Compass)
 * reach every open screen. Returns false when the server does not support change streams
 * (a standalone mongod); the app then relies on its own notifications plus the periodic refresh.
 */
function watchEntries(onChange) {
  try {
    changeStream = collections.entries().watch([], { fullDocument: 'updateLookup' });
    changeStream.on('change', (change) => onChange(change.operationType));
    changeStream.on('error', (err) => {
      console.warn('[db] Live change stream stopped:', err.message.split('\n')[0]);
      changeStream = null;
    });
    return true;
  } catch (err) {
    console.warn('[db] Live change stream not available:', err.message.split('\n')[0]);
    return false;
  }
}

/** Next SRN number: atomic, so two people adding at the same moment can never get the same one. */
async function nextSrnNumber() {
  const result = await collections
    .counters()
    .findOneAndUpdate({ _id: 'srn' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  const doc = result && result.value ? result.value : result;
  return doc.seq;
}

/** The number the next new entry would get, without using it up (for the Add form preview). */
async function peekSrnNumber() {
  const doc = await collections.counters().findOne({ _id: 'srn' });
  return (doc ? doc.seq : 0) + 1;
}

/** Keep the counter ahead of every SRN already stored (used after an import/restore). */
async function syncSrnCounter() {
  const [highest] = await collections.entries().find({}).sort({ srnNo: -1 }).limit(1).toArray();
  if (!highest) return;
  await collections.counters().updateOne({ _id: 'srn' }, { $max: { seq: highest.srnNo } }, { upsert: true });
}

const toObjectId = (id) => {
  if (id instanceof ObjectId) return id;
  return ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : null;
};

module.exports = {
  openDatabase,
  closeDatabase,
  ping,
  isHealthy,
  watchEntries,
  collections,
  nextSrnNumber,
  peekSrnNumber,
  syncSrnCounter,
  toObjectId,
  ObjectId,
  getDb: () => db,
};
