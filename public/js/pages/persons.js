import { html, setHtml, $, api, fmtMoney, fmtDays } from '../lib.js';
import { state } from '../state.js';
import { mountEntryList } from '../entry-list.js';

/**
 * Holder Summary: one table answering "who has how much pending?".
 * Rows come from /api/dashboard (grouped by current holder, scoped by the server to what this
 * user may see). #/persons/<name> opens one holder's details and entries.
 */

const DETAIL_COLUMNS = ['srn', 'entryDate', 'particulars', 'amount', 'returned', 'balance', 'age', 'currentHolder', 'status'];

// Search / filters / sort survive going to a holder's details and back.
const view = { q: '', status: 'ALL', age: '', sort: { key: 'balance', dir: 'desc' } };

const SORTS = {
  name: (h) => h.name.toLowerCase(),
  entries: (h) => h.totalCount,
  balance: (h) => h.balanceAmountPaise,
  pending: (h) => h.pendingCount,
  age: (h) => (h.pendingCount ? h.oldestPendingDays : -1),
};

const isClear = (h) => !h.balanceAmountPaise;
const statusBadge = (h) =>
  isClear(h) ? html`<span class="badge badge--closed">Clear</span>` : html`<span class="badge badge--partial">Pending</span>`;
const holderHref = (name) => `#/persons/${encodeURIComponent(name)}`;

function statStrip(items) {
  return html`<dl class="stat-strip">
    ${items.map(([label, value]) => html`<div><dt>${label}</dt><dd>${value}</dd></div>`)}
  </dl>`;
}

