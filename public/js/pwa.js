'use strict';
// Splash screen fades out once the page has loaded; service worker makes the app installable.
window.addEventListener('load', () => {
  const splash = document.getElementById('splash');
  if (splash) {
    setTimeout(() => {
      splash.classList.add('is-done');
      setTimeout(() => splash.remove(), 500);
    }, 900);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
});
