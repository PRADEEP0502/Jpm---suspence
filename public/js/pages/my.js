import { html, setHtml, $, api } from '../lib.js';
import { state } from '../state.js';
import { myCards } from '../ui.js';
import { mountEntryList } from '../entry-list.js';

// A Normal User sees only the money given to them (the server enforces this), view only.
const MY_COLUMNS = ['srn', 'entryDate', 'particulars', 'amount', 'returned', 'balance', 'age', 'status'];

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">My Suspense</h1>
          <p class="page-sub">
            Amounts given to <strong>${state.user.displayName}</strong>: what was given, what has been returned and what
            is still pending. Click a row to see the return history.
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
  });

  async function loadCards() {
    try {
      const data = await api('GET', '/api/dashboard');
      setHtml($('[data-role="cards"]', main), myCards(data.cards));
      const asOf = document.getElementById('asOf');
      if (asOf && data.today) asOf.textContent = data.today.split('-').reverse().join('/');
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
