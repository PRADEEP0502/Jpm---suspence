import { html, setHtml, $ } from '../lib.js';
import { mountEntryList } from '../entry-list.js';
import { OPEN_COLUMNS, CLOSED_COLUMNS } from './dashboard.js';

// Every suspense entry, open and closed, in one register. View-only; click a row for full details.
const ALL_COLUMNS = ['srn', 'entryDate', 'whom', 'particulars', 'amount', 'daysPending', 'status', 'closedDate', 'closedBy'];

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">All Suspense</h1>
          <p class="page-sub">
            Every suspense entry, open and closed. Newest first. Use search and filters to find a record.
          </p>
        </div>
      </div>
      <div data-role="list"></div>`
  );

  const list = mountEntryList($('[data-role="list"]', main), {
    id: 'all',
    statusChoices: [
      ['ALL', 'All'],
      ['OPEN', 'Open'],
      ['CLOSED', 'Closed'],
    ],
    defaultStatus: 'ALL',
    columns: (status) => (status === 'OPEN' ? OPEN_COLUMNS : status === 'CLOSED' ? CLOSED_COLUMNS : ALL_COLUMNS),
    dateField: (status) => (status === 'CLOSED' ? 'closed' : 'entry'),
    defaultSort: () => ({ key: 'srn', dir: 'desc' }),
  });

  return { refresh: () => list.reload() };
}
