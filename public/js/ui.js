// Small presentational building blocks: badges, summary cards, summary tables, aging tiles.

import { html, fmtMoney, fmtDays, plural } from './lib.js';
import { state } from './state.js';

export function statusBadge(entry) {
  if (entry.isDeleted) return html`<span class="badge badge--deleted">Deleted</span>`;
  if (entry.status === 'PARTIAL') return html`<span class="badge badge--partial">Partially Settled</span>`;
  return entry.status === 'OPEN'
    ? html`<span class="badge badge--open">Open</span>`
    : html`<span class="badge badge--closed">Closed</span>`;
}

const bucketLabel = (key) => (state.ageBuckets.find((b) => b.key === key) || {}).label || '';

/** Age pill. Open entries carry an aging level (dot + tint); closed entries show days pending, neutral. */
export function ageBadge(entry, { withLevel = false } = {}) {
  if (entry.status === 'CLOSED') {
    return html`<span class="age age--closed" title="Was pending for ${fmtDays(entry.ageDays)} before closing"
      >${fmtDays(entry.ageDays)}</span
    >`;
  }
  return html`<span class="age age--${entry.ageLevel}" title="${entry.ageLevelLabel} (${bucketLabel(entry.ageBucket)})"
    ><span class="age-dot" aria-hidden="true"></span>${fmtDays(entry.ageDays)}${withLevel
      ? html`<span class="age-level">${entry.ageLevelLabel}</span>`
      : html`<span class="sr-only">, ${entry.ageLevelLabel}</span>`}</span
  >`;
}

/** kpi, when given, turns the card into a shortcut to the entries behind that figure. */
function card(label, value, meta, modifier = '', kpi = null) {
  return html`<div
    class="card ${modifier ? `card--${modifier}` : ''} ${kpi ? 'card--clickable' : ''}"
    ${kpi ? html`data-kpi="${kpi}" role="button" tabindex="0" aria-label="${label}: ${value}. Show these entries."` : ''}
  >
    <div class="card-label">${label}</div>
    <div class="card-value">${value}</div>
    <div class="card-meta">${meta}</div>
  </div>`;
}

const entriesWord = (n) => plural(n, 'entry', 'entries');

/**
 * The five figures management reads first. Everything comes from the database.
 *   Open Amount                  balance of entries with nothing returned yet
 *   Partially Settled Amount     balance still pending on part-returned entries
 *   Closed Amount                what was given in entries that are now fully returned
 *   Open Entries / Partially Settled Entries   how many of each
 */
export function summaryCards(c) {
  return html`<div class="cards" data-role="kpi-cards">
    ${card(
      'Open Amount',
      fmtMoney(c.openAmountPaise),
      `Nothing returned yet · ${entriesWord(c.openCount)}`,
      'open',
      'OPEN'
    )}
    ${card(
      'Partially Settled Amount',
      fmtMoney(c.partialAmountPaise),
      `Balance left of ${fmtMoney(c.partialOriginalPaise)} given`,
      'partial',
      'PARTIAL'
    )}
    ${card(
      'Closed Amount',
      fmtMoney(c.closedAmountPaise),
      `Fully returned · ${entriesWord(c.closedCount)}`,
      'closed',
      'CLOSED'
    )}
    ${card(
      'Open Entries',
      c.openCount,
      c.pendingCount ? `Longest waiting (all pending): ${fmtDays(c.oldestPendingDays)}` : 'Nothing pending',
      '',
      'OPEN'
    )}
    ${card(
      'Partially Settled Entries',
      c.partialCount,
      c.partialCount ? 'Some money returned, balance pending' : 'None',
      '',
      'PARTIAL'
    )}
  </div>`;
}

