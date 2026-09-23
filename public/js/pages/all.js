import { html, setHtml, $ } from '../lib.js';
import { can } from '../state.js';
import { mountEntryList } from '../entry-list.js';
import { showEntryForm } from '../dialogs.js';
import { ALL_COLUMNS, CLOSED_COLUMNS } from './dashboard.js';

const DELETED_COLUMNS = ['srn', 'entryDate', 'whom', 'particulars', 'amount', 'returned', 'balance', 'status', 'deleted'];

// Every suspense entry. Buttons in each row depend on the signed-in user's permissions.
export function render(main, params = {}) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <a class="back-link" href="#/dashboard">← Back to Dashboard</a>
          <h1 class="page-title">All Suspense</h1>
          <p class="page-sub">Every suspense entry, newest first. Click a row to see its full details and return history.</p>
        </div>
        ${can('entries:add')
          ? html`<div class="page-actions">
              <button type="button" class="btn btn--primary btn--lg" data-role="add">+ Add Entry</button>
            </div>`
          : ''}
      </div>
      <div data-role="list"></div>`
  );

  const choices = [
    ['ALL', 'All'],
    ['OPEN', 'Open'],
    ['PARTIAL', 'Partially Settled'],
    ['CLOSED', 'Closed'],
  ];
  if (can('entries:delete')) choices.push(['DELETED', 'Deleted']);

  const list = mountEntryList($('[data-role="list"]', main), {
    id: 'all',
    title: (status) =>
      ({
        ALL: 'All Suspense Entries',
        OPEN: 'Open Entries',
        PARTIAL: 'Partially Settled Entries',
        CLOSED: 'Closed Entries',
        DELETED: 'Deleted Entries',
      })[status],
    statusChoices: choices,
    defaultStatus: 'ALL',
    columns: (status) => (status === 'CLOSED' ? CLOSED_COLUMNS : status === 'DELETED' ? DELETED_COLUMNS : ALL_COLUMNS),
    dateField: (status) => (status === 'CLOSED' ? 'closed' : 'entry'),
    defaultSort: (status) => (status === 'DELETED' ? { key: 'deleted', dir: 'desc' } : { key: 'srn', dir: 'desc' }),
    actions: true,
  });

  // Arriving from a Dashboard KPI card (#/all/OPEN etc.): show exactly that status, nothing else.
  const requested = String(params.name || '').toUpperCase();
  if (choices.some(([value]) => value === requested)) {
    list.setFilters({ status: requested });
  }

  const add = $('[data-role="add"]', main);
  if (add) add.addEventListener('click', () => showEntryForm());

  return { refresh: () => list.reload() };
}
