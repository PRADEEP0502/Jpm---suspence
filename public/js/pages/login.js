import { html, setHtml, $, api, clearFieldErrors, showFieldError, withBusy } from '../lib.js';

export function render(main, _params, { onLoggedIn }) {
  setHtml(
    main,
    html`<div class="login-wrap">
      <section class="panel login-card">
        <div class="login-head">
          <h1 class="page-title">Sign in</h1>
          <p class="page-sub">Use your Employee ID and password to see your suspense records.</p>
        </div>
        <form class="form" novalidate>
          <div class="field">
            <label for="l-user">Username / Employee ID</label>
            <input id="l-user" name="username" type="text" autocomplete="username" autocapitalize="none" />
          </div>
          <div class="field">
            <label for="l-pass">Password</label>
            <input id="l-pass" name="password" type="password" autocomplete="current-password" />
          </div>
          <div class="form-error" role="alert" hidden></div>
          <button type="submit" class="btn btn--primary btn--block btn--lg">Sign In</button>
        </form>
        <p class="login-note">Forgot your password? Ask an Administrator to reset it.</p>
      </section>
    </div>`
  );

  const form = $('form', main);
  const btn = $('button[type="submit"]', form);
  form.username.focus();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearFieldErrors(form);
    if (!form.username.value.trim()) return showFieldError(form, 'username', 'Enter your Employee ID.');
    if (!form.password.value) return showFieldError(form, 'password', 'Enter your password.');
    await withBusy(btn, 'Signing in…', async () => {
      try {
        const res = await api('POST', '/api/auth/login', {
          username: form.username.value.trim(),
          password: form.password.value,
        });
        onLoggedIn(res.user);
      } catch (err) {
        form.password.value = '';
        showFieldError(form, null, err.message);
        form.password.focus();
      }
    });
  });

  return { refresh() {} };
}
