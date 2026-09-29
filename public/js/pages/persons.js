import { html, setHtml, $, api, fmtMoney, fmtDays, plural } from '../lib.js';
import { mountEntryList } from '../entry-list.js';

// A holder doesn't always match Given To (an entry may have been reassigned to them), so Given To
// stays in the table here even though the holder is already named in the panel heading.
const PERSON_PENDING_COLUMNS = ['srn', 'entryDate', 'whom', 'particulars', 'amount', 'returned', 'balance', 'age', 'status'];
const PERSON_ALL_COLUMNS = [...PERSON_PENDING_COLUMNS, 'closedDate'];

export function render(main, params) {
  const selected = params.name || '';
  let holders = [];
  let entryList = null;

  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Holder Summary</h1>
          <p class="page-sub">
            How much each person currently holds, has returned and still owes. Select a holder to see their entries.
          </p>
        </div>
      </div>
      <div class="person-layout">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Holders</h2>
              <div class="panel-sub" data-role="count"></div>
            </div>
          </div>
          <div class="toolbar">
            <div class="search">
              <input type="search" data-role="find" placeholder="Find a holder" aria-label="Find a holder" />
            </div>
          </div>
          <div data-role="persons"><div class="empty">Loading…</div></div>
        </section>
        <div class="person-detail" data-role="detail"></div>
      </div>`
  );

  const findInput = $('[data-role="find"]', main);

  function renderPersons() {
    const term = findInput.value.trim().toLowerCase();
    const shown = term ? holders.filter((p) => p.name.toLowerCase().includes(term)) : holders;
    $('[data-role="count"]', main).textContent = plural(holders.length, 'holder');
    if (!shown.length) {
      setHtml($('[data-role="persons"]', main), html`<div class="empty">${holders.length ? 'No matching holder.' : 'No entries yet.'}</div>`);
      return;
    }
    setHtml(
      $('[data-role="persons"]', main),
      html`<div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th scope="col">Holder</th>
              <th scope="col" class="num">Original</th>
              <th scope="col" class="num">Returned</th>
              <th scope="col" class="num">Balance</th>
              <th scope="col" class="num">Open Entries</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map((p) => {
              const isSel = p.name.toLowerCase() === selected.toLowerCase();
              const href = `#/persons/${encodeURIComponent(p.name)}`;
              return html`<tr class="is-clickable ${isSel ? 'is-selected' : ''}" data-href="${href}">
                <td data-label="Holder"><div>
                  <a class="row-link" href="${href}" ${isSel ? html`aria-current="true"` : ''}>${p.name}</a>
                  <div class="cell-sub">
                    ${plural(p.totalCount, 'entry', 'entries')}${p.pendingCount
                      ? ` · longest waiting ${fmtDays(p.oldestPendingDays)}`
                      : ''}
                  </div>
                </div></td>
                <td data-label="Original" class="num">${fmtMoney(p.originalAmountPaise)}</td>
                <td data-label="Returned" class="num ${p.returnedAmountPaise ? '' : 'muted'}">${fmtMoney(p.returnedAmountPaise)}</td>
                <td data-label="Balance" class="num ${p.balanceAmountPaise ? 'strong' : 'muted'}">${fmtMoney(p.balanceAmountPaise)}</td>
                <td data-label="Open Entries" class="num ${p.pendingCount ? 'strong' : 'muted'}">${p.pendingCount}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>`
    );
  }

  function renderDetail() {
    const detail = $('[data-role="detail"]', main);
    if (!selected) {
      setHtml(
        detail,
        html`<section class="panel"><div class="empty empty--tall">Select a holder from the list to see all their suspense entries.</div></section>`
      );
      return;
    }
    const p = holders.find((x) => x.name.toLowerCase() === selected.toLowerCase());
    if (!p) {
      setHtml(
        detail,
        html`<section class="panel"><div class="empty empty--tall">No entries found for “${selected}”.</div></section>`
      );
      return;
    }

    const cardsHtml = html`<div class="cards cards--compact">
      <div class="card card--open">
        <div class="card-label">Balance Amount</div>
        <div class="card-value">${fmtMoney(p.balanceAmountPaise)}</div>
        <div class="card-meta">${plural(p.pendingCount, 'entry', 'entries')} open</div>
      </div>
      <div class="card card--closed">
        <div class="card-label">Returned Amount</div>
        <div class="card-value">${fmtMoney(p.returnedAmountPaise)}</div>
        <div class="card-meta">${plural(p.closedCount, 'entry', 'entries')} fully returned</div>
      </div>
      <div class="card">
        <div class="card-label">Original Amount</div>
        <div class="card-value">${fmtMoney(p.originalAmountPaise)}</div>
        <div class="card-meta">${plural(p.totalCount, 'entry', 'entries')} currently held</div>
      </div>
      <div class="card">
        <div class="card-label">Longest Waiting</div>
        <div class="card-value">${p.pendingCount ? fmtDays(p.oldestPendingDays) : '—'}</div>
        <div class="card-meta">${p.pendingCount ? 'since the amount was given' : 'Nothing pending'}</div>
      </div>
    </div>`;

    if (!$('[data-role="person-cards"]', detail)) {
      setHtml(
        detail,
        html`<section class="panel">
            <div class="panel-head">
              <div>
                <h2 class="panel-title">${p.name}</h2>
                <div class="panel-sub">Suspense summary for entries this holder currently has</div>
              </div>
              <a class="btn btn--sm" href="#/persons">Clear selection</a>
            </div>
            <div class="panel-body" data-role="person-cards"></div>
          </section>
          <div data-role="person-entries"></div>`
      );
      entryList = mountEntryList($('[data-role="person-entries"]', detail), {
        id: `holder:${p.name.toLowerCase()}`,
        title: (status) =>
          ({ PENDING: 'Open', OPEN: 'Open', PARTIAL: 'Partially Settled', CLOSED: 'Closed' })[status]
            ? `${{ PENDING: 'Open', OPEN: 'Open', PARTIAL: 'Partially Settled', CLOSED: 'Closed' }[status]} Entries — ${p.name}`
            : `All Entries — ${p.name}`,
        statusChoices: [
          ['ALL', 'All'],
          ['OPEN', 'Open'],
          ['PARTIAL', 'Partially Settled'],
          ['CLOSED', 'Closed'],
        ],
        defaultStatus: 'ALL',
        columns: (status) => (status === 'CLOSED' ? PERSON_ALL_COLUMNS : PERSON_ALL_COLUMNS),
        fixed: { holder: p.name },
        actions: true,
      });
      if (window.innerWidth < 960) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setHtml($('[data-role="person-cards"]', detail), cardsHtml);
  }

  async function load() {
    try {
      const data = await api('GET', '/api/dashboard');
      holders = data.holders;
      renderPersons();
      renderDetail();
    } catch (err) {
      setHtml($('[data-role="persons"]', main), html`<div class="empty empty--error">${err.message}</div>`);
    }
  }

  findInput.addEventListener('input', renderPersons);
  $('[data-role="persons"]', main).addEventListener('click', (ev) => {
    const row = ev.target.closest('tr[data-href]');
    if (row && !ev.target.closest('a')) location.hash = row.dataset.href;
  });

  load();
  return {
    refresh() {
      load();
      if (entryList) entryList.reload();
    },
  };
}
