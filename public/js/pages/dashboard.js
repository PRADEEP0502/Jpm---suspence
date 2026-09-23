import { html, setHtml, $, api } from '../lib.js';
import { setToday } from '../state.js';
import { summaryCards, groupTable, agingTiles } from '../ui.js';
import { mountEntryList } from '../entry-list.js';

// Column sets shared by the other pages.
export const PENDING_COLUMNS = ['srn', 'entryDate', 'whom', 'particulars', 'amount', 'returned', 'balance', 'age', 'status'];
export const ALL_COLUMNS = PENDING_COLUMNS;
// A closed entry has been returned in full: Balance is zero and the age is the final one.
export const CLOSED_COLUMNS = [
  'srn',
  'originalDate',
  'whom',
  'particulars',
  'amount',
  'returnedTotal',
  'balanceShort',
  'finalAge',
  'closedDate',
  'closedBy',
  'status',
];

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-sub">All figures are calculated from the latest entries.</p>
        </div>
      </div>

      <div data-role="cards"><div class="cards cards--placeholder"></div></div>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2 class="panel-title">Aging Summary</h2>
            <div class="panel-sub">Balance still pending, grouped by days pending. Click a group to list those entries.</div>
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
              <div class="panel-sub">Who still owes how much. Click a name to see their entries.</div>
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

  // Money still to come back (Open and Partially Settled). Fully returned entries are in Closed History.
  const listEl = $('[data-role="list"]', main);
  const list = mountEntryList(listEl, {
    id: 'dashboard',
    title: () => 'Pending Suspense',
    defaultStatus: 'PENDING',
    columns: () => PENDING_COLUMNS,
    actions: true,
  });

  $('[data-role="aging"]', main).addEventListener('click', (ev) => {
    const tile = ev.target.closest('[data-age]');
    if (!tile) return;
    list.setFilters({ age: tile.dataset.age });
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Every KPI card is a shortcut to the entries behind its figure.
  const cardsEl = $('[data-role="cards"]', main);
  const openKpi = (kpi) => {
    location.hash = kpi === 'CLOSED' ? '#/closed' : `#/all/${kpi}`;
  };
  cardsEl.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-kpi]');
    if (c) openKpi(c.dataset.kpi);
  });
  cardsEl.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const c = ev.target.closest('[data-kpi]');
    if (!c) return;
    ev.preventDefault();
    openKpi(c.dataset.kpi);
  });

  // A person's full picture (open and closed) is on the Person Summary page.
  $('[data-role="persons"]', main).addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-whom]');
    if (row) location.hash = `#/persons/${encodeURIComponent(row.dataset.whom)}`;
  });

  async function loadSummary() {
    try {
      const data = await api('GET', '/api/dashboard');
      setToday(data.today);
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
