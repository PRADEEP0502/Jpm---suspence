// App shell: session bootstrap, role-based menus, hash router, live updates and auto-refresh.

import { html, setHtml, $, api, toast, onUnauthorized, isModalOpen, closeAllModals, fmtDate, debounce } from './lib.js';
import { state, isLoggedIn, can, setViewRefresher, setToday } from './state.js';
import { showChangePassword } from './dialogs.js';
import * as dashboardPage from './pages/dashboard.js';
import * as allPage from './pages/all.js';
import * as addPage from './pages/add.js';
import * as closedPage from './pages/closed.js';
import * as personsPage from './pages/persons.js';
import * as myPage from './pages/my.js';
import * as myHistoryPage from './pages/myhistory.js';
import * as profilePage from './pages/profile.js';
import * as usersPage from './pages/users.js';
import * as permissionsPage from './pages/permissions.js';
import * as reportsPage from './pages/reports.js';
import * as settingsPage from './pages/settings.js';
import * as loginPage from './pages/login.js';

const AUTO_REFRESH_MS = 60 * 1000;

/**
 * Every page except the sign-in page needs a signed-in user. `perm` decides who may open it
 * (any one of the listed permissions). This only decides what is SHOWN: the server enforces the
 * same rules on every request, so typing a hidden address never reveals anything.
 */
const ROUTES = {
  login: { page: loginPage, title: 'Sign In', public: true },
  my: { page: myPage, title: 'My Suspense', perm: ['own:view'], label: 'My Suspense' },
  myhistory: { page: myHistoryPage, title: 'My History', perm: ['own:view'], label: 'My History' },
  profile: { page: profilePage, title: 'Profile', perm: ['own:view'], label: 'Profile' },
  dashboard: { page: dashboardPage, title: 'JPM Suspense Amount Dashboard', perm: ['entries:viewAll'], label: 'Dashboard' },
  all: { page: allPage, title: 'All Suspense', perm: ['entries:viewAll'], label: 'All Suspense' },
  add: { page: addPage, title: 'Add Entry', perm: ['entries:add'], label: 'Add Entry' },
  closed: { page: closedPage, title: 'Closed History', perm: ['entries:viewAll'], label: 'Closed History' },
  persons: { page: personsPage, title: 'Person Summary', perm: ['entries:viewAll'], label: 'Person Summary' },
  users: { page: usersPage, title: 'Users', perm: ['users:manage'], label: 'Users' },
  permissions: { page: permissionsPage, title: 'Permissions', perm: ['users:manage'], label: 'Permissions' },
  reports: { page: reportsPage, title: 'Reports', perm: ['reports:view'], label: 'Reports' },
  settings: { page: settingsPage, title: 'Settings', perm: ['system:manage'], label: 'Settings' },
};

// Menu order for each kind of user.
const MENU_FOR_STAFF = ['dashboard', 'all', 'add', 'closed', 'persons', 'users', 'permissions', 'reports', 'settings'];
const MENU_FOR_NORMAL = ['my', 'myhistory', 'profile'];

const mayOpen = (route) => route.public || route.perm.some((p) => can(p));
const menuKeys = () => (can('entries:viewAll') ? MENU_FOR_STAFF : MENU_FOR_NORMAL).filter((k) => mayOpen(ROUTES[k]));
const homeHash = () => (state.user ? state.user.home : '#/login');

