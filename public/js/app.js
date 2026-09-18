// App shell: session bootstrap, header, navigation, hash router and auto-refresh.

import { html, setHtml, $, api, toast, onUnauthorized, isModalOpen, closeAllModals, fmtDate } from './lib.js';
import { state, isLoggedIn, isAdmin, roleLabel, setViewRefresher, setToday } from './state.js';
import { showChangePassword } from './dialogs.js';
import * as dashboardPage from './pages/dashboard.js';
import * as allPage from './pages/all.js';
import * as closedPage from './pages/closed.js';
import * as personsPage from './pages/persons.js';
import * as managePage from './pages/manage.js';
import * as usersPage from './pages/users.js';
import * as loginPage from './pages/login.js';

const AUTO_REFRESH_MS = 60 * 1000;

// Viewers (no login) get the view-only pages: Dashboard, All Suspense, Closed History, Person Summary.
// Manage Entries and Users need an Entry/Admin login.
const ROUTES = {
  dashboard: { page: dashboardPage, title: 'JPM Suspense Amount Dashboard' },
  all: { page: allPage, title: 'All Suspense' },
  manage: { page: managePage, title: 'Manage Entries', needsLogin: true },
  closed: { page: closedPage, title: 'Closed History' },
  persons: { page: personsPage, title: 'Person Summary' },
  users: { page: usersPage, title: 'Users', needsLogin: true, allowed: isAdmin },
  login: { page: loginPage, title: 'Login' },
};

let currentView = null;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = ROUTES[parts[0]] ? parts[0] : 'dashboard';
  let arg = '';
  try {
    arg = parts.slice(1).join('/') ? decodeURIComponent(parts.slice(1).join('/')) : '';
  } catch (_) {
    arg = '';
  }
  return { name, arg };
}

// ---------------------------------------------------------------------------
// Header & navigation
// ---------------------------------------------------------------------------

function renderHeader() {
  setHtml($('#asOf'), fmtDate(state.today));
  const u = state.user;
  setHtml(
    $('#userArea'),
    u
      ? html`<div class="user-chip">
            <span class="user-name">${u.displayName}</span>
            <span class="user-role">${roleLabel(u.role)}</span>
          </div>
          <button type="button" class="btn btn--topbar" data-act="change-password">
            <span class="hide-xs">Change </span>Password
          </button>
          <button type="button" class="btn btn--topbar" data-act="logout">Logout</button>`
      : html`<span class="user-role user-role--view">View only</span>
          <a class="btn btn--topbar" href="#/login">Entry / Admin Login</a>`
  );

  const items = [
    ['dashboard', 'Dashboard'],
    ['all', 'All Suspense'],
    ...(isLoggedIn() ? [['manage', 'Manage Entries']] : []),
    ['closed', 'Closed History'],
    ['persons', 'Person Summary'],
    ...(isAdmin() ? [['users', 'Users']] : []),
  ];
  const active = parseHash().name;
  setHtml(
    $('#nav'),
    html`<div class="nav-inner">
      ${items.map(
        ([key, label]) =>
          html`<a href="#/${key}" class="nav-link ${active === key ? 'is-active' : ''}" ${active === key
            ? html`aria-current="page"`
            : ''}>${label}</a>`
      )}
    </div>`
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function route() {
  const { name, arg } = parseHash();
  const r = ROUTES[name];

  if (r.needsLogin && !isLoggedIn()) {
    location.hash = '#/login';
    return;
  }
  if (r.allowed && !r.allowed()) {
    location.hash = '#/dashboard';
    return;
  }
  if (name === 'login' && isLoggedIn()) {
    location.hash = '#/manage';
    return;
  }

  // Close any dialogs left open from the previous page.
  closeAllModals();

  document.title = name === 'dashboard' ? r.title : `${r.title} — JPM Suspense Amount Dashboard`;
  renderHeader();

  const main = $('#app');
  const fresh = main.cloneNode(false); // drop old page event listeners
  main.replaceWith(fresh);
  currentView = r.page.render(fresh, { name: arg }, { onLoggedIn });
  if (name !== 'persons' || !arg) window.scrollTo(0, 0);
}

/** Navigate, re-rendering even when the hash is already the target. */
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function refreshCurrent() {
  if (currentView && currentView.refresh) currentView.refresh();
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function onLoggedIn(user) {
  state.user = user;
  if (user.mustChangePassword) {
    renderHeader();
    promptForcedPasswordChange();
    return;
  }
  toast(`Welcome, ${user.displayName}.`);
  go('#/manage');
}

function promptForcedPasswordChange() {
  showChangePassword({
    forced: true,
    onDone(user) {
      state.user = user;
      go('#/manage');
    },
    onLogout: logout,
  });
}

async function logout() {
  try {
    await api('POST', '/api/auth/logout', {});
  } catch (_) {
    /* already logged out */
  }
  state.user = null;
  toast('Logged out.');
  go('#/dashboard');
}

onUnauthorized((err) => {
  if (err.code === 'PASSWORD_CHANGE_REQUIRED') {
    if (!isModalOpen()) promptForcedPasswordChange();
    return;
  }
  if (!state.user) return;
  state.user = null;
  toast('Your session has ended. Please log in again.', 'error');
  go('#/login');
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function start() {
  try {
    const boot = await api('GET', '/api/bootstrap');
    Object.assign(state, {
      user: boot.user,
      today: boot.today,
      ageBuckets: boot.ageBuckets,
      defaultParticulars: boot.defaultParticulars,
    });
  } catch (err) {
    setHtml($('#app'), html`<div class="empty empty--error empty--tall">${err.message}</div>`);
    return;
  }

  setViewRefresher(refreshCurrent);

  $('#userArea').addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'logout') logout();
    if (act.dataset.act === 'change-password') {
      showChangePassword({
        onDone(user) {
          state.user = user;
        },
      });
    }
  });

  window.addEventListener('hashchange', route);
  route();
  if (state.user && state.user.mustChangePassword) promptForcedPasswordChange();

  // Keep the screen current: ages grow daily and other staff may change entries.
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || isModalOpen()) return;
    try {
      const boot = await api('GET', '/api/bootstrap');
      const userChanged = (boot.user && boot.user.id) !== (state.user && state.user.id);
      setToday(boot.today);
      if (userChanged) {
        state.user = boot.user;
        route();
        return;
      }
      $('#asOf').textContent = fmtDate(state.today);
      refreshCurrent();
    } catch (_) {
      /* network hiccup; try again next tick */
    }
  }, AUTO_REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isModalOpen()) refreshCurrent();
  });
}

start();
