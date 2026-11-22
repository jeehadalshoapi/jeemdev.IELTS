/*
 * Mastery ladders (Phase 12, ielts-site-spec-mastery.md item 1): the dashboard card (one row per ladder:
 * "W Writing — W1 Introduction ●○ (1 of 2 passes) → W2 Body") and the full page #/mastery.
 */
import { describePassRule, type MasteryLadder, type MasteryResponse, type MasteryStep } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { fmtDay } from '../lib/format';
import { appHeader, fmtBandValue } from './common';

const STATUS_LABEL: Record<MasteryStep['status'], string> = { locked: 'Locked', active: 'Working on it', passed: 'Passed', recheck: 'Re-check' };

function dots(s: MasteryStep): HTMLElement {
  // a re-check needs one new pass; passes from before the re-check do not count
  const need = s.status === 'recheck' ? 1 : s.passRule.inARow;
  const shown = s.status === 'recheck' ? 0 : s.status === 'passed' ? need : Math.min(s.passesInARow, need);
  return el('span', { class: 'm-dots', 'aria-label': `${shown} of ${need} passes` },
    ...Array.from({ length: need }, (_, i) => el('span', { class: i < shown ? 'on' : '' })));
}

const passText = (s: MasteryStep) => s.status === 'recheck' ? 'one more pass needed'
  : s.status === 'passed' ? 'passed' : `${Math.min(s.passesInARow, s.passRule.inARow)} of ${s.passRule.inARow} passes`;

/** the newest test of a step that is not archived */
const practiceTest = (m: MasteryResponse, s: MasteryStep) => (m.tests[s.id] ?? []).find(t => !t.archived) ?? null;

function ladderRow(l: MasteryLadder, m: MasteryResponse): HTMLElement {
  const cur = l.current;
  const next = cur ? l.steps.find(s => s.order > cur.order && s.status !== 'passed') : null;
  const passed = l.steps.filter(s => s.status === 'passed').length;
  const test = cur ? practiceTest(m, cur) : null;
  return el('li', { class: `m-row${cur ? ` st-${cur.status}` : ''}`, dataset: { ladder: l.ladder } },
    el('span', { class: 'm-code' }, l.ladder),
    el('div', { class: 'm-main' },
      el('div', null, el('b', null, l.ladderTitle ?? l.ladder), el('span', { class: 'muted' }, ` · ${passed} of ${l.steps.length} passed`)),
      cur
        ? el('div', { class: 'm-current' }, el('span', null, cur.title), ' ', dots(cur), el('span', { class: 'muted' }, ` (${passText(cur)})`),
          cur.status === 'recheck' ? el('span', { class: 'pill-warn' }, 'Re-check') : null,
          next ? el('span', { class: 'muted m-next' }, ` → ${next.title}`) : null)
        : el('div', { class: 'm-current muted' }, passed === l.steps.length ? '✓ Every step passed' : 'No step open')),
    el('span', { class: 'plan-actions' },
      test ? el('a', { class: 'btn btn-sm btn-primary', href: `#/test/${test.id}` }, '▶ Practise') : null,
      cur?.lessonId ? el('a', { class: 'btn btn-sm', href: `#/lesson/${encodeURIComponent(cur.lessonId)}` }, '📘 Lesson') : null));
}

/** the dashboard card; null when there are no ladders */
export async function masteryCard(): Promise<HTMLElement | null> {
  let m: MasteryResponse;
  try { m = await api<MasteryResponse>('/mastery'); } catch { return null; }
  if (!m.ladders.length) return null;
  return el('section', { class: 'card mastery-card' },
    el('div', { class: 'card-head' },
      el('h3', { class: 'card-title' }, '🎯 Mastery practice'),
      el('a', { class: 'btn btn-ghost btn-sm', href: '#/mastery' }, 'All steps →')),
    el('ul', { class: 'm-rows' }, m.ladders.map(l => ladderRow(l, m))));
}

function stepCard(s: MasteryStep, m: MasteryResponse): HTMLElement {
  const tests = m.tests[s.id] ?? [];
  return el('li', { class: `m-step st-${s.status}`, id: `step-${s.id}` },
    el('div', { class: 'm-step-head' },
      el('b', null, s.title), dots(s),
      el('span', { class: s.status === 'passed' ? 'pill-ok' : s.status === 'recheck' ? 'pill-warn' : 'badge' }, STATUS_LABEL[s.status]),
      el('span', { class: 'muted' }, describePassRule(s.passRule))),
    s.task ? el('div', { class: 'muted' }, s.task) : null,
    s.attempts.length
      ? el('div', { class: 'm-attempts' }, s.attempts.map(a => el('a', { class: `m-attempt ${a.passed ? 'ok' : 'no'}`, href: `#/result/${a.attemptId}`, title: a.passed ? 'Passed' : 'Not yet' },
        `${fmtDay(a.date)} · ${a.band !== null ? `band ${fmtBandValue(a.band)}` : ''}${a.band !== null && a.percent !== null ? ' · ' : ''}${a.percent !== null ? `${Math.round(a.percent)}%` : ''} ${a.passed ? '✓' : '✗'}`)))
      : null,
    el('div', { class: 'row-actions' },
      tests.filter(t => !t.archived).slice(0, 3).map(t => el('a', { class: `btn btn-sm${s.status === 'active' || s.status === 'recheck' ? ' btn-primary' : ''}`, href: `#/test/${t.id}` }, `▶ ${t.title}`)),
      s.lessonId ? el('a', { class: 'btn btn-sm', href: `#/lesson/${encodeURIComponent(s.lessonId)}` }, '📘 Lesson') : null));
}

export async function mountMastery(root: HTMLElement): Promise<void> {
  const m = await api<MasteryResponse>('/mastery');
  const page = el('div', { class: 'page plan-page' });
  root.append(appHeader('Mastery ladders'), page);
  if (!m.ladders.length) {
    page.appendChild(el('div', { class: 'empty' }, el('h3', null, 'No ladders yet'), el('p', null, 'Ask Claude in claude.ai to create your mastery steps (upsert_mastery_step).')));
    return;
  }
  page.append(
    el('p', { class: 'muted' }, 'Each step repeats until it is passed (the pass rule, e.g. band 7+ twice in a row); then the next step unlocks. A re-check step needs one more pass.'),
    ...m.ladders.map(l => el('section', { class: 'card', dataset: { ladder: l.ladder } },
      el('div', { class: 'card-head' }, el('span', { class: 'm-code' }, l.ladder), el('h3', { class: 'card-title' }, l.ladderTitle ?? l.ladder),
        el('span', { class: 'badge' }, `${l.steps.filter(s => s.status === 'passed').length} of ${l.steps.length} passed`)),
      el('ol', { class: 'm-steps' }, l.steps.map(s => stepCard(s, m))))));
}
