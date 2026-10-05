import { html, setHtml, $, api } from '../lib.js';
import { state } from '../state.js';
import { myCards } from '../ui.js';
import { mountEntryList } from '../entry-list.js';

// A Money Receiver sees bills given to them and bills they currently hold (the server enforces this).
// They can only assign the ones they hold; everything else is view only.
const MY_COLUMNS = ['srn', 'entryDate', 'whom', 'holder', 'particulars', 'amount', 'returned', 'balance', 'age', 'status'];

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">My Suspense</h1>
          <p class="page-sub">
            Bills given to <strong>${state.user.displayName}</strong> or assigned to them. Tick the bills you hold and press
            Assign to hand them to someone else.
          </p>
        </div>
      </div>
      <div data-role="cards"><div class="cards cards--placeholder"></div></div>
      <div data-role="list"></div>`
  );

  const list = mountEntryList($('[data-role="list"]', main), {
    id: 'my',
    title: (status) =>
      ({ PENDING: 'My Pending Suspense', OPEN: 'My Open Entries', PARTIAL: 'My Partially Settled Entries', ALL: 'All My Entries' })[status] ||
      'My Suspense',
    statusChoices: [
      ['PENDING', 'Pending'],
      ['OPEN', 'Open'],
      ['PARTIAL', 'Partially Settled'],
      ['ALL', 'All'],
    ],
    defaultStatus: 'PENDING',
    columns: () => MY_COLUMNS,
    noWhomFilter: true,
    actions: false,
    ownAssign: true,
  });

  // Each card filters the list below to exactly the entries behind its figure.
  const cardsEl = $('[data-role="cards"]', main);
  const listEl = $('[data-role="list"]', main);
  const applyKpi = (kpi) => {
    list.setFilters({ status: kpi });
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  cardsEl.addEventListener('click', (ev) => {
    const c = ev.target.closest('[data-kpi]');
    if (c) applyKpi(c.dataset.kpi);
  });
  cardsEl.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const c = ev.target.closest('[data-kpi]');
    if (!c) return;
    ev.preventDefault();
    applyKpi(c.dataset.kpi);
  });

  async function loadCards() {
    try {
      const data = await api('GET', '/api/dashboard');
      setHtml($('[data-role="cards"]', main), myCards(data.cards));
    } catch (err) {
      setHtml($('[data-role="cards"]', main), html`<div class="empty empty--error">${err.message}</div>`);
    }
  }

  loadCards();
  return {
    refresh() {
      loadCards();
      list.reload();
    },
  };
}