let currentView = null;

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = ROUTES[parts[0]] ? parts[0] : null;
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
            <span class="user-role">${u.roleLabel}</span>
          </div>
          <button type="button" class="btn btn--topbar" data-act="change-password">
            <span class="hide-xs">Change Password</span><span class="show-xs">Password</span>
          </button>
          <button type="button" class="btn btn--topbar" data-act="logout">Logout</button>`
      : ''
  );

  const active = parseHash().name;
  setHtml(
    $('#nav'),
    u
      ? html`<div class="nav-inner">
          ${menuKeys().map(
            (key) =>
              html`<a href="#/${key}" class="nav-link ${active === key ? 'is-active' : ''}" ${active === key
                ? html`aria-current="page"`
                : ''}>${ROUTES[key].label}</a>`
          )}
        </div>`
      : ''
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function route() {
  const { name, arg } = parseHash();

  if (!isLoggedIn()) {
    if (name !== 'login') {
      location.hash = '#/login';
      return;
    }
  } else if (state.user.mustChangePassword) {
    // Nothing else opens until the temporary password has been replaced.
    renderHeader();
    setHtml($('#app'), html`<div class="empty empty--tall">Please set a new password to continue.</div>`);
    promptForcedPasswordChange();
    return;
  } else if (!name || name === 'login' || !mayOpen(ROUTES[name])) {
    // Unknown address, sign-in page while signed in, or a page this role does not have: go home.
    if (location.hash !== homeHash()) {
      location.hash = homeHash();
      return;
    }
    if (!name || !mayOpen(ROUTES[name])) return;
  }

  const r = ROUTES[name];
  closeAllModals(); // close any dialogs left open from the previous page
  document.title = `${r.title} — JPM Suspense Amount Dashboard`;
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
    route();
    return;
  }
  toast(`Welcome, ${user.displayName}.`);
  startLiveUpdates();
  go(user.home);
}

function promptForcedPasswordChange() {
  if (isModalOpen()) return;
  showChangePassword({
    forced: true,
    onDone(user) {
      state.user = user;
      startLiveUpdates();
      go(user.home);
    },
    onLogout: logout,
  });
}

async function logout() {
  try {
    await api('POST', '/api/auth/logout', {});
  } catch (_) {
    /* already signed out */
  }
  // Start from a clean page so nothing from this person's session stays in memory on a shared PC.
  location.hash = '#/login';
  location.reload();
}

onUnauthorized((err) => {
  if (err.code === 'PASSWORD_CHANGE_REQUIRED') {
    promptForcedPasswordChange();
    return;
  }
  if (!state.user) return;
  toast('Your session has ended. Please sign in again.', 'error');
  location.hash = '#/login';
  setTimeout(() => location.reload(), 900);
});

// ---------------------------------------------------------------------------
// Live updates: the server tells us as soon as anyone adds, edits or returns money.
// ---------------------------------------------------------------------------

let liveSource = null;

function setLiveStatus(status) {
  const el = $('#liveStatus');
  if (!el) return;
  el.className = `live-chip live-chip--${status}`;
  el.textContent = { live: 'Live', offline: 'Reconnecting…' }[status] || '';
  el.title =
    status === 'live'
      ? 'Connected — this screen updates as soon as anyone saves a change'
      : 'Connection lost — trying to reconnect; the screen still refreshes every minute';
}

function startLiveUpdates() {
  if (liveSource || typeof EventSource === 'undefined' || !isLoggedIn() || state.user.mustChangePassword) return;
  const refreshSoon = debounce(() => {
    if (document.visibilityState === 'visible' && !isModalOpen()) refreshCurrent();
  }, 400);
  liveSource = new EventSource('/api/events');
  liveSource.addEventListener('ready', () => setLiveStatus('live'));
  liveSource.addEventListener('changed', refreshSoon);
  liveSource.onopen = () => setLiveStatus('live');
  liveSource.onerror = () => setLiveStatus('offline'); // EventSource reconnects on its own
}

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
      roles: boot.roles,
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
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    location.hash = homeHash();
  }
  route();
  startLiveUpdates();

  // Keep the screen current: ages grow daily and other staff may change entries.
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || isModalOpen() || !isLoggedIn()) return;
    try {
      const boot = await api('GET', '/api/bootstrap');
      const changed = !boot.user || boot.user.id !== state.user.id || boot.user.role !== state.user.role;
      setToday(boot.today);
      if (changed) {
        // Signed out elsewhere, or the role was changed: start again from the sign-in page.
        location.hash = '#/login';
        location.reload();
        return;
      }
      $('#asOf').textContent = fmtDate(state.today);
      refreshCurrent();
    } catch (_) {
      /* network hiccup; try again next tick */
    }
  }, AUTO_REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isModalOpen() && isLoggedIn()) refreshCurrent();
  });
}

start();