/** A Normal User's own figures. Clicking a card filters their own entry list below (same page, no navigation). */
export function myCards(c) {
  return html`<div class="cards cards--four" data-role="kpi-cards">
    ${card(
      'Balance Pending',
      fmtMoney(c.totalBalancePaise),
      `Still to be returned · ${entriesWord(c.pendingCount)}`,
      'open',
      'PENDING'
    )}
    ${card(
      'Returned So Far',
      fmtMoney(c.totalReturnedPaise),
      `Of ${fmtMoney(c.totalOriginalPaise)} originally given`,
      'closed',
      'ALL'
    )}
    ${card('Open Entries', c.openCount, c.openCount ? 'Nothing returned yet' : 'None', '', 'OPEN')}
    ${card('Partially Settled', c.partialCount, c.partialCount ? 'Part returned, balance pending' : 'None', '', 'PARTIAL')}
  </div>`;
}

/**
 * Person-wise / particular-wise summary:
 * Given To (or Particulars) | Original Amount | Returned Amount | Balance Amount.
 * rowAttrs(row) may return attributes (e.g. data-whom) that make a row clickable.
 */
export function groupTable(rows, { kind, limit = 0, rowAttrs = null }) {
  const shown = limit ? rows.slice(0, limit) : rows;
  const nameLabel = kind === 'person' ? 'Given To' : 'Particulars';
  // Short labels: the panel heading already says what the table is about.
  const amountCols = [
    ['Original', 'originalAmountPaise'],
    ['Returned', 'returnedAmountPaise'],
    ['Balance', 'balanceAmountPaise'],
  ];
  const sum = (key) => rows.reduce((s, r) => s + r[key], 0);

  if (!rows.length) return html`<div class="empty">No entries yet.</div>`;

  return html`<div class="table-wrap">
    <table class="data-table data-table--compact">
      <thead>
        <tr>
          <th scope="col">${nameLabel}</th>
          ${amountCols.map(([label]) => html`<th scope="col" class="num">${label}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${shown.map(
          (r) => html`<tr class="${rowAttrs ? 'is-clickable' : ''}" ${rowAttrs ? rowAttrs(r) : ''}>
            <td data-label="${nameLabel}"><div>
              <span class="${rowAttrs ? 'row-link' : 'strong'}">${r.name}</span>
              <div class="cell-sub">${plural(r.totalCount, 'entry', 'entries')}${r.pendingCount
                ? ` · ${r.pendingCount} pending`
                : ''}</div>
            </div></td>
            ${amountCols.map(
              ([label, key]) =>
                html`<td data-label="${label}" class="num ${key === 'balanceAmountPaise' && r[key] ? 'strong' : ''} ${r[key]
                  ? ''
                  : 'muted'}">${fmtMoney(r[key])}</td>`
            )}
          </tr>`
        )}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total${limit && rows.length > limit ? ` (all ${rows.length})` : ''}</th>
          ${amountCols.map(([label, key]) => html`<td data-label="${label}" class="num">${fmtMoney(sum(key))}</td>`)}
        </tr>
      </tfoot>
    </table>
  </div>`;
}

/** Five aging tiles for open entries; each is a button that filters the open table. */
export function agingTiles(aging) {
  const openTotal = aging.reduce((s, a) => s + a.amountPaise, 0);
  return html`<div class="aging">
    ${aging.map((a) => {
      const exact = openTotal ? (a.amountPaise / openTotal) * 100 : 0;
      const pct = Math.round(exact);
      const pctLabel = a.amountPaise && pct === 0 ? '<1' : String(pct);
      return html`<button
        type="button"
        class="aging-tile aging-tile--${a.level} ${a.count ? '' : 'is-empty'}"
        data-age="${a.key}"
        title="Show open entries aged ${a.label}"
      >
        <span class="aging-range">${a.label}</span>
        <span class="level level--${a.level}"><span class="age-dot" aria-hidden="true"></span>${a.levelLabel}</span>
        <span class="aging-amount">${fmtMoney(a.amountPaise)}</span>
        <span class="aging-count">${plural(a.count, 'entry', 'entries')}</span>
        <span class="meter" aria-hidden="true"><span style="width:${a.amountPaise ? Math.max(exact, 1) : 0}%"></span></span>
        <span class="aging-share">${pctLabel}% of pending balance</span>
      </button>`;
    })}
  </div>`;
}
