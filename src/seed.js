'use strict';

/**
 * Sample data for a brand-new database, matching the three example records:
 *
 *   SRN-001  Ashok    Purchase        Rs 1,000   Rs 500 returned   Rs 500 balance    Partially Settled
 *   SRN-002  Vanitha  Labour Charges  Rs   950   nothing returned                    Open
 *   SRN-003  Jaya     Purchase        Rs 3,120   fully returned                      Closed
 *
 * Ashok, Vanitha and Jaya also get Normal User logins so the "own records only" view can be tried.
 * Totals on the dashboard are always calculated from the database, never hardcoded.
 */

const entries = require('./entries');
const users = require('./users');
const { todayISO } = require('./util');

const SAMPLE_PASSWORD = 'Welcome@123';

const SAMPLE_USERS = [
  { username: 'ashok', displayName: 'Ashok', role: 'NORMAL' },
  { username: 'vanitha', displayName: 'Vanitha', role: 'NORMAL' },
  { username: 'jaya', displayName: 'Jaya', role: 'NORMAL' },
];

// Dates are fixed so the sample looks the same wherever it is created; any that would fall after
// today (an unusual clock) are skipped rather than made up.
const SAMPLE_ENTRIES = [
  {
    entry: { entryDate: '2026-09-12', whom: 'Ashok', particulars: 'Purchase', amount: '1000' },
    returns: [{ returnDate: '2026-09-18', returnedBy: 'Ashok', amount: '500', remark: 'Partial amount returned' }],
  },
  {
    entry: { entryDate: '2026-09-12', whom: 'Vanitha', particulars: 'Labour Charges', amount: '950' },
    returns: [],
  },
  {
    entry: { entryDate: '2026-09-13', whom: 'Jaya', particulars: 'Purchase', amount: '3120' },
    returns: [{ returnDate: '2026-09-20', returnedBy: 'Jaya', amount: '3120', remark: 'Full amount returned' }],
  },
];

async function seedSampleData() {
  const today = todayISO();
  const createdUsers = [];
  for (const u of SAMPLE_USERS) {
    try {
      await users.createUser({ ...u, password: SAMPLE_PASSWORD }, null, { mustChangePassword: true });
      createdUsers.push({ ...u, password: SAMPLE_PASSWORD });
    } catch (err) {
      console.warn(`[seed] Skipped sample login ${u.username}: ${err.message}`);
    }
  }

  const system = { id: null, displayName: 'System' };
  let created = 0;
  for (const sample of SAMPLE_ENTRIES) {
    try {
      if (sample.entry.entryDate > today) throw new Error('its date is in the future on this computer');
      const entry = await entries.createEntry(sample.entry, null);
      for (const r of sample.returns) {
        if (r.returnDate > today) continue;
        await entries.addReturn(entry.id, r, system);
      }
      created += 1;
    } catch (err) {
      console.warn(`[seed] Skipped sample entry for ${sample.entry.whom}: ${err.message}`);
    }
  }
  return { entries: created, users: createdUsers };
}

module.exports = { seedSampleData };
