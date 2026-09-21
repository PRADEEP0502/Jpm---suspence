import { html, setHtml, $, api, fmtMoney, fmtDays, plural } from '../lib.js';
import { mountEntryList } from '../entry-list.js';

// The person is already named in the panel heading, so the Given To column is left out here.
const PERSON_PENDING_COLUMNS = ['srn', 'entryDate', 'particulars', 'amount', 'returned', 'balance', 'age', 'status'];
const PERSON_ALL_COLUMNS = [...PERSON_PENDING_COLUMNS, 'closedDate'];

export function render(main, params) {
  const selected = params.name || '';
  let persons = [];
  let entryList = null;

  setHtml(
    main,
    html`<div class="page-head">
        <div>
          <h1 class="page-title">Person Summary</h1>
          <p class="page-sub">How much each person was given, has returned and still owes. Select a person to see their entries.</p>
        </div>
      </div>
      <div class="person-layout">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2 class="panel-title">Persons</h2>
              <div class="panel-sub" data-role="count"></div>
            </div>
          </div>
          <div class="toolbar">
            <div class="search">
              <input type="search" data-role="find" placeholder="Find a person" aria-label="Find a person" />
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
    const shown = term ? persons.filter((p) => p.name.toLowerCase().includes(term)) : persons;
    $('[data-role="count"]', main).textContent = plural(persons.length, 'person');
    if (!shown.length) {
      setHtml($('[data-role="persons"]', main), html`<div class="empty">${persons.length ? 'No matching person.' : 'No entries yet.'}</div>`);
      return;
    }
    setHtml(
      $('[data-role="persons"]', main),
      html`<div class="table-wrap">
        <table class="data-table data-table--compact">
          <thead>
            <tr>
              <th scope="col">Person</th>
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
                <td data-label="Person"><div>
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
        html`<section class="panel"><div class="empty empty--tall">Select a person from the list to see all their suspense entries.</div></section>`
      );
      return;
    }
    const p = persons.find((x) => x.name.toLowerCase() === selected.toLowerCase());
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
        <div class="card-meta">${plural(p.totalCount, 'entry', 'entries')}</div>
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
                <div class="panel-sub">Suspense summary for this person</div>
              </div>
              <a class="btn btn--sm" href="#/persons">Clear selection</a>
            </div>
            <div class="panel-body" data-role="person-cards"></div>
          </section>
          <div data-role="person-entries"></div>`
      );
      entryList = mountEntryList($('[data-role="person-entries"]', detail), {
        id: `person:${p.name.toLowerCase()}`,
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
        fixed: { whom: p.name },
        actions: true,
      });
      if (window.innerWidth < 960) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setHtml($('[data-role="person-cards"]', detail), cardsHtml);
  }

  async function load() {
    try {
      const data = await api('GET', '/api/dashboard');
      persons = data.persons;
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
