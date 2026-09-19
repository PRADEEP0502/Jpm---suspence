import { html, setHtml, $ } from '../lib.js';
import { isAdmin } from '../state.js';
import { mountEntryList } from '../entry-list.js';
import { showEntryForm } from '../dialogs.js';
import { PENDING_COLUMNS, CLOSED_COLUMNS } from './dashboard.js';

// SRN | Date | Given To | Particulars | Original | Returned | Balance | Age | Status (+ Action).
const DELETED_COLUMNS = ['srn', 'entryDate', 'whom', 'particulars', 'amount', 'returned', 'balance', 'status', 'deleted'];

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Manage Entries</h1>
          <ol class="steps" aria-label="How it works">
            <li><strong>Add</strong> an entry when an amount is given</li>
            <li><strong>Edit</strong> if any detail needs correcting</li>
            <li><strong>Add Return</strong> each time money comes back — it closes itself at zero balance</li>
          </ol>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--primary btn--lg" data-role="add">+ Add Suspense Entry</button>
        </div>
      </div>
      <div data-role="list"></div>`
  );

  const choices = [
    ['PENDING', 'Pending'],
    ['PARTIAL', 'Partially Settled'],
    ['CLOSED', 'Closed'],
    ['ALL', 'All'],
  ];
  if (isAdmin()) choices.push(['DELETED', 'Deleted']);

  const list = mountEntryList($('[data-role="list"]', main), {
    id: 'manage',
    title: (status) =>
      ({
        PENDING: 'Pending Entries',
        PARTIAL: 'Partially Settled Entries',
        CLOSED: 'Closed Entries',
        ALL: 'All Entries',
        DELETED: 'Deleted Entries',
      })[status],
    statusChoices: choices,
    defaultStatus: 'PENDING',
    columns: (status) =>
      status === 'DELETED' ? DELETED_COLUMNS : status === 'CLOSED' ? CLOSED_COLUMNS : PENDING_COLUMNS,
    // Newest first, so a just-added entry is at the top.
    defaultSort: (status) => (status === 'DELETED' ? { key: 'deleted', dir: 'desc' } : { key: 'srn', dir: 'desc' }),
    actions: true,
  });

  $('[data-role="add"]', main).addEventListener('click', () => showEntryForm());

  return { refresh: () => list.reload() };
}
