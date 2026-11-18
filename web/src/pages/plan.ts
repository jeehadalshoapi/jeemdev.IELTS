/*
 * Study plan (Phase 10, ielts-site-spec.md item 8): the dashboard's Today card (today's blocks, blocks still open
 * from earlier days, the "re-test the sets" reminder every 5th day) and the whole plan on #/plan.
 */
import type { BlockStatus, PlanBlock, PlanDay, TodayResponse } from '@ielts/shared';
import { api } from '../lib/api';
import { el, setChildren } from '../lib/dom';
import { fmtDay } from '../lib/format';
import { toast } from '../lib/ui';
import { appHeader } from './common';

export const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** a block: tick box, title, minutes, link to what it is about */
function blockRow(b: PlanBlock, links: TodayResponse['links'], onChange: (b: PlanBlock) => void, extra?: string): HTMLElement {
  const box = el('input', { type: 'checkbox', checked: b.status === 'done', 'aria-label': `Done: ${b.title}` });
  box.addEventListener('change', async () => {
    try { const r = await api<{ block: PlanBlock }>(`/plan/blocks/${encodeURIComponent(b.id)}`, { method: 'PATCH', body: { status: box.checked ? 'done' : 'todo' } }); onChange(r.block); }
    catch (e) { toast((e as Error).message, 'err'); box.checked = !box.checked; }
  });
  const skip = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm', title: b.status === 'skipped' ? 'Not skipped' : 'Skip this block',
    onclick: async () => {
      try { const r = await api<{ block: PlanBlock }>(`/plan/blocks/${encodeURIComponent(b.id)}`, { method: 'PATCH', body: { status: (b.status === 'skipped' ? 'todo' : 'skipped') as BlockStatus } }); onChange(r.block); }
      catch (e) { toast((e as Error).message, 'err'); }
    }
  }, b.status === 'skipped' ? '↺' : 'Skip');
  const link = b.testId ? el('a', { class: 'btn btn-sm btn-primary', href: `#/test/${b.testId}` }, `▶ ${links.tests[b.testId] ? 'Open' : 'Test'}`)
    : b.lessonId ? el('a', { class: 'btn btn-sm', href: `#/lesson/${encodeURIComponent(b.lessonId)}` }, '📘 Lesson')
      : b.vocabularySetId ? el('a', { class: 'btn btn-sm', href: `#/vocab/${encodeURIComponent(b.vocabularySetId)}` }, '🔤 Set') : null;
  return el('li', { class: `plan-block st-${b.status}` },
    el('label', { class: 'plan-check' }, box,
      el('span', null, el('b', null, b.title), b.minutes ? el('span', { class: 'muted' }, ` · ${b.minutes} min`) : null, extra ? el('span', { class: 'muted' }, ` · ${extra}`) : null,
        b.note ? el('div', { class: 'muted plan-note' }, b.note) : null,
        b.testId && links.tests[b.testId] ? el('div', { class: 'muted plan-note' }, links.tests[b.testId]) : null,
        b.lessonId && links.lessons[b.lessonId] ? el('div', { class: 'muted plan-note' }, links.lessons[b.lessonId]) : null)),
    el('span', { class: 'plan-actions' }, link, skip));
}

/** the Today card at the top of the dashboard; null when there is no plan at all */
export async function todayCard(): Promise<HTMLElement | null> {
  let t: TodayResponse;
  try { t = await api<TodayResponse>(`/plan/today?date=${localToday()}`); } catch { return null; }
  if (!t.today && !t.pending.length && !t.next && !t.review) return null;
  const card = el('section', { class: 'card today-card' });
  const draw = () => {
    const d = t.today;
    if (d) { d.done = d.blocks.filter(b => b.status !== 'todo').length; }
    setChildren(card,
      el('div', { class: 'card-head' },
        el('h3', { class: 'card-title' }, d ? `Today: Day ${d.day} · ${d.title}` : t.next ? `Next: Day ${t.next.day} on ${fmtDay(t.next.date)} · ${t.next.title}` : 'Study plan'),
        d ? el('span', { class: d.done === d.total ? 'pill-ok' : 'badge' }, `${d.done} of ${d.total} block${d.total === 1 ? '' : 's'} done`) : null,
        el('a', { class: 'btn btn-ghost btn-sm', href: '#/plan' }, 'Whole plan →')),
      d && d.total ? el('div', { class: 'today-bar', role: 'img', 'aria-label': `${d.done} of ${d.total} done` }, el('span', { style: { width: `${(d.done / d.total) * 100}%` } })) : null,
      t.review ? el('div', { class: 'review-banner' }, el('b', null, `🔁 Day ${t.review.day}: re-test Sets ${t.review.sets.map(s => s.number ?? s.theme).join(', ')}`),
        el('span', { class: 'row-actions' }, t.review.sets.slice(0, 12).map(s => el('a', { class: 'btn btn-sm', href: `#/vocab/${encodeURIComponent(s.id)}` }, s.number !== null ? `Set ${s.number}` : s.theme)))) : null,
      d?.notes ? el('p', { class: 'muted' }, d.notes) : null,
      d && d.blocks.length ? el('ul', { class: 'plan-blocks' }, d.blocks.map(b => blockRow(b, t.links, nb => { Object.assign(b, nb); draw(); }))) : null,
      t.pending.length ? el('div', { class: 'pending' },
        el('h4', null, `Still open from earlier days (${t.pending.length})`),
        el('ul', { class: 'plan-blocks' }, t.pending.slice(0, 8).map(p => blockRow(p.block, t.links, nb => {
          if (nb.status !== 'todo') t.pending = t.pending.filter(x => x.block.id !== nb.id); else Object.assign(p.block, nb);
          draw();
        }, `Day ${p.day}`)))) : null);
  };
  draw();
  return card;
}

export async function mountPlan(root: HTMLElement): Promise<void> {
  const days = await api<PlanDay[]>('/plan');
  const page = el('div', { class: 'page plan-page' });
  root.append(appHeader('Study plan', true), page);
  if (!days.length) {
    page.appendChild(el('div', { class: 'empty' }, el('h3', null, 'No plan yet'), el('p', null, 'Ask Claude in claude.ai to put your study plan on the site (set_plan).')));
    return;
  }
  const today = localToday();
  const links: TodayResponse['links'] = { tests: {}, lessons: {} };
  const dayCard = (d: PlanDay) => {
    const done = d.blocks.filter(b => b.status !== 'todo').length;
    const card = el('article', { class: `card plan-day${d.date === today ? ' is-today' : d.date < today ? ' is-past' : ''}`, id: `day-${d.day}` });
    const draw = () => setChildren(card,
      el('div', { class: 'card-head' },
        el('span', { class: 'day-pill' }, `Day ${d.day}`), el('h3', { class: 'card-title' }, d.title),
        el('span', { class: 'muted' }, fmtDay(d.date)), d.blocks.length ? el('span', { class: done === d.blocks.length ? 'pill-ok' : 'badge' }, `${d.blocks.filter(b => b.status !== 'todo').length}/${d.blocks.length}`) : null),
      d.notes ? el('p', { class: 'muted' }, d.notes) : null,
      d.blocks.length ? el('ul', { class: 'plan-blocks' }, d.blocks.map(b => blockRow(b, links, nb => { Object.assign(b, nb); draw(); }))) : null);
    draw();
    return card;
  };
  page.append(...days.map(dayCard));
  document.querySelector('.plan-day.is-today')?.scrollIntoView({ block: 'start' });
}
