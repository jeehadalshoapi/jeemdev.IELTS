/*
 * #/done — finished tests and every result, kept apart from the dashboard's to-do list (Phase 12).
 * A test lands here once an attempt of it is submitted (a mastery step's test only once the step is passed).
 */
import type { AttemptSummary, DoneResponse, Skill, TestListItem } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { fmtDate, fmtDuration } from '../lib/format';
import { appHeader, fmtBandValue, SKILL_LABEL, skillBadge } from './common';
import { testCard } from './dashboard';

export async function mountDone(root: HTMLElement): Promise<void> {
  const d = await api<DoneResponse>('/done');
  let skill: Skill | null = null;
  let view: 'tests' | 'results' = location.hash.includes('view=results') ? 'results' : 'tests';
  const skills = [...new Set([...d.tests.map(t => t.skill), ...d.completed.map(a => a.skill)])];
  const filters = el('div', { class: 'filter-row' });
  const body = el('div');
  root.append(appHeader('Finished tests and results'), el('div', { class: 'page' }, filters, body));

  function draw() {
    const seg = <T>(label: string, items: Array<[T, string]>, cur: T, set: (v: T) => void) => el('div', { class: 'filter' },
      el('span', { class: 'filter-label' }, label),
      el('div', { class: 'seg', role: 'group', 'aria-label': label }, items.map(([v, text]) => el('button', {
        type: 'button', class: `seg-btn${cur === v ? ' on' : ''}`, 'aria-pressed': String(cur === v), onclick: () => { set(v); draw(); }
      }, text))));
    filters.replaceChildren(
      seg('Show', [['tests', `Tests (${d.tests.length})`], ['results', `Results (${d.completed.length})`]] as Array<['tests' | 'results', string]>, view, v => {
        view = v;
        history.replaceState(null, '', v === 'results' ? '#/done?view=results' : '#/done');
      }),
      skills.length > 1 ? seg('Skill', [[null, 'All'], ...skills.map(s => [s, SKILL_LABEL[s]] as [Skill, string])] as Array<[Skill | null, string]>, skill, v => { skill = v; }) : '');
    const tests = d.tests.filter(t => !skill || t.skill === skill);
    const results = d.completed.filter(a => !skill || a.skill === skill);
    if (view === 'tests') {
      body.replaceChildren(tests.length
        ? el('div', { class: 'card-grid' }, tests.map((t: TestListItem) => testCard(t)))
        : el('div', { class: 'empty' }, el('h3', null, 'Nothing finished yet'), el('p', null, 'When you submit a test it moves here from the dashboard.'), el('a', { class: 'btn btn-primary', href: '#/' }, '← Dashboard')));
    } else {
      body.replaceChildren(results.length ? resultsTable(results) : el('div', { class: 'empty' }, el('h3', null, 'No results yet')));
    }
  }
  draw();
}

function resultsTable(list: AttemptSummary[]): HTMLElement {
  return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
    el('thead', null, el('tr', null, ['Submitted', 'Test', 'Mode', 'Score', 'Band', 'Time', ''].map(h => el('th', null, h)))),
    el('tbody', null, list.map(a => el('tr', { class: 'clickable', onclick: () => { location.hash = `#/result/${a.id}`; } },
      el('td', null, fmtDate(a.submittedAt)),
      el('td', null, el('b', null, a.title), ' ', skillBadge(a.skill)),
      el('td', null, a.mode === 'exam' ? 'Exam' : 'Practice'),
      el('td', null, a.autoScore?.total ? `${a.autoScore.raw} / ${a.autoScore.total}` : '–'),
      el('td', null, el('b', null, fmtBandValue(a.autoScore?.band ?? a.feedbackBand))),
      el('td', null, fmtDuration(a.timing.spentSec.total ?? 0)),
      el('td', null, a.feedbackReady ? el('span', { class: 'pill-ok' }, '✓ Feedback ready') : el('span', { class: 'badge' }, a.status === 'marked' ? 'Marked' : 'Submitted'))))))));
}
