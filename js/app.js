/* ===== Hash router ===== */

const App = {
  view: null,          // current screen: may expose destroy() and canLeave()
  lastHash: '',
  skipNext: false,

  go(hash) {
    // same address (e.g. next section of a full test): no hashchange event fires, so render directly
    if (location.hash === hash) App.render();
    else location.hash = hash;
  },

  async onHashChange() {
    if (App.skipNext) { App.skipNext = false; return; }
    if (App.view && App.view.canLeave) {
      const ok = await App.view.canLeave();
      if (!ok) { App.skipNext = true; location.hash = App.lastHash; return; }
    }
    await App.render();
  },

  async render() {
    App.lastHash = location.hash || '#/';
    if (App.view && App.view.destroy) { try { App.view.destroy(); } catch (e) { console.error(e); } }
    App.view = null;
    const root = $('#app');
    root.innerHTML = '';
    document.body.className = '';
    window.scrollTo(0, 0);
    const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
    try {
      if (name === 'edit') App.view = await Editor.mount(root, id);
      else if (name === 'test') App.view = await ExamView.mount(root, { examId: id });
      else if (name === 'review') App.view = await ExamView.mount(root, { attemptId: id, review: true });
      else if (name === 'result') App.view = await Results.mount(root, id);
      else if (name === 'run') App.view = await RunView.mount(root, id);
      else if (name === 'full') App.view = await FullResults.mount(root, id);
      else App.view = await Dashboard.mount(root, name === 'history' ? 'history' : 'tests');
    } catch (e) {
      console.error(e);
      root.appendChild(el('div', { class: 'page' },
        el('div', { class: 'empty' }, el('h2', null, 'Something went wrong'), el('p', null, e.message || String(e)),
          el('a', { class: 'btn btn-primary', href: '#/' }, 'Back to dashboard'))));
    }
  }
};

window.addEventListener('hashchange', () => App.onHashChange());
// close any open dropdown menu when clicking elsewhere
document.addEventListener('click', e => {
  $$('.dropdown.open').forEach(d => { if (!d.contains(e.target) || e.target.closest('.dropdown-menu')) d.classList.remove('open'); });
});
window.addEventListener('beforeunload', e => {
  if (App.view && App.view.warnOnUnload && App.view.warnOnUnload()) { e.preventDefault(); e.returnValue = ''; }
});

(async function start() {
  try {
    await DB.open();
    await seedSamplesIfFirstRun();
  } catch (e) {
    $('#app').innerHTML = '<div class="page"><div class="empty"><h2>Storage is not available</h2><p>Your browser blocked local storage (IndexedDB). Please open this page in Chrome, Edge or Firefox, and not in a private window.</p></div></div>';
    return;
  }
  App.render();
})();
