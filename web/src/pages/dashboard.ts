/*
 * #/ — what is still to do: Today (study plan), Mastery, attempts in progress, tests not finished yet.
 * Finished tests and every result live on the Done page (#/done) so the two do not mix.
 */
import type { AttemptSummary, DashboardResponse, TestListItem } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { daysUntil, fmtDate, fmtDay } from '../lib/format';
import { confirmDialog, toast } from '../lib/ui';
import { appHeader, fmtBandValue, kindBadge, skillBadge, timeText } from './common';
import { masteryCard } from './mastery';
import { todayCard } from './plan';

export async function mountDashboard(root: HTMLElement): Promise<void> {
  const d = await api<DashboardResponse>('/dashboard');
  const page = el('div', { class: 'page' });
  root.append(appHeader('What is still to do'), page);
  const [today, mastery] = await Promise.all([todayCard(), masteryCard()]);
  if (today) page.appendChild(today);
  if (mastery) page.appendChild(mastery);

  const toDo = d.assigned.filter(t => !t.inProgressAttemptId);
  page.appendChild(el('section', { class: 'stats' },
    stat('To do', String(toDo.length), `${toDo.filter(t => t.kind === 'homework').length} homework`),
    stat('In progress', String(d.inProgress.length), d.inProgress[0] ? `Last: ${fmtDate(d.inProgress[0].updatedAt)}` : 'Nothing started'),
    stat('Done', String(d.doneCount), 'See the Done page', '#/done'),
    stat('Feedback ready', String(d.feedbackReady), 'Marked by Claude', '#/done')));

  if (d.newFeedback.length) {
    page.appendChild(section('New feedback from Claude', el('ul', { class: 'plain-list fb-new' }, d.newFeedback.map(a => el('li', null,
      el('a', { href: `#/result/${a.id}` }, el('b', null, a.title)), ' ', skillBadge(a.skill),
      ` · band ${fmtBandValue(a.feedbackBand ?? a.autoScore?.band)} · ${fmtDate(a.submittedAt)}`)))));
  }
  if (d.inProgress.length) {
    const grid = el('div', { class: 'card-grid' });
    // after a discard the whole page is drawn again: the test goes back to "To do"
    grid.append(...d.inProgress.map(a => inProgressCard(a, async () => {
      if (await discardAttempt(a)) { root.replaceChildren(); await mountDashboard(root); }
    })));
    page.appendChild(section('Continue where you left off', grid));
  }
  page.appendChild(section('To do',
    toDo.length
      ? el('div', { class: 'card-grid' }, toDo.map(testCard))
      : el('div', { class: 'empty' }, el('h3', null, 'Nothing left to do'), el('p', null, 'Tests that Claude uploads appear here. Finished tests are on the Done page.'),
        el('div', { class: 'row-actions center' }, el('a', { class: 'btn', href: '#/done' }, '✓ Done page'), el('a', { class: 'btn btn-primary', href: '#/import' }, '＋ Import a test')))));
}

/** asks first, then deletes an attempt that is still in progress; true when it was deleted */
export async function discardAttempt(a: Pick<AttemptSummary, 'id' | 'title' | 'answered'>): Promise<boolean> {
  const ok = await confirmDialog(
    el('div', null, el('p', null, `Discard your attempt at "${a.title}"?`),
      el('p', { class: 'muted' }, `${a.answered ? `Your ${a.answered} answer${a.answered === 1 ? '' : 's'}, notes and recordings` : 'Its notes and recordings'} will be deleted. The test itself stays, so you can start it again later.`)),
    { title: 'Discard attempt', ok: 'Discard', danger: true });
  if (!ok) return false;
  try {
    await api(`/attempts/${a.id}`, { method: 'DELETE' });
    toast('Attempt discarded', 'ok');
    return true;
  } catch (e) {
    toast((e as Error).message, 'err');
    return false;
  }
}

const stat = (label: string, value: string, sub: string, href?: string) =>
  el(href ? 'a' : 'div', { class: `stat${href ? ' stat-link' : ''}`, ...(href ? { href } : {}) }, el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value), el('div', { class: 'stat-sub' }, sub));

