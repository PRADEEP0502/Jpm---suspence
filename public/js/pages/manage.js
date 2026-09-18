import { html, setHtml, $ } from '../lib.js';
import { isAdmin } from '../state.js';
import { mountEntryList } from '../entry-list.js';
import { showEntryForm } from '../dialogs.js';
import { OPEN_COLUMNS } from './dashboard.js';

// SRN | Date | Given To | Particulars | Amount | Age | Status (+ Action). Open rows: Edit, Close. Closed rows: View.
const DELETED_COLUMNS = ['srn', 'entryDate', 'whom', 'particulars', 'amount', 'status', 'deleted'];

export function render(main) {
  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Manage Entries</h1>
          <ol class="steps" aria-label="How it works">
            <li><strong>Add</strong> an entry when an amount is given</li>
            <li><strong>Edit</strong> if any detail needs correcting</li>
            <li><strong>Close</strong> it once the amount is settled</li>
          </ol>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn--primary btn--lg" data-role="add">+ Add Suspense Entry</button>
        </div>
      </div>
      <div data-role="list"></div>`
  );

  const choices = [
    ['ALL', 'All'],
    ['OPEN', 'Open'],
    ['CLOSED', 'Closed'],
  ];
  if (isAdmin()) choices.push(['DELETED', 'Deleted']);

  const list = mountEntryList($('[data-role="list"]', main), {
    id: 'manage',
    title: (status) =>
      ({ OPEN: 'Open Entries', CLOSED: 'Closed Entries', ALL: 'All Entries', DELETED: 'Deleted Entries' })[status],
    statusChoices: choices,
    defaultStatus: 'OPEN',
    columns: (status) => (status === 'DELETED' ? DELETED_COLUMNS : OPEN_COLUMNS),
    // Newest first, so a just-added entry is at the top.
    defaultSort: (status) => (status === 'DELETED' ? { key: 'deleted', dir: 'desc' } : { key: 'srn', dir: 'desc' }),
    actions: true,
  });

  $('[data-role="add"]', main).addEventListener('click', () => showEntryForm());

  return { refresh: () => list.reload() };
}
