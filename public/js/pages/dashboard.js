import { html, setHtml, $, api, fmtDate } from '../lib.js';
import { state } from '../state.js';
import { summaryCards, groupTable, agingTiles } from '../ui.js';
import { mountEntryList } from '../entry-list.js';

export const OPEN_COLUMNS = ['srn', 'entryDate', 'whom', 'particulars', 'amount', 'age', 'status'];
export const CLOSED_COLUMNS = [
  'srn',
  'originalDate',
  'whom',
  'particulars',
  'amount',
  'daysPending',
  'closedDate',
  'closedBy',
  'closingRemark',
  'status',
];
const ALL_COLUMNS = ['srn', 'entryDate', 'whom', 'particulars', 'amount', 'age', 'status', 'closedDate'];

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-sub">
            Suspense position as of <strong data-role="as-of">${fmtDate(state.today)}</strong>. All figures are
            calculated from the latest entries.
          </p>
        </div>
      </div>

      <div data-role="cards"><div class="cards cards--placeholder"></div></div>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Aging Summary</h2>
            <div class="panel-sub">Open entries grouped by days pending. Click a group to list those entries.</div>
          </div>
        </div>
        <div class="panel-body" data-role="aging"></div>
      </section>

      <div data-role="list"></div>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Person-wise Summary</h2>
              <div class="panel-sub">Who holds how much suspense amount. Click a name to see their entries.</div>
            </div>
            <a class="btn btn--sm" href="#/persons">Person Summary</a>
          </div>
          <div data-role="persons"><div class="empty">Loading…</div></div>
        </section>
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Particular-wise Summary</h2>
              <div class="panel-sub">What the suspense amount was given for</div>
            </div>
          </div>
          <div data-role="particulars"><div class="empty">Loading…</div></div>
        </section>
      </div>`
  );

  const listEl = $('[data-role="list"]', main);
  const list = mountEntryList(listEl, {
    id: 'dashboard',
    statusChoices: [
      ['ALL', 'All'],
      ['OPEN', 'Open'],
      ['CLOSED', 'Closed'],
    ],
    defaultStatus: 'OPEN',
    columns: (status) => (status === 'OPEN' ? OPEN_COLUMNS : status === 'CLOSED' ? CLOSED_COLUMNS : ALL_COLUMNS),
    dateField: (status) => (status === 'CLOSED' ? 'closed' : 'entry'),
  });

  const showInTable = (patch) => {
    list.setFilters(patch);
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  $('[data-role="aging"]', main).addEventListener('click', (ev) => {
    const tile = ev.target.closest('[data-age]');
    if (tile) showInTable({ status: 'OPEN', age: tile.dataset.age });
  });

  $('[data-role="persons"]', main).addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-whom]');
    if (row) showInTable({ status: 'ALL', whom: row.dataset.whom });
  });

  async function loadSummary() {
    try {
      const data = await api('GET', '/api/dashboard');
      $('[data-role="as-of"]', main).textContent = fmtDate(data.today);
      setHtml($('[data-role="cards"]', main), summaryCards(data.cards));
      setHtml(
        $('[data-role="persons"]', main),
        groupTable(data.persons, { kind: 'person', limit: 10, rowAttrs: (r) => html`data-whom="${r.name}"` })
      );
      setHtml($('[data-role="particulars"]', main), groupTable(data.particulars, { kind: 'particular', limit: 10 }));
      setHtml($('[data-role="aging"]', main), agingTiles(data.aging));
    } catch (err) {
      setHtml($('[data-role="cards"]', main), html`<div class="empty empty--error">${err.message}</div>`);
    }
  }

  loadSummary();
  return {
    refresh() {
      loadSummary();
      list.reload();
    },
  };
}
