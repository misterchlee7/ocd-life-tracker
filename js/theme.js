// Theme bootstrap — classic (non-module) script loaded in <head> of every page.
// Runs synchronously before first paint so a forced theme never flashes the OS
// theme. Modules are deferred, which is why this can't live in ui.js.
//
// Storage: localStorage 'otl.theme' = 'light' | 'dark'; absent = follow OS.
// All colors resolve via CSS light-dark(), driven by the color-scheme property,
// so forcing a theme is just setting documentElement.style.colorScheme.
(function () {
  var LIGHT_BG = '#f6f7fa';
  var DARK_BG = '#131318';

  function applyTheme(mode) {
    var root = document.documentElement;
    root.style.colorScheme = (mode === 'light' || mode === 'dark') ? mode : '';
    // Keep the PWA title-bar color in sync when a theme is forced.
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i];
      if (mode === 'light') m.setAttribute('content', LIGHT_BG);
      else if (mode === 'dark') m.setAttribute('content', DARK_BG);
      else m.setAttribute('content', (m.media || '').indexOf('dark') >= 0 ? DARK_BG : LIGHT_BG);
    }
  }

  // Shared with ui.js (the toggle button) — window global because this file is
  // not a module.
  window.otlApplyTheme = applyTheme;

  try {
    applyTheme(localStorage.getItem('otl.theme'));
  } catch (e) { /* localStorage unavailable — follow OS */ }
})();
