import type { AttemptMode, TestDetailResponse } from '@ielts/shared';
import { api } from '../lib/api';
import { deviceId, el } from '../lib/dom';
import { fmtDate, fmtDuration } from '../lib/format';
import { mdBlock } from '../lib/markup';
import { toast } from '../lib/ui';
import { appHeader, kindBadge, skillBadge, timeText } from './common';

export async function mountStart(root: HTMLElement, testId: string): Promise<void> {
  const { test: t, attempts } = await api<TestDetailResponse>(`/tests/${testId}`);
  const open = attempts.find(a => a.status === 'in_progress');
  let mode: AttemptMode = 'practice';
  const modeOpt = (value: AttemptMode, title: string, desc: string) => el('label', { class: 'mode-opt' },
    el('input', { type: 'radio', name: 'mode', value, checked: mode === value, onchange: () => { mode = value; } }),
    el('div', null, el('b', null, title), el('small', null, desc)));

  const start = async () => {
    try {
      const { id } = await api<{ id: string }>(`/tests/${testId}/attempts`, { method: 'POST', body: { mode, device: deviceId() } });
      location.hash = `#/attempt/${id}`;
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  };

  root.append(appHeader(t.title, true), el('div', { class: 'page narrow' }, el('section', { class: 'card start-info' },
    el('div', { class: 'badges' }, skillBadge(t.skill), kindBadge(t.kind), t.dueDate ? el('span', { class: 'badge' }, `Due ${t.dueDate}`) : null,
      t.status === 'archived' ? el('a', { class: 'badge badge-archived', href: '#/tests', title: 'Restore it on the Tests page' }, 'Archived') : null),
    el('h1', null, t.title),
    el('div', { class: 'start-meta' },
      el('div', null, el('small', null, 'Time'), el('b', null, t.timeLimitMin ? `${t.timeLimitMin} minutes` : 'No limit')),
      el('div', null, el('small', null, t.marks ? 'Questions' : 'Parts'), el('b', null, String(t.marks || t.parts.length))),
      el('div', null, el('small', null, 'Parts'), el('b', null, t.parts.map(p => p.title).join(' · ')))),
    t.instructions ? el('div', { class: 'instructions', html: mdBlock(t.instructions) }) : null,
    open
      ? el('div', { class: 'resume-box' },
        el('p', null, el('b', null, `You have an attempt in progress (${open.mode} mode). `), `${open.answered} of ${open.items} answered · ${timeText(open)}.`),
        el('table', { class: 'table compact' }, el('tbody', null, t.parts.map(p => el('tr', null, el('td', null, p.title), el('td', null, fmtDuration(open.timing.spentSec[p.id] ?? 0)))))),
        el('div', { class: 'start-actions' },
          el('button', { class: 'btn btn-ghost', onclick: start }, 'Start a new attempt instead'),
          el('a', { class: 'btn btn-primary btn-lg', href: `#/attempt/${open.id}` }, '▶ Resume')))
      : el('div', null,
        el('div', { class: 'modes' },
          modeOpt('practice', 'Practice mode', 'Pause any time; closing the page pauses the clock too. Good for 15-minute blocks — do one part today, the next one later.'),
          modeOpt('exam', 'Exam mode', 'Real conditions: the clock cannot be paused and keeps running even if you close the page.')),
        el('div', { class: 'start-actions' }, el('a', { class: 'btn btn-ghost', href: '#/' }, '← Dashboard'), el('button', { class: 'btn btn-primary btn-lg', onclick: start }, '▶ Start'))),
    attempts.filter(a => a.status !== 'in_progress').length
      ? el('div', null, el('h3', null, 'Earlier attempts'), el('ul', { class: 'plain-list' }, attempts.filter(a => a.status !== 'in_progress').map(a =>
        el('li', null, el('a', { href: `#/result/${a.id}` }, fmtDate(a.submittedAt)), ` — ${a.answered}/${a.items} answered, ${a.mode} mode`, a.feedbackReady ? ' · feedback ready' : ''))))
      : null)));
}
