/* Hash router for the website (converted from the old js/app.js). */
import './styles/app.css';
import './styles/exam.css';
import { ApiError } from './lib/api';
import { el } from './lib/dom';
import { mountDashboard } from './pages/dashboard';
import { mountDone } from './pages/done';
import { mountStart } from './pages/start';
import { mountRunner, type RunnerHandle } from './runner/runner';

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
  const [path, query = ''] = lastHash.replace(/^#\/?/, '').split('?');
  const [name, id] = (path ?? '').split('/');
  try {
    if (name === 'attempt' && id) {
      document.body.classList.add('theme-exam');
      view = await mountRunner(app, id);
    } else {
      document.body.classList.add('theme-app');
      window.scrollTo(0, 0);
      if (name === 'test' && id) await mountStart(app, id);
      else if (name === 'done' && id) await mountDone(app, id, /timeup=1/.test(query));
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
