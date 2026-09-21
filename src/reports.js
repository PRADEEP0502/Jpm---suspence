'use strict';

/**
 * Reports as CSV files (open in Excel). Only for users with the "reports:view" permission,
 * which the route checks before anything here runs.
 */

const entries = require('./entries');
const { HttpError } = require('./util');

const csvCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formulas typed into free-text fields.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const rupees = (paise) => (paise / 100).toFixed(2);
const dmy = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

const STATUS_LABEL = { OPEN: 'Open', PARTIAL: 'Partially Settled', CLOSED: 'Closed' };

const REPORTS = {
  /** Every entry with its amounts, one row each. */
  async 'all-suspense'(user) {
    const { entries: list } = await entries.listEntries({ status: 'ALL' }, user);
    return toCsv([
      ['SRN', 'Date', 'Given To', 'Particulars', 'Original Amount', 'Returned Amount', 'Balance Amount', 'Age (Days)', 'Status', 'Closed Date', 'Closed By', 'Created By'],
      ...list.map((e) => [
        e.srn, dmy(e.entryDate), e.whom, e.particulars, rupees(e.amountPaise), rupees(e.returnedPaise),
        rupees(e.balancePaise), e.ageDays, STATUS_LABEL[e.status], dmy(e.closedDate), e.closedBy || '', e.createdBy || '',
      ]),
    ]);
  },

  /** Every individual return, with the SRN it belongs to. */
  async 'return-history'(user) {
    const { entries: list } = await entries.listEntries({ status: 'ALL' }, user);
    const rows = [['SRN', 'Given To', 'Original Amount', 'Return Date', 'Returned By', 'Returned Amount', 'Return Remark', 'Recorded By']];
    for (const e of [...list].reverse()) {
      for (const r of e.returns) {
        rows.push([e.srn, e.whom, rupees(e.amountPaise), dmy(r.returnDate), r.returnedBy, rupees(r.amountPaise), r.remark || '', r.recordedBy || '']);
      }
    }
    return toCsv(rows);
  },

  /** Balance still pending, by person. */
  async 'person-wise'(user) {
    const { persons } = await entries.dashboardSummary(user);
    return toCsv([
      ['Person', 'Entries', 'Open Entries', 'Original Amount', 'Returned Amount', 'Balance Amount'],
      ...persons.map((p) => [p.name, p.totalCount, p.pendingCount, rupees(p.originalAmountPaise), rupees(p.returnedAmountPaise), rupees(p.balanceAmountPaise)]),
    ]);
  },

  /** Balance still pending, by how long it has been pending. */
  async aging(user) {
    const { aging } = await entries.dashboardSummary(user);
    return toCsv([
      ['Age Group', 'Level', 'Entries', 'Balance Amount'],
      ...aging.map((a) => [a.label, a.levelLabel, a.count, rupees(a.amountPaise)]),
    ]);
  },
};

const REPORT_LIST = [
  { key: 'all-suspense', title: 'All Suspense', description: 'Every entry with original, returned and balance amounts, age and status.' },
  { key: 'return-history', title: 'Return History', description: 'Every return transaction: date, who returned it, amount and remark, with its SRN.' },
  { key: 'person-wise', title: 'Person-wise Summary', description: 'Original, returned and balance amount for each person.' },
  { key: 'aging', title: 'Aging Summary', description: 'Entries and balance still pending in each age group.' },
];

async function build(key, user) {
  const report = REPORTS[key];
  if (!report) throw new HttpError(404, 'Report not found.');
  return report(user);
}

module.exports = { REPORT_LIST, build };
