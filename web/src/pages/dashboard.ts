import type { AttemptSummary, DashboardResponse, TestListItem } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { daysUntil, fmtDate, fmtDay, fmtDuration } from '../lib/format';
import { appHeader, fmtBandValue, kindBadge, skillBadge, timeText } from './common';
import { todayCard } from './plan';

export async function mountDashboard(root: HTMLElement): Promise<void> {
  const d = await api<DashboardResponse>('/dashboard');
  const page = el('div', { class: 'page' });
  root.append(appHeader('Your tests, homework and results'), page);
  const today = await todayCard();
  if (today) page.appendChild(today);

  page.appendChild(el('section', { class: 'stats' },
    stat('Assigned', String(d.assigned.length), `${d.assigned.filter(t => t.kind === 'homework').length} homework`),
    stat('In progress', String(d.inProgress.length), d.inProgress[0] ? `Last: ${fmtDate(d.inProgress[0].updatedAt)}` : 'Nothing started'),
    stat('Completed', String(d.completed.length), d.completed[0]?.submittedAt ? `Last: ${fmtDate(d.completed[0].submittedAt)}` : 'No attempts yet'),
    stat('Feedback ready', String(d.completed.filter(a => a.feedbackReady).length), 'Marked by Claude')));

  if (d.inProgress.length) {
    page.appendChild(section('Continue where you left off', el('div', { class: 'card-grid' }, d.inProgress.map(inProgressCard))));
  }
  page.appendChild(section('Assigned tests',
    d.assigned.length
      ? el('div', { class: 'card-grid' }, d.assigned.map(testCard))
      : el('div', { class: 'empty' }, el('h3', null, 'No tests yet'), el('p', null, 'Tests that Claude uploads will appear here. You can also paste one yourself.'),
        el('a', { class: 'btn btn-primary', href: '#/import' }, '＋ Import a test'))));
  if (d.completed.length) page.appendChild(section('Completed', completedTable(d.completed)));
}

const stat = (label: string, value: string, sub: string) =>
  el('div', { class: 'stat' }, el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value), el('div', { class: 'stat-sub' }, sub));

const section = (title: string, body: HTMLElement) => el('section', { class: 'dash-section' }, el('h2', { class: 'section-title' }, title), body);

function dueBadge(due: string | null): HTMLElement | null {
  if (!due) return null;
  const n = daysUntil(due);
  const cls = n < 0 ? 'pill-bad' : n <= 1 ? 'pill-warn' : 'pill-ok';
  const text = n < 0 ? `Overdue (${fmtDay(due)})` : n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `Due ${fmtDay(due)}`;
  return el('span', { class: cls }, text);
}

function testCard(t: TestListItem): HTMLElement {
  const meta = [
    t.marks ? `${t.marks} question${t.marks === 1 ? '' : 's'}` : `${t.parts} task${t.parts === 1 ? '' : 's'}`,
    t.timeLimitMin ? `⏱ ${t.timeLimitMin} min` : 'no time limit'
  ].join(' · ');
  return el('article', { class: `test-card mod-${t.skill}` },
    el('div', { class: 'test-card-top' }, el('div', { class: 'badges' }, skillBadge(t.skill), kindBadge(t.kind)), dueBadge(t.dueDate)),
    el('h3', null, t.title),
    el('div', { class: 'test-meta' }, meta),
    el('div', { class: 'test-last' }, t.attemptCount ? `${t.attemptCount} attempt${t.attemptCount === 1 ? '' : 's'}` : 'Not started', t.inProgressAttemptId ? el('span', { class: 'pill-warn' }, 'In progress') : null),
    el('div', { class: 'test-actions' },
      t.inProgressAttemptId
        ? el('a', { class: 'btn btn-primary', href: `#/attempt/${t.inProgressAttemptId}` }, '▶ Resume')
        : el('a', { class: 'btn btn-primary', href: `#/test/${t.id}` }, '▶ Start'),
      el('a', { class: 'btn', href: `#/test/${t.id}` }, 'Details')));
}

function inProgressCard(a: AttemptSummary): HTMLElement {
  return el('article', { class: `test-card mod-${a.skill}` },
    el('div', { class: 'test-card-top' }, el('div', { class: 'badges' }, skillBadge(a.skill), el('span', { class: 'badge' }, a.mode === 'exam' ? 'Exam mode' : 'Practice mode'))),
    el('h3', null, a.title),
    el('div', { class: 'progress' }, el('div', { class: 'progress-fill', style: { width: `${a.items ? (a.answered / a.items) * 100 : 0}%` } })),
    el('div', { class: 'test-meta' }, `${a.answered} of ${a.items} answered · ${timeText(a)}`),
    el('div', { class: 'test-last' }, `Started ${fmtDate(a.startedAt)}`),
    el('div', { class: 'test-actions' }, el('a', { class: 'btn btn-primary', href: `#/attempt/${a.id}` }, '▶ Resume')));
}

function completedTable(list: AttemptSummary[]): HTMLElement {
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
