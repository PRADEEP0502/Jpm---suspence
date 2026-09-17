// Reusable entries table with search, status switch, filters, sorting and row actions.

import { html, setHtml, $, $$, api, toQuery, debounce, fmtMoney, fmtDate, fmtDateTime, plural } from './lib.js';
import { state, canManage, isAdmin } from './state.js';
import { statusBadge, ageBadge } from './ui.js';
import { showEntryDetail, showEntryForm, showCloseDialog, restoreEntry } from './dialogs.js';

const COLUMNS = {
  srn: {
    label: 'SRN',
    sort: (e) => e.srnNo,
    cell: (e) => html`<span class="srn">${e.srn}</span>`,
  },
  entryDate: { label: 'Date', sort: (e) => e.entryDate, cell: (e) => fmtDate(e.entryDate), cls: 'nowrap' },
  originalDate: { label: 'Original Date', sort: (e) => e.entryDate, cell: (e) => fmtDate(e.entryDate), cls: 'nowrap' },
  whom: { label: 'Whom', sort: (e) => e.whom.toLowerCase(), cell: (e) => html`<span class="whom">${e.whom}</span>` },
  particulars: { label: 'What / Particulars', sort: (e) => e.particulars.toLowerCase(), cell: (e) => e.particulars },
  amount: {
    label: 'Amount',
    sort: (e) => e.amountPaise,
    cell: (e) => html`<span class="amount">${fmtMoney(e.amountPaise)}</span>`,
    cls: 'num',
  },
  age: { label: 'Age', sort: (e) => e.ageDays, cell: (e) => ageBadge(e) },
  daysPending: { label: 'Age / Days Pending', sort: (e) => e.ageDays, cell: (e) => ageBadge(e) },
  status: { label: 'Status', sort: (e) => e.status, cell: (e) => statusBadge(e) },
  closedDate: {
    label: 'Closed Date',
    sort: (e) => e.closedDate || '',
    cell: (e) => fmtDate(e.closedDate),
    cls: 'nowrap',
  },
  closedBy: { label: 'Closed By', sort: (e) => (e.closedBy || '').toLowerCase(), cell: (e) => e.closedBy || '—' },
  closingRemark: { label: 'Closing Remark', cell: (e) => e.closingRemark || html`<span class="muted">—</span>` },
  deleted: {
    label: 'Deleted',
    sort: (e) => e.deletedAt || '',
    cell: (e) => html`${fmtDateTime(e.deletedAt)}<div class="cell-sub">by ${e.deletedBy}: ${e.deleteReason}</div>`,
  },
  actions: { label: 'Action', cls: 'actions', cell: (e) => rowActions(e) },
};

function rowActions(e) {
  if (e.isDeleted) {
    return isAdmin() ? html`<button type="button" class="btn btn--sm" data-row-act="restore">Restore</button>` : '';
  }
  if (e.status === 'OPEN') {
    return html`<button type="button" class="btn btn--sm" data-row-act="edit">Edit</button>
      <button type="button" class="btn btn--sm btn--primary-ghost" data-row-act="close">Close</button>`;
  }
  return html`<button type="button" class="btn btn--sm" data-row-act="view">View</button>`;
}

const STATUS_TITLES = {
  OPEN: 'Current Open Suspense',
  CLOSED: 'Closed Entries',
  ALL: 'All Suspense Entries',
  DELETED: 'Deleted Entries',
};

// Search box + the filters behind the Filters button (Whom, Date, Age, Amount).
const FILTER_KEYS = ['whom', 'age', 'dateFrom', 'dateTo', 'amountMin', 'amountMax'];
const EMPTY_FILTERS = { q: '', ...Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) };

// Filter state survives navigating between pages during the session.
const savedStates = new Map();

