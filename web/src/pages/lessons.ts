/* Lessons (Phase 8, ielts-site-spec.md item 1): reference pages first, then lessons grouped by week and day, with search. */
import type { LessonSection, LessonSummary, LessonView } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { fmtDate } from '../lib/format';
import { inlineMd, mdRich } from '../lib/markup';
import { appHeader, SKILL_ICON } from './common';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const skillTag = (s: string | null) => (s ? el('span', { class: `badge badge-${s}` }, `${(SKILL_ICON as Record<string, string>)[s] ?? ''} ${cap(s)}`.trim()) : null);

export async function mountLessons(root: HTMLElement): Promise<void> {
  const list = await api<LessonSummary[]>('/lessons');
  const page = el('div', { class: 'page' });
  root.append(appHeader('Lessons'), page);
  if (!list.length) {
    page.appendChild(el('div', { class: 'empty' }, el('h3', null, 'No lessons yet'),
      el('p', null, 'Ask Claude in claude.ai to put a lesson or a reference page on your site (for example the Day 23 lesson, or the Task 2 method).')));
    return;
  }
  const search = el('input', { class: 'input lesson-search', type: 'search', placeholder: 'Search lessons…', 'aria-label': 'Search lessons' });
  const body = el('div');
  page.append(el('div', { class: 'toolbar' }, search), body);

  const item = (l: LessonSummary) => el('a', { class: 'lesson-item', href: `#/lesson/${encodeURIComponent(l.id)}` },
    el('div', { class: 'lesson-item-top' }, l.day !== null ? el('span', { class: 'day-pill' }, `Day ${l.day}`) : null, el('b', null, l.title), skillTag(l.skill)),
    l.summary ? el('div', { class: 'muted lesson-item-sum' }, l.summary) : null);

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const shown = list.filter(l => !q || `${l.title} ${l.summary ?? ''} ${l.week ?? ''} ${l.skill ?? ''} day ${l.day ?? ''}`.toLowerCase().includes(q));
    const refs = shown.filter(l => l.kind === 'reference');
    const lessons = shown.filter(l => l.kind === 'lesson');
    const weeks = new Map<string, LessonSummary[]>();
    for (const l of lessons) { const w = l.week ? `${cap(l.week)} week` : 'Other lessons'; weeks.set(w, [...(weeks.get(w) ?? []), l]); }
    body.replaceChildren(el('div', null,
      refs.length ? el('section', { class: 'dash-section' }, el('h2', { class: 'section-title' }, '📌 Reference'), el('div', { class: 'lesson-grid' }, refs.map(item))) : null,
      ...[...weeks.entries()].map(([w, ls]) => {
        // newest day first inside a week
        const days = new Map<string, LessonSummary[]>();
        for (const l of [...ls].sort((a, b) => (b.day ?? -1) - (a.day ?? -1))) { const d = l.day !== null ? `Day ${l.day}` : 'No day'; days.set(d, [...(days.get(d) ?? []), l]); }
        return el('section', { class: 'dash-section' }, el('h2', { class: 'section-title' }, w),
          [...days.entries()].map(([d, dl]) => el('div', { class: 'lesson-day' }, el('h3', { class: 'lesson-day-title' }, d), el('div', { class: 'lesson-grid' }, dl.map(item)))));
      }),
      shown.length ? null : el('p', { class: 'muted' }, 'Nothing matches your search.')));
  };
  search.addEventListener('input', draw);
  draw();
}

function section(s: LessonSection): HTMLElement {
  return el('section', { class: 'lesson-section' },
    s.heading ? el('h2', null, s.heading) : null,
    s.markdown ? el('div', { class: 'lesson-md', html: mdRich(s.markdown) }) : null,
    s.table ? el('div', { class: 'table-wrap lesson-table' }, el('table', { class: 'table' },
      el('thead', null, el('tr', null, s.table.header.map(h => el('th', { html: inlineMd(h) })))),
      el('tbody', null, s.table.rows.map(r => el('tr', null, s.table!.header.map((_, i) => el('td', { html: inlineMd(r[i] ?? '') }))))))) : null,
    s.examples ? el('div', { class: 'lesson-examples' }, s.examples.map(x => el('div', { class: 'lesson-example' },
      x.label ? el('div', { class: 'lesson-example-label' }, x.label) : null,
      el('div', { class: 'essay', html: mdRich(x.text) }),
      x.notes?.length ? el('ul', { class: 'lesson-notes' }, x.notes.map(n => el('li', { html: inlineMd(n) }))) : null))) : null,
    s.tip ? el('div', { class: 'lesson-tip', html: mdRich(s.tip) }) : null);
}

export async function mountLesson(root: HTMLElement, id: string): Promise<void> {
  const v = await api<LessonView>(`/lessons/${encodeURIComponent(id)}`);
  const l = v.lesson;
  root.append(appHeader('Lesson', true), el('div', { class: 'page lesson-page' },
    el('a', { class: 'back-link', href: '#/lessons' }, '← All lessons'),
    el('header', { class: 'lesson-head' },
      el('div', { class: 'badges' }, l.day !== undefined ? el('span', { class: 'day-pill' }, `Day ${l.day}`) : null, l.kind === 'reference' ? el('span', { class: 'badge' }, '📌 Reference') : null, skillTag(l.skill ?? null), l.week ? el('span', { class: 'badge' }, `${cap(l.week)} week`) : null),
      el('h1', null, l.title),
      l.summary ? el('p', { class: 'lesson-summary' }, l.summary) : null,
      el('small', { class: 'muted' }, `Updated ${fmtDate(v.updatedAt)}`)),
    l.sections.map(section),
    v.tests.length || v.vocabularySets.length ? el('section', { class: 'card lesson-links' },
      el('h3', { class: 'card-title' }, 'Practise this'),
      v.tests.map(t => el('a', { class: 'btn', href: `#/test/${t.id}` }, `▶ ${t.title}${t.status === 'archived' ? ' (archived)' : ''}`)),
      v.vocabularySets.map(s => el('a', { class: 'btn', href: `#/vocab/${encodeURIComponent(s.id)}` }, `🔤 ${s.number !== null ? `Set ${s.number}: ` : ''}${s.theme}`))) : null));
}
