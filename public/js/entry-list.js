// Reusable entries table with search, status switch, filters, sorting and row actions.

import { html, setHtml, $, $$, api, toQuery, debounce, fmtMoney, fmtDate, fmtDateTime, plural } from './lib.js';
import { state, can } from './state.js';
import { statusBadge, ageBadge } from './ui.js';
import { showEntryDetail, showEntryForm, showReturnDialog, restoreEntry } from './dialogs.js';

const COLUMNS = {
  srn: {
    label: 'SRN',
    sort: (e) => e.srnNo,
    cell: (e) => html`<span class="srn">${e.srn}</span>`,
  },
  entryDate: { label: 'Date', sort: (e) => e.entryDate, cell: (e) => fmtDate(e.entryDate), cls: 'nowrap' },
  originalDate: { label: 'Original Date', sort: (e) => e.entryDate, cell: (e) => fmtDate(e.entryDate), cls: 'nowrap' },
  whom: { label: 'Given To', sort: (e) => e.whom.toLowerCase(), cell: (e) => html`<span class="whom">${e.whom}</span>` },
  particulars: { label: 'Particulars', sort: (e) => e.particulars.toLowerCase(), cell: (e) => e.particulars },
  amount: {
    label: 'Original Amount',
    sort: (e) => e.amountPaise,
    cell: (e) => html`<span class="amount">${fmtMoney(e.amountPaise)}</span>`,
    cls: 'num',
  },
  returned: {
    label: 'Returned Amount',
    sort: (e) => e.returnedPaise,
    cell: (e) =>
      e.returnedPaise
        ? html`<span class="returned">${fmtMoney(e.returnedPaise)}</span>`
        : html`<span class="muted">${fmtMoney(0)}</span>`,
    cls: 'num',
  },
  balance: {
    label: 'Balance Amount',
    sort: (e) => e.balancePaise,
    cell: (e) =>
      e.balancePaise
        ? html`<span class="amount">${fmtMoney(e.balancePaise)}</span>`
        : html`<span class="muted">${fmtMoney(0)}</span>`,
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
  // Closed History wording
  returnedTotal: {
    label: 'Total Returned',
    sort: (e) => e.returnedPaise,
    cell: (e) => html`<span class="returned">${fmtMoney(e.returnedPaise)}</span>`,
    cls: 'num',
  },
  balanceShort: {
    label: 'Balance',
    sort: (e) => e.balancePaise,
    cell: (e) => html`<span class="muted">${fmtMoney(e.balancePaise)}</span>`,
    cls: 'num',
  },
  finalAge: { label: 'Final Age', sort: (e) => e.ageDays, cell: (e) => ageBadge(e) },
  deleted: {
    label: 'Deleted',
    sort: (e) => e.deletedAt || '',
    cell: (e) => html`${fmtDateTime(e.deletedAt)}<div class="cell-sub">by ${e.deletedBy}: ${e.deleteReason}</div>`,
  },
  actions: { label: 'Action', cls: 'actions', cell: (e) => rowActions(e) },
};

// Wording for the Sort dropdown shown with the card layout (phones / narrow screens).
const SORT_WORDS = {
  srn: { desc: 'newest first', asc: 'oldest first' },
  age: { desc: 'oldest first', asc: 'newest first' },
  daysPending: { desc: 'longest first', asc: 'shortest first' },
  amount: { desc: 'high to low', asc: 'low to high' },
  returned: { desc: 'high to low', asc: 'low to high' },
  balance: { desc: 'high to low', asc: 'low to high' },
  entryDate: { desc: 'latest first', asc: 'earliest first' },
  originalDate: { desc: 'latest first', asc: 'earliest first' },
  closedDate: { desc: 'latest first', asc: 'earliest first' },
  deleted: { desc: 'latest first', asc: 'earliest first' },
};
const TEXT_SORT_WORDS = { asc: 'A to Z', desc: 'Z to A' };

// Below this width entries are always shown as cards; above it, cards are used only if the table doesn't fit.
const CARD_BREAKPOINT = 760;

/** Card version of a table row: who / what / amount / date / age / status at a glance. */
function entryCard(e, keys) {
  const closed = e.status === 'CLOSED';
  return html`<article class="entry-card ${closed ? 'is-closed' : ''}" data-id="${e.id}" tabindex="0">
    <div class="ec-row">
      <span class="srn">${e.srn}</span>
      ${statusBadge(e)}
    </div>
    <div class="ec-row ec-row--main">
      <div class="ec-who">
        ${keys.includes('whom') ? html`<div class="whom">${e.whom}</div>` : ''}
        <div class="ec-what">${e.particulars}</div>
      </div>
      <div class="ec-amount">
        ${fmtMoney(closed ? e.amountPaise : e.balancePaise)}
        ${!closed && e.returnedPaise ? html`<span class="ec-amount-note">balance</span>` : ''}
      </div>
    </div>
    ${e.returnedPaise && !closed
      ? html`<div class="ec-row ec-row--meta">
          <span>Original ${fmtMoney(e.amountPaise)}</span>
          <span>Returned ${fmtMoney(e.returnedPaise)}</span>
        </div>`
      : ''}
    <div class="ec-row ec-row--meta">
      <span>Given ${fmtDate(e.entryDate)}</span>
      ${ageBadge(e)}
    </div>
    ${closed
      ? html`<div class="ec-note">Closed ${fmtDate(e.closedDate)}${e.closedBy ? ` by ${e.closedBy}` : ''}</div>`
      : ''}
    ${e.isDeleted
      ? html`<div class="ec-note">Deleted ${fmtDateTime(e.deletedAt)} by ${e.deletedBy}: ${e.deleteReason}</div>`
      : ''}
    ${keys.includes('actions') ? html`<div class="ec-actions">${rowActions(e)}</div>` : ''}
  </article>`;
}

/** Row buttons: only the ones this user is allowed to use. Every entry can be viewed. */
function rowActions(e) {
  if (e.isDeleted) {
    return can('entries:delete') ? html`<button type="button" class="btn btn--sm" data-row-act="restore">Restore</button>` : '';
  }
  const pending = e.status !== 'CLOSED';
  return html`<button type="button" class="btn btn--sm" data-row-act="view">View</button>
    ${pending && can('entries:edit') ? html`<button type="button" class="btn btn--sm" data-row-act="edit">Edit</button>` : ''}
    ${pending && can('entries:return')
      ? html`<button type="button" class="btn btn--sm btn--primary-ghost" data-row-act="return">Add Return</button>`
      : ''}`;
}

const STATUS_TITLES = {
  PENDING: 'Pending Suspense',
  OPEN: 'Open Entries (nothing returned yet)',
  PARTIAL: 'Partially Settled Entries',
  CLOSED: 'Closed Entries',
  ALL: 'All Suspense Entries',
  DELETED: 'Deleted Entries',
};

// Search box + the filters behind the Filters button (Given To, Date, Age, Amount).
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

  // The Action column appears wherever staff work with entries (View, plus Edit / Add Return if allowed).
  const showActions = () => cfg.actions && can('entries:viewAll');
  const columnKeys = () => [...cfg.columns(st.status), ...(showActions() ? ['actions'] : [])];
  const defaultSort = () => {
    if (cfg.defaultSort) return cfg.defaultSort(st.status);
    if (['OPEN', 'PARTIAL', 'PENDING'].includes(st.status)) return { key: 'age', dir: 'desc' };
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
            placeholder="Search by SRN, name or particulars"
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
        <div class="sort-mobile">
          <label for="${cfg.id}-sort">Sort</label>
          <select id="${cfg.id}-sort" data-role="sort"></select>
        </div>
        <button type="button" class="btn btn--link" data-role="clear" hidden>Clear filters</button>
      </div>

      <div class="filters" data-role="filters" hidden>
        ${cfg.fixed.whom || cfg.noWhomFilter
          ? ''
          : html`<div class="field">
              <label for="${cfg.id}-whom">Given To</label>
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
      whom: cfg.noWhomFilter ? '' : cfg.fixed.whom || st.whom,
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
        cfg.noWhomFilter ? Promise.resolve({ persons: [] }) : api('GET', '/api/lookups'),
      ]);
      if (seq !== requestSeq) return; // a newer request is on its way
      rows = data.entries;
      totals = data.totals;
      loaded = true;
      if (!cfg.noWhomFilter) fillSelect($('[data-f="whom"]', container), lookups.persons, 'Everyone');
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

    const sub =
      totals.balancePaise > 0
        ? `${plural(totals.count, 'entry', 'entries')} · Balance ${fmtMoney(totals.balancePaise)} of ${fmtMoney(totals.amountPaise)} given`
        : `${plural(totals.count, 'entry', 'entries')} · ${fmtMoney(totals.amountPaise)} returned in full`;
    el('sub').textContent = sub + (filtered ? ' (filtered)' : '');

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

    const sorted = sortedRows();
    const sortable = keys.filter((key) => COLUMNS[key].sort);
    setHtml(
      el('sort'),
      sortable.flatMap((key) =>
        ['desc', 'asc'].map((dir) => {
          const words = (SORT_WORDS[key] || TEXT_SORT_WORDS)[dir];
          const value = `${key}:${dir}`;
          return html`<option value="${value}" ${sort.key === key && sort.dir === dir ? html`selected` : ''}>
            ${COLUMNS[key].label} (${words})
          </option>`;
        })
      )
    );

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
            ${sorted.map(
              (e) => html`<tr class="is-clickable ${e.status === 'CLOSED' ? 'is-closed' : ''}" data-id="${e.id}" tabindex="0">
                ${keys.map(
                  (key) =>
                    html`<td class="${COLUMNS[key].cls || ''}" data-label="${COLUMNS[key].label}">${COLUMNS[key].cell(e)}</td>`
                )}
              </tr>`
            )}
          </tbody>
        </table>
      </div>
      <div class="entry-cards">${sorted.map((e) => entryCard(e, keys))}</div>`
    );
    el('foot').textContent =
      `Showing ${plural(totals.count, 'entry', 'entries')} · Original ${fmtMoney(totals.amountPaise)}` +
      ` · Returned ${fmtMoney(totals.returnedPaise)} · Balance ${fmtMoney(totals.balancePaise)}` +
      ' · Tap or click an entry to see full details';
    fitLayout();
  }

  /** Use the table when it fits; otherwise (phones, narrow tablets, very wide tables) show cards. */
  function fitLayout() {
    const panel = $('.entry-list', container);
    if (!panel) return;
    panel.classList.remove('is-cards');
    const wrap = $('.table-wrap', container);
    const tooNarrow = window.innerWidth <= CARD_BREAKPOINT;
    if (tooNarrow || (wrap && wrap.scrollWidth > wrap.clientWidth + 1)) panel.classList.add('is-cards');
  }

  const onResize = debounce(() => {
    if (!document.contains(container)) {
      window.removeEventListener('resize', onResize);
      return;
    }
    fitLayout();
  }, 150);
  window.addEventListener('resize', onResize);

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
    if (ev.target.dataset.role === 'sort') {
      const [key, dir] = ev.target.value.split(':');
      st.sort = { key, dir };
      renderTable();
      return;
    }
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

    const row = t.closest('tr[data-id], .entry-card[data-id]');
    if (!row) return;
    const entry = rows.find((r) => String(r.id) === row.dataset.id);
    if (!entry) return;

    const act = t.closest('[data-row-act]');
    if (act) {
      const actions = {
        edit: () => showEntryForm(entry),
        return: () => showReturnDialog(entry),
        view: () => showEntryDetail(entry),
        restore: () => restoreEntry(entry),
      };
      actions[act.dataset.rowAct]();
      return;
    }
    showEntryDetail(entry);
  });

  container.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || !ev.target.matches('tr[data-id], .entry-card[data-id]')) return;
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