/**
 * mountEntryList(container, config) -> { reload(), setFilters(patch) }
 *
 * config:
 *   id              key for remembering filters
 *   title(status)   optional heading override
 *   statusChoices   e.g. [['ALL','All'],['OPEN','Open'],['CLOSED','Closed']] or null for a fixed status
 *   defaultStatus   'OPEN' | 'CLOSED' | 'ALL'
 *   columns(status) list of column keys
 *   dateField(status) 'entry' | 'closed'  (which date the date filter applies to)
 *   fixed           filters that are always applied and hidden (e.g. { whom })
 *   actions         show Edit/Close buttons for logged-in staff
 *   headActions     extra buttons in the panel header
 *   onLoaded(data)  callback after each load
 */
export function mountEntryList(container, config) {
  const cfg = {
    statusChoices: null,
    dateField: () => 'entry',
    fixed: {},
    actions: false,
    headActions: '',
    onLoaded: () => {},
    ...config,
  };
  const st = savedStates.get(cfg.id) || { status: cfg.defaultStatus, ...EMPTY_FILTERS, filtersOpen: false, sort: null };
  savedStates.set(cfg.id, st);
  if (cfg.statusChoices && !cfg.statusChoices.some(([v]) => v === st.status)) st.status = cfg.defaultStatus;

  let rows = [];
  let totals = { count: 0, amountPaise: 0 };
  let loaded = false;
  let requestSeq = 0;

  const showActions = () => cfg.actions && canManage();
  const columnKeys = () => [...cfg.columns(st.status), ...(showActions() ? ['actions'] : [])];
  const defaultSort = () => {
    if (cfg.defaultSort) return cfg.defaultSort(st.status);
    if (st.status === 'OPEN') return { key: 'age', dir: 'desc' };
    if (st.status === 'CLOSED') return { key: 'closedDate', dir: 'desc' };
    if (st.status === 'DELETED') return { key: 'deleted', dir: 'desc' };
    return { key: 'srn', dir: 'desc' };
  };

  // ------------------------------------------------------------ skeleton
  setHtml(
    container,
    html`<section class="panel entry-list">
      <div class="panel-head">
        <div>
          <h2 class="panel-title" data-role="title"></h2>
          <div class="panel-sub" data-role="sub"></div>
        </div>
        <div class="panel-actions">${cfg.headActions}</div>
      </div>

      <div class="toolbar">
        <div class="search">
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16">
            <path
              fill="currentColor"
              d="M8.5 3a5.5 5.5 0 1 0 3.47 9.77l3.63 3.63a.75.75 0 1 0 1.06-1.06l-3.63-3.63A5.5 5.5 0 0 0 8.5 3Zm-4 5.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
            />
          </svg>
          <input
            type="search"
            data-f="q"
            placeholder="Search by SRN, whom or particulars"
            aria-label="Search entries"
          />
        </div>
        ${cfg.statusChoices
          ? html`<div class="seg" role="group" aria-label="Status">
              ${cfg.statusChoices.map(
                ([value, label]) => html`<button type="button" data-status="${value}">${label}</button>`
              )}
            </div>`
          : ''}
        <button type="button" class="btn" data-role="toggle-filters" aria-expanded="false">
          Filters<span class="filter-count" data-role="filter-count"></span>
        </button>
        <button type="button" class="btn btn--link" data-role="clear" hidden>Clear filters</button>
      </div>

      <div class="filters" data-role="filters" hidden>
        ${cfg.fixed.whom
          ? ''
          : html`<div class="field">
              <label for="${cfg.id}-whom">Whom</label>
              <select id="${cfg.id}-whom" data-f="whom"><option value="">Everyone</option></select>
            </div>`}
        <div class="field">
          <label for="${cfg.id}-age">Age</label>
          <select id="${cfg.id}-age" data-f="age">
            <option value="">Any age</option>
            ${state.ageBuckets.map((b) => html`<option value="${b.key}">${b.label} (${b.levelLabel})</option>`)}
          </select>
        </div>
        <div class="field">
          <label for="${cfg.id}-from" data-role="date-label-from">Date from</label>
          <input id="${cfg.id}-from" type="date" data-f="dateFrom" />
        </div>
        <div class="field">
          <label for="${cfg.id}-to" data-role="date-label-to">Date to</label>
          <input id="${cfg.id}-to" type="date" data-f="dateTo" />
        </div>
        <div class="field field--amount">
          <label for="${cfg.id}-min">Amount from (₹)</label>
          <input id="${cfg.id}-min" type="text" inputmode="decimal" data-f="amountMin" placeholder="Min" />
        </div>
        <div class="field field--amount">
          <label for="${cfg.id}-max">Amount to (₹)</label>
          <input id="${cfg.id}-max" type="text" inputmode="decimal" data-f="amountMax" placeholder="Max" />
        </div>
      </div>

      <div data-role="table"><div class="empty">Loading…</div></div>
      <div class="table-foot" data-role="foot"></div>
    </section>`
  );

  const el = (role) => $(`[data-role="${role}"]`, container);

  // ------------------------------------------------------------ state -> controls
  function syncControls() {
    $$('[data-f]', container).forEach((input) => {
      if (document.activeElement !== input) input.value = st[input.dataset.f];
    });
    $$('[data-status]', container).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === st.status)));

    const title = cfg.title ? cfg.title(st.status) : STATUS_TITLES[st.status];
    el('title').textContent = title;

    const closedDates = cfg.dateField(st.status) === 'closed';
    el('date-label-from').textContent = closedDates ? 'Closed date from' : 'Date given from';
    el('date-label-to').textContent = closedDates ? 'Closed date to' : 'Date given to';

    const activeCount = FILTER_KEYS.filter((k) => st[k]).length;
    el('filter-count').textContent = activeCount ? ` (${activeCount})` : '';
    el('clear').hidden = !(activeCount || st.q);
    el('filters').hidden = !st.filtersOpen;
    el('toggle-filters').setAttribute('aria-expanded', String(st.filtersOpen));
  }

  function fillSelect(select, values, allLabel) {
    if (!select) return;
    const current = st[select.dataset.f];
    const list = current && !values.some((v) => v.toLowerCase() === current.toLowerCase()) ? [current, ...values] : values;
    setHtml(
      select,
      html`<option value="">${allLabel}</option>
        ${list.map((v) => html`<option value="${v}">${v}</option>`)}`
    );
    select.value = current;
  }

  // ------------------------------------------------------------ data
  async function reload() {
    const seq = ++requestSeq;
    const query = {
      status: st.status,
      q: st.q,
      whom: cfg.fixed.whom || st.whom,
      age: st.age,
      dateFrom: st.dateFrom,
      dateTo: st.dateTo,
      dateField: cfg.dateField(st.status),
      amountMin: st.amountMin,
      amountMax: st.amountMax,
    };
    try {
      const [data, lookups] = await Promise.all([
        api('GET', `/api/entries?${toQuery(query)}`),
        api('GET', '/api/lookups'),
      ]);
      if (seq !== requestSeq) return; // a newer request is on its way
      rows = data.entries;
      totals = data.totals;
      loaded = true;
      fillSelect($('[data-f="whom"]', container), lookups.persons, 'Everyone');
      renderTable();
      cfg.onLoaded(data);
    } catch (err) {
      if (seq !== requestSeq) return;
      if (!loaded) {
        setHtml(
          el('table'),
          html`<div class="empty empty--error">
            ${err.message} <button type="button" class="btn btn--sm" data-role="retry">Try again</button>
          </div>`
        );
      }
    }
  }

  function sortedRows() {
    const sort = st.sort || defaultSort();
    const col = COLUMNS[sort.key];
    if (!col || !col.sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sort(a);
      const vb = col.sort(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.srnNo - b.srnNo;
    });
  }

  function renderTable() {
    syncControls();
    const keys = columnKeys();
    const sort = st.sort || defaultSort();
    const filtered = st.q || FILTER_KEYS.some((k) => st[k]);

    el('sub').textContent = `${plural(totals.count, 'entry', 'entries')} · ${fmtMoney(totals.amountPaise)}${
      filtered ? ' (filtered)' : ''
    }`;

    if (!rows.length) {
      const message = filtered
        ? 'No entries match your search or filters.'
        : st.status === 'OPEN'
          ? 'No open suspense entries. Everything is settled.'
          : st.status === 'CLOSED'
            ? 'No closed entries yet.'
            : st.status === 'DELETED'
              ? 'No deleted entries.'
              : 'No entries yet.';
      setHtml(el('table'), html`<div class="empty">${message}</div>`);
      el('foot').textContent = '';
      return;
    }

    setHtml(
      el('table'),
      html`<div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              ${keys.map((key) => {
                const col = COLUMNS[key];
                const active = sort.key === key;
                const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
                return col.sort
                  ? html`<th scope="col" class="${col.cls || ''}" aria-sort="${ariaSort}">
                      <button type="button" class="th-sort ${active ? 'is-active' : ''}" data-sort="${key}">
                        ${col.label}<span class="sort-icon" aria-hidden="true"
                          >${active ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span
                        >
                      </button>
                    </th>`
                  : html`<th scope="col" class="${col.cls || ''}">${col.label}</th>`;
              })}
            </tr>
          </thead>
          <tbody>
            ${sortedRows().map(
              (e) => html`<tr class="is-clickable ${e.status === 'CLOSED' ? 'is-closed' : ''}" data-id="${e.id}" tabindex="0">
                ${keys.map(
                  (key) =>
                    html`<td class="${COLUMNS[key].cls || ''}" data-label="${COLUMNS[key].label}">${COLUMNS[key].cell(e)}</td>`
                )}
              </tr>`
            )}
          </tbody>
        </table>
      </div>`
    );
    el('foot').textContent = `Showing ${plural(totals.count, 'entry', 'entries')} · Total ${fmtMoney(
      totals.amountPaise
    )} · Click a row to see full details`;
  }

  // ------------------------------------------------------------ events
  const reloadDebounced = debounce(reload, 250);

  container.addEventListener('input', (ev) => {
    const f = ev.target.dataset.f;
    if (!f || ev.target.tagName === 'SELECT') return;
    st[f] = ev.target.value;
    syncControls();
    reloadDebounced();
  });

  container.addEventListener('change', (ev) => {
    const f = ev.target.dataset.f;
    if (!f) return;
    st[f] = ev.target.value;
    syncControls();
    reload();
  });

  container.addEventListener('click', (ev) => {
    const t = ev.target;

    const statusBtn = t.closest('[data-status]');
    if (statusBtn) {
      if (st.status !== statusBtn.dataset.status) {
        st.status = statusBtn.dataset.status;
        st.sort = null;
        rows = [];
        syncControls();
        setHtml(el('table'), html`<div class="empty">Loading…</div>`);
        reload();
      }
      return;
    }
    if (t.closest('[data-role="toggle-filters"]')) {
      st.filtersOpen = !st.filtersOpen;
      syncControls();
      return;
    }
    if (t.closest('[data-role="clear"]')) {
      Object.assign(st, EMPTY_FILTERS);
      syncControls();
      reload();
      return;
    }
    if (t.closest('[data-role="retry"]')) {
      reload();
      return;
    }

    const sortBtn = t.closest('[data-sort]');
    if (sortBtn) {
      const key = sortBtn.dataset.sort;
      const current = st.sort || defaultSort();
      st.sort = { key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' };
      renderTable();
      return;
    }

    const row = t.closest('tr[data-id]');
    if (!row) return;
    const entry = rows.find((r) => String(r.id) === row.dataset.id);
    if (!entry) return;

    const act = t.closest('[data-row-act]');
    if (act) {
      const actions = {
        edit: () => showEntryForm(entry),
        close: () => showCloseDialog(entry),
        view: () => showEntryDetail(entry),
        restore: () => restoreEntry(entry),
      };
      actions[act.dataset.rowAct]();
      return;
    }
    showEntryDetail(entry);
  });

  container.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.target.tagName !== 'TR') return;
    const entry = rows.find((r) => String(r.id) === ev.target.dataset.id);
    if (entry) showEntryDetail(entry);
  });

  syncControls();
  reload();

  return {
    reload,
    setFilters(patch) {
      Object.assign(st, EMPTY_FILTERS, patch);
      if (patch.status) st.sort = null;
      st.filtersOpen = st.filtersOpen || FILTER_KEYS.some((k) => patch[k]);
      syncControls();
      reload();
    },
  };
}
