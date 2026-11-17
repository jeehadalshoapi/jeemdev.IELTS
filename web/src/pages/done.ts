import { progressOf, type AttemptView } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { fmtDate, fmtDuration } from '../lib/format';
import { appHeader, skillBadge } from './common';

/** after submitting — the full results page (scores, correct answers, feedback) arrives in Phase 3 */
export async function mountDone(root: HTMLElement, attemptId: string, timeUp: boolean): Promise<void> {
  const v = await api<AttemptView>(`/attempts/${attemptId}`);
  if (v.attempt.status === 'in_progress') { location.replace(`#/attempt/${attemptId}`); return; }
  const { answered, total } = progressOf(v.attempt.answers, v.test.content.parts);
  const used = v.attempt.mode === 'exam' && v.attempt.submittedAt
    ? (Date.parse(v.attempt.submittedAt) - Date.parse(v.attempt.startedAt)) / 1000
    : v.timing.spentSec.total ?? 0;

  root.append(appHeader('Submitted', true), el('div', { class: 'page narrow' }, el('section', { class: 'card done-card' },
    el('div', { class: 'done-icon' }, '✓'),
    el('h1', null, 'Answers submitted'),
    v.attempt.autoSubmitted || timeUp ? el('p', { class: 'pill-warn' }, 'Time ran out, so your saved answers were submitted automatically.') : null,
    el('p', null, skillBadge(v.test.skill), ' ', el('b', null, v.test.title)),
    el('div', { class: 'start-meta' },
      el('div', null, el('small', null, 'Answered'), el('b', null, `${answered} of ${total}`)),
      el('div', null, el('small', null, 'Time used'), el('b', null, fmtDuration(used))),
      el('div', null, el('small', null, 'Submitted'), el('b', null, fmtDate(v.attempt.submittedAt)))),
    el('p', { class: 'muted' }, 'Your score, the correct answers and the results page arrive in Phase 3. Once the connector is ready (Phase 5) you can ask Claude: “Mark my last attempt”.'),
    el('div', { class: 'start-actions' }, el('a', { class: 'btn btn-primary', href: '#/' }, 'Back to dashboard')))));
}