const section = (title: string, body: HTMLElement) => el('section', { class: 'dash-section' }, el('h2', { class: 'section-title' }, title), body);

export function dueBadge(due: string | null): HTMLElement | null {
  if (!due) return null;
  const n = daysUntil(due);
  const cls = n < 0 ? 'pill-bad' : n <= 1 ? 'pill-warn' : 'pill-ok';
  const text = n < 0 ? `Overdue (${fmtDay(due)})` : n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `Due ${fmtDay(due)}`;
  return el('span', { class: cls }, text);
}

/** "W1 Introduction ●○" for a test of a mastery step */
export function masteryPill(m: NonNullable<TestListItem['mastery']>): HTMLElement {
  const dots = '●'.repeat(Math.min(m.passesInARow, m.inARow)) + '○'.repeat(Math.max(0, m.inARow - m.passesInARow));
  return el('a', { class: `badge badge-mastery st-${m.status}`, href: '#/mastery', title: `Mastery step: ${m.passesInARow} of ${m.inARow} passes in a row` },
    `🎯 ${m.title} ${m.status === 'passed' ? '✓' : dots}`);
}

export function testCard(t: TestListItem): HTMLElement {
  const meta = [
    t.marks ? `${t.marks} question${t.marks === 1 ? '' : 's'}` : `${t.parts} task${t.parts === 1 ? '' : 's'}`,
    t.timeLimitMin ? `⏱ ${t.timeLimitMin} min` : 'no time limit'
  ].join(' · ');
  const last = t.lastAttempt;
  return el('article', { class: `test-card mod-${t.skill}`, dataset: { testId: t.id } },
    el('div', { class: 'test-card-top' }, el('div', { class: 'badges' }, skillBadge(t.skill), kindBadge(t.kind)), dueBadge(t.dueDate)),
    el('h3', null, t.title),
    t.mastery ? el('div', null, masteryPill(t.mastery)) : null,
    el('div', { class: 'test-meta' }, meta),
    el('div', { class: 'test-last' },
      last ? el('a', { href: `#/result/${last.id}` }, `Last: ${fmtDate(last.submittedAt)}${last.autoScore?.total ? ` · ${last.autoScore.raw}/${last.autoScore.total}` : ''}${(last.feedbackBand ?? last.autoScore?.band) != null ? ` · band ${fmtBandValue(last.feedbackBand ?? last.autoScore?.band)}` : ''}`)
        : t.attemptCount ? `${t.attemptCount} attempt${t.attemptCount === 1 ? '' : 's'}` : 'Not started',
      t.inProgressAttemptId ? el('span', { class: 'pill-warn' }, 'In progress') : null),
    el('div', { class: 'test-actions' },
      t.inProgressAttemptId
        ? el('a', { class: 'btn btn-primary', href: `#/attempt/${t.inProgressAttemptId}` }, '▶ Resume')
        : el('a', { class: 'btn btn-primary', href: `#/test/${t.id}` }, last ? '↻ Try again' : '▶ Start'),
      el('a', { class: 'btn', href: `#/test/${t.id}` }, 'Details')));
}

function inProgressCard(a: AttemptSummary, onDiscard: () => void): HTMLElement {
  return el('article', { class: `test-card mod-${a.skill}`, dataset: { attemptId: a.id } },
    el('div', { class: 'test-card-top' }, el('div', { class: 'badges' }, skillBadge(a.skill), el('span', { class: 'badge' }, a.mode === 'exam' ? 'Exam mode' : 'Practice mode'))),
    el('h3', null, a.title),
    el('div', { class: 'progress' }, el('div', { class: 'progress-fill', style: { width: `${a.items ? (a.answered / a.items) * 100 : 0}%` } })),
    el('div', { class: 'test-meta' }, `${a.answered} of ${a.items} answered · ${timeText(a)}`),
    el('div', { class: 'test-last' }, `Started ${fmtDate(a.startedAt)}`),
    el('div', { class: 'test-actions' },
      el('a', { class: 'btn btn-primary', href: `#/attempt/${a.id}` }, '▶ Resume'),
      el('button', { class: 'btn btn-discard', type: 'button', title: 'Delete this attempt', onclick: onDiscard }, '🗑 Discard')));
}