export function render(main, params) {
  return params.name ? renderDetail(main, params.name) : renderList(main);
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

function renderList(main) {
  let holders = null;

  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Holder Summary</h1>
          <p class="page-sub">See who has pending amounts and how long they have been pending.</p>
        </div>
      </div>
      <div data-role="totals"></div>
      <section class="panel">
        <div class="toolbar">
          <div class="search">
            <input type="search" data-role="q" placeholder="Search holder…" aria-label="Search holder" />
          </div>
          <select class="holder-filter" data-role="status" aria-label="Status">
            <option value="ALL">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="CLEAR">Clear</option>
          </select>
          <select class="holder-filter" data-role="age" aria-label="Age">
            <option value="">All ages</option>
            ${state.ageBuckets.map((b) => html`<option value="${b.key}">${b.label}</option>`)}
          </select>
        </div>
        <div data-role="table"><div class="empty">Loading…</div></div>
      </section>`
  );

  const q = $('[data-role="q"]', main);
  const statusSel = $('[data-role="status"]', main);
  const ageSel = $('[data-role="age"]', main);
  q.value = view.q;
  statusSel.value = view.status;
  ageSel.value = view.age;

  function shown() {
    const term = view.q.trim().toLowerCase();
    const bucket = state.ageBuckets.find((b) => b.key === view.age);
    const rows = holders.filter((h) => {
      if (term && !h.name.toLowerCase().includes(term)) return false;
      if (view.status === 'PENDING' && isClear(h)) return false;
      if (view.status === 'CLEAR' && !isClear(h)) return false;
      if (bucket) {
        if (!h.pendingCount) return false;
        const d = h.oldestPendingDays;
        if (d < bucket.min || (bucket.max !== null && d > bucket.max)) return false;
      }
      return true;
    });
    const { key, dir } = view.sort;
    const get = SORTS[key];
    const sign = dir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return c * sign || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
    });
  }

  function th(key, label, cls = '') {
    const active = view.sort.key === key;
    const ariaSort = active ? (view.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return html`<th scope="col" class="${cls}" aria-sort="${ariaSort}">
      <button type="button" class="th-sort ${active ? 'is-active' : ''}" data-sort="${key}">
        ${label}<span class="sort-icon" aria-hidden="true">${active ? (view.sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </button>
    </th>`;
  }

  function renderTotals() {
    const balance = holders.reduce((s, h) => s + h.balanceAmountPaise, 0);
    const pending = holders.reduce((s, h) => s + h.pendingCount, 0);
    setHtml(
      $('[data-role="totals"]', main),
      statStrip([
        ['Total Holders', holders.length],
        ['Total Balance', fmtMoney(balance)],
        ['Total Pending', pending],
      ])
    );
  }

  function renderTable() {
    const box = $('[data-role="table"]', main);
    if (!holders.length) {
      setHtml(box, html`<div class="empty">No holder records found.</div>`);
      return;
    }
    const rows = shown();
    if (!rows.length) {
      setHtml(box, html`<div class="empty">No holders found.</div>`);
      return;
    }
    setHtml(
      box,
      html`<div class="table-wrap">
        <table class="data-table holder-table">
          <thead>
            <tr>
              ${th('name', 'Holder')} ${th('entries', 'Entries', 'num')} ${th('balance', 'Balance', 'num')}
              ${th('pending', 'Pending', 'num')} ${th('age', 'Age', 'num')}
              <th scope="col">Status</th>
              <th scope="col" class="actions">Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (h) => html`<tr class="is-clickable" data-href="${holderHref(h.name)}" tabindex="0">
                <td data-label="Holder"><a class="row-link" href="${holderHref(h.name)}">${h.name}</a></td>
                <td data-label="Entries" class="num">${h.totalCount}</td>
                <td data-label="Balance" class="num">
                  ${h.balanceAmountPaise
                    ? html`<span class="balance-amount">${fmtMoney(h.balanceAmountPaise)}</span>`
                    : html`<span class="muted">${fmtMoney(0)}</span>`}
                </td>
                <td data-label="Pending" class="num ${h.pendingCount ? 'strong' : 'muted'}">${h.pendingCount}</td>
                <td data-label="Age" class="num nowrap ${h.pendingCount ? '' : 'muted'}">
                  ${h.pendingCount ? fmtDays(h.oldestPendingDays) : '—'}
                </td>
                <td data-label="Status">${statusBadge(h)}</td>
                <td class="actions"><a class="btn btn--sm" href="${holderHref(h.name)}">View</a></td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>`
    );
  }

  async function load() {
    try {
      const data = await api('GET', '/api/dashboard');
      holders = data.holders;
      renderTotals();
      renderTable();
    } catch (err) {
      setHtml($('[data-role="table"]', main), html`<div class="empty empty--error">${err.message}</div>`);
    }
  }

  q.addEventListener('input', () => {
    view.q = q.value;
    if (holders) renderTable();
  });
  statusSel.addEventListener('change', () => {
    view.status = statusSel.value;
    if (holders) renderTable();
  });
  ageSel.addEventListener('change', () => {
    view.age = ageSel.value;
    if (holders) renderTable();
  });
  $('[data-role="table"]', main).addEventListener('click', (ev) => {
    const sortBtn = ev.target.closest('[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort;
      view.sort =
        view.sort.key === key
          ? { key, dir: view.sort.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: key === 'name' ? 'asc' : 'desc' };
      renderTable();
      return;
    }
    const row = ev.target.closest('tr[data-href]');
    if (row && !ev.target.closest('a')) location.hash = row.dataset.href;
  });
  $('[data-role="table"]', main).addEventListener('keydown', (ev) => {
    const row = ev.target.closest('tr[data-href]');
    if (row && ev.key === 'Enter') location.hash = row.dataset.href;
  });

  load();
  return { refresh: load };
}

// ---------------------------------------------------------------------------
// One holder: summary + entries
// ---------------------------------------------------------------------------

function renderDetail(main, name) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <a class="back-link" href="#/persons">← Back to Holder Summary</a>
          <h1 class="page-title">${name}</h1>
          <p class="page-sub">Entries currently held by ${name}.</p>
        </div>
      </div>
      <div data-role="totals"></div>
      <div data-role="entries"></div>`
  );

  const list = mountEntryList($('[data-role="entries"]', main), {
    id: `holder:${name.toLowerCase()}`,
    title: (status) =>
      ({ ALL: 'All Entries', OPEN: 'Open Entries', PARTIAL: 'Partially Settled Entries', CLOSED: 'Closed Entries' })[status],
    statusChoices: [
      ['ALL', 'All'],
      ['OPEN', 'Open'],
      ['PARTIAL', 'Partially Settled'],
      ['CLOSED', 'Closed'],
    ],
    defaultStatus: 'ALL',
    columns: () => DETAIL_COLUMNS,
    fixed: { holder: name },
    actions: true,
  });

  async function loadTotals() {
    try {
      const data = await api('GET', '/api/dashboard');
      const h = data.holders.find((x) => x.name.toLowerCase() === name.toLowerCase());
      setHtml(
        $('[data-role="totals"]', main),
        h
          ? statStrip([
              ['Entries', h.totalCount],
              ['Balance', fmtMoney(h.balanceAmountPaise)],
              ['Pending', h.pendingCount],
              ['Oldest Pending', h.pendingCount ? fmtDays(h.oldestPendingDays) : '—'],
            ])
          : html`<div class="empty">No entries are currently held by ${name}.</div>`
      );
    } catch (err) {
      setHtml($('[data-role="totals"]', main), html`<div class="empty empty--error">${err.message}</div>`);
    }
  }

  loadTotals();
  return {
    refresh() {
      loadTotals();
      list.reload();
    },
  };
}
