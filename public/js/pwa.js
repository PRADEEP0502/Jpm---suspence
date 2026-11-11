'use strict';
// Splash screen (phones only) fades out once the page has loaded; service worker makes the app installable.
window.addEventListener('load', () => {
  const splash = document.getElementById('splash');
  const phone = window.matchMedia('(max-width: 720px)').matches;
  if (splash && !phone) splash.remove();
  else if (splash) {
    setTimeout(() => {
      splash.classList.add('is-done');
      setTimeout(() => splash.remove(), 400);
    }, 250);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});
