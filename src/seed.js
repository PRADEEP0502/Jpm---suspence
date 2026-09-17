'use strict';

const entries = require('./entries');

// Sample records for first-run testing. Totals on the dashboard are always
// computed from the database, never hardcoded.
const SAMPLE_ENTRIES = [
  { entryDate: '2026-09-12', whom: 'Ashok', particulars: 'Stationery Purchase', amount: '500' },
  { entryDate: '2026-09-12', whom: 'Vanitha', particulars: 'Labour Charges', amount: '950' },
  { entryDate: '2026-09-12', whom: 'AO', particulars: 'Wages', amount: '544' },
  { entryDate: '2026-09-13', whom: 'Jaya Surya', particulars: 'Purchase', amount: '3120' },
];

function seedSampleData() {
  let created = 0;
  for (const sample of SAMPLE_ENTRIES) {
    try {
      entries.createEntry({ ...sample, remark: 'Sample data' }, null);
      created += 1;
    } catch (err) {
      // e.g. a sample date is in the future relative to this machine's clock.
      console.warn(`[seed] Skipped sample entry for ${sample.whom}: ${err.message}`);
    }
  }
  return created;
}

module.exports = { seedSampleData };
