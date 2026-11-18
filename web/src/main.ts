/* Hash router for the website (converted from the old js/app.js). */
import './styles/app.css';
import './styles/exam.css';
import { ApiError } from './lib/api';
import { el } from './lib/dom';
import { mountDashboard } from './pages/dashboard';
import { mountHistory } from './pages/history';
import { mountImport } from './pages/import';
import { mountResult } from './pages/result';
import { mountStart } from './pages/start';
import { mountTests } from './pages/tests';
import { mountReview, mountRunner, type RunnerHandle } from './runner/runner';

const app = document.getElementById('app')!;
let view: Partial<RunnerHandle> | null = null;
let lastHash = location.hash || '#/';
let skipNext = false;

async function render(): Promise<void> {
  lastHash = location.hash || '#/';
  view?.destroy?.();
  view = null;
  app.replaceChildren();
  document.body.className = '';
  const [path] = lastHash.replace(/^#\/?/, '').split('?');
  const [name, id] = (path ?? '').split('/');
  try {
    if ((name === 'attempt' || name === 'review') && id) {
      document.body.classList.add('theme-exam');
      view = name === 'attempt' ? await mountRunner(app, id) : await mountReview(app, id);
    } else if (name === 'done' && id) {
      location.replace(`#/result/${id}`); // old links
    } else {
      document.body.classList.add('theme-app');
      window.scrollTo(0, 0);
      if (name === 'test' && id) await mountStart(app, id);
      else if (name === 'result' && id) await mountResult(app, id);
      else if (name === 'history') await mountHistory(app);
      else if (name === 'tests') await mountTests(app);
      else if (name === 'import') view = mountImport(app);
      else await mountDashboard(app);
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return;
    console.error(e);
    document.body.className = 'theme-app';
    app.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'empty' },
      el('h2', null, e instanceof ApiError && e.status === 404 ? 'Not found' : 'Something went wrong'),
      el('p', null, e instanceof TypeError ? 'Cannot reach the server. Check your connection and reload.' : (e as Error).message),
      el('a', { class: 'btn btn-primary', href: '#/' }, 'Back to dashboard'))));
  }
}

window.addEventListener('hashchange', async () => {
  if (skipNext) { skipNext = false; return; }
  if (view?.canLeave && !(await view.canLeave())) { skipNext = true; location.hash = lastHash; return; }
  await render();
});
void render();
