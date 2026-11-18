/*
 * History / progress (spec §5.5, Phase 7): estimated band over time per skill, accuracy per question type over
 * time, what the mistakes are, and every attempt. One filter row (period, skill) scopes everything below it and
 * is kept in the address (#/history?days=30&skill=reading), so a reload keeps it.
 * Charts follow the dataviz rules: small multiples on one shared scale, one accent hue, tooltips that never
 * gate (every number is also in a table).
 */
import { SECTION_SKILLS, type HistoryResponse, type MarkReason, type SectionSkill, type SkillHistory, type TypeHistory } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { fmtDate, fmtDuration, fmtShortDate } from '../lib/format';
import { lineChart, rankedBars, type LinePoint } from '../lib/linechart';
import { toast } from '../lib/ui';
import { appHeader, fmtBandValue, REASON_LABEL, SKILL_LABEL, skillBadge, TYPE_LABEL } from './common';

const PERIODS = [{ days: 0, label: 'All time' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }] as const;
/** at most this many attempts per chart (the newest); the tables keep every attempt */
const MAX_POINTS = 60;

interface Filter { days: number; skill: SectionSkill | null }

function readFilter(): Filter {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const days = Number(q.get('days'));
  const skill = q.get('skill') as SectionSkill | null;
  return { days: PERIODS.some(p => p.days === days) ? days : 0, skill: skill && SECTION_SKILLS.includes(skill) ? skill : null };
}

function queryOf(f: Filter, forApi: boolean): string {
  const q = new URLSearchParams();
  if (f.days) {
    if (forApi) {
      const d = new Date(Date.now() - f.days * 86400_000);
      q.set('since', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    } else q.set('days', String(f.days));
  }
  if (f.skill) q.set('skill', f.skill);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export async function mountHistory(root: HTMLElement): Promise<void> {
  const filter = readFilter();
  const body = el('div', { class: 'progress-body' });
  const periodSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Period' });
  const skillSeg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Skill' });
  const page = el('div', { class: 'page progress-page' },
    el('div', { class: 'filter-row' },
      el('div', { class: 'filter' }, el('span', { class: 'filter-label' }, 'Period'), periodSeg),
      el('div', { class: 'filter' }, el('span', { class: 'filter-label' }, 'Skill'), skillSeg)),
    body);
  root.append(appHeader('Your progress'), page);

  const segButtons = () => {
    periodSeg.replaceChildren(...PERIODS.map(p => el('button', {
      type: 'button', class: `seg-btn${filter.days === p.days ? ' on' : ''}`, 'aria-pressed': String(filter.days === p.days),
      onclick: () => { filter.days = p.days; void load(); }
    }, p.label)));
    skillSeg.replaceChildren(...[null, ...SECTION_SKILLS].map(s => el('button', {
      type: 'button', class: `seg-btn${filter.skill === s ? ' on' : ''}`, 'aria-pressed': String(filter.skill === s),
      onclick: () => { filter.skill = s; void load(); }
    }, s ? SKILL_LABEL[s] : 'All')));
  };

  let seq = 0;
  const load = async (first = false) => {
    const mine = ++seq;
    segButtons();
    if (!first) history.replaceState(null, '', `#/history${queryOf(filter, false)}`);
    body.classList.add('is-loading'); // the old charts stay, dimmed, until the new numbers arrive
    try {
      const h = await api<HistoryResponse>(`/history${queryOf(filter, true)}`);
      if (mine !== seq) return;
      body.replaceChildren(...content(h, filter, () => { filter.days = 0; filter.skill = null; void load(); }));
    } catch (e) {
      if (first) throw e;
      toast((e as Error).message || 'Could not load your progress.', 'err');
    } finally {
      if (mine === seq) body.classList.remove('is-loading');
    }
  };
  await load(true);
}

function content(h: HistoryResponse, f: Filter, reset: () => void): HTMLElement[] {
  if (!h.attempts.length) {
    return f.days || f.skill
      ? [el('div', { class: 'empty' }, el('h3', null, 'Nothing in this view'), el('p', null, 'No finished attempts match this period and skill.'), el('button', { class: 'btn', type: 'button', onclick: reset }, 'Show everything'))]
      : [el('div', { class: 'empty' }, el('h3', null, 'No results yet'), el('p', null, 'Finish a test and your scores will appear here.'), el('a', { class: 'btn btn-primary', href: '#/' }, 'Go to the dashboard'))];
  }
  const out: HTMLElement[] = [];

  /* ---------- bands over time: one small chart per skill, all on the same band scale ---------- */
  const skills = SECTION_SKILLS.filter(s => h.bySkill[s]);
  const bands = skills.flatMap(s => h.bySkill[s]!.points.map(p => p.band)).filter((b): b is number => b !== null);
  const lo = Math.max(0, Math.min(4, Math.floor(Math.min(9, ...bands))));
  const step = 9 - lo > 6 ? 2 : 1;
  const bandTicks: number[] = [];
  for (let t = 9; t >= lo; t -= step) bandTicks.push(t);
  const bandScale = { yMin: bandTicks.at(-1)!, yMax: 9, yTicks: bandTicks };
  out.push(el('section', { class: 'dash-section' },
    el('h2', { class: 'section-title' }, 'Band over time'),
    el('p', { class: 'section-sub muted' }, 'Reading and listening: the estimated band from the answer key. Writing and speaking: the band in Claude’s marking. Hover, tap or use the arrow keys on a chart; click a point to open that result.'),
    el('div', { class: 'skill-grid' }, skills.map(s => skillCard(s, h.bySkill[s]!, bandScale)))));

  /* ---------- accuracy per question type over time ---------- */
  if (h.byType.length) {
    out.push(el('section', { class: 'dash-section' },
      el('h2', { class: 'section-title' }, 'Accuracy by question type'),
      el('div', { class: 'type-grid' }, h.byType.map(typeCard)),
      el('details', { class: 'panel details table-view' }, el('summary', null, 'Show as a table'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
          el('thead', null, el('tr', null, ['Question type', 'Correct', 'Accuracy', 'Last 3 attempts', 'Trend'].map(x => el('th', null, x)))),
          el('tbody', null, h.byType.map(t => el('tr', null,
            el('td', null, el('b', null, TYPE_LABEL[t.type] ?? t.type)),
            el('td', null, `${t.raw} / ${t.total}`),
            el('td', null, `${pct(t.raw, t.total)}%`),
            el('td', null, `${pct(t.recent.raw, t.recent.total)}%`),
            el('td', null, trendText(t.trend))))))))));
  }

  /* ---------- what the mistakes are ---------- */
  const reasons = (['wrong', 'likely_spelling', 'over_word_limit', 'blank'] as MarkReason[]).filter(k => h.reasons[k]);
  const wrongTotal = reasons.reduce((n, k) => n + h.reasons[k], 0);
  const cats = h.feedbackMistakes.slice(0, 8);
  const rest = h.feedbackMistakes.slice(8);
  if (rest.length) cats.push({ category: `${rest.length} other categor${rest.length === 1 ? 'y' : 'ies'}`, count: rest.reduce((n, c) => n + c.count, 0), attempts: 0 });
  if (reasons.length || cats.length) {
    out.push(el('section', { class: 'dash-section' },
      el('h2', { class: 'section-title' }, 'Mistakes'),
      el('div', { class: 'grid-2 mistakes-grid' },
        el('section', { class: 'card' },
          el('h3', { class: 'card-title' }, 'Why answers were marked wrong'),
          reasons.length
            ? rankedBars(reasons.map(k => ({ label: REASON_LABEL[k], value: h.reasons[k], title: `${REASON_LABEL[k]}: ${h.reasons[k]} of ${wrongTotal} lost marks (${pct(h.reasons[k], wrongTotal)}%)` })))
            : el('p', { class: 'muted' }, 'No lost marks in this view.'),
          el('p', { class: 'muted card-note' }, 'From the automatic marking of reading and listening answers.')),
        el('section', { class: 'card' },
          el('h3', { class: 'card-title' }, 'Claude’s mistake categories'),
          cats.length
            ? rankedBars(cats.map(c => ({ label: capitalize(c.category), value: c.count, title: c.attempts ? `${capitalize(c.category)}: ${c.count} mistake${c.count === 1 ? '' : 's'} in ${c.attempts} attempt${c.attempts === 1 ? '' : 's'}` : undefined })))
            : el('p', { class: 'muted' }, 'This fills in once Claude has marked an attempt and listed mistakes.'),
          el('p', { class: 'muted card-note' }, 'From Claude’s feedback (spelling, grammar, task response …).')))));
  }

  /* ---------- every attempt ---------- */
  out.push(el('section', { class: 'dash-section' }, el('h2', { class: 'section-title' }, `All attempts (${h.attempts.length})`),
    el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('thead', null, el('tr', null, ['Submitted', 'Test', 'Mode', 'Score', 'Band', 'Time', ''].map(x => el('th', null, x)))),
      el('tbody', null, h.attempts.map(a => el('tr', { class: 'clickable', onclick: () => { location.hash = `#/result/${a.id}`; } },
        el('td', null, fmtDate(a.submittedAt)),
        el('td', null, el('b', null, a.title), ' ', skillBadge(a.skill)),
        el('td', null, a.mode === 'exam' ? 'Exam' : 'Practice'),
        el('td', null, a.autoScore?.total ? `${a.autoScore.raw} / ${a.autoScore.total}` : '–'),
        el('td', null, el('b', null, fmtBandValue(a.autoScore?.band ?? a.feedbackBand))),
        el('td', null, fmtDuration(a.timing.spentSec.total ?? 0)),
        el('td', null, a.feedbackReady ? el('span', { class: 'pill-ok' }, '✓ Feedback') : null)))))))));
  return out;
}

const pct = (raw: number, total: number) => (total ? Math.round((raw / total) * 100) : 0);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const trendText = (t: number | null) => t === null
  ? el('span', { class: 'muted' }, 'needs 4+ attempts')
  : el('span', { class: t > 0 ? 'trend up' : t < 0 ? 'trend down' : 'trend' }, `${t > 0 ? '▲ +' : t < 0 ? '▼ ' : '■ '}${t} pts`);

function skillCard(skill: SectionSkill, s: SkillHistory, scale: { yMin: number; yMax: number; yTicks: number[] }): HTMLElement {
  const marked = s.points.filter((p): p is typeof p & { band: number } => p.band !== null);
  const shown = marked.slice(-MAX_POINTS);
  const waiting = s.points.length - marked.length;
  const points: LinePoint[] = shown.map(p => ({
    y: p.band, x: fmtShortDate(p.date), href: `#/result/${p.attemptId}`,
    tip: { value: `Band ${fmtBandValue(p.band)}`, head: fmtDate(p.date), sub: `${p.title}${p.total ? ` · ${p.raw}/${p.total}` : ''}` }
  }));
  return el('article', { class: `card skill-card mod-${skill}` },
    el('div', { class: 'card-head' }, skillBadge(skill), el('span', { class: 'muted' }, `${s.attempts} attempt${s.attempts === 1 ? '' : 's'}`)),
    el('div', { class: 'skill-stats' },
      el('div', null, el('small', null, 'Latest'), el('b', null, fmtBandValue(s.latestBand))),
      el('div', null, el('small', null, 'Average (last 5)'), el('b', null, fmtBandValue(s.averageBand))),
      el('div', null, el('small', null, 'Best'), el('b', null, fmtBandValue(s.bestBand)))),
    points.length
      ? lineChart({ points, ...scale, yFormat: v => (Number.isInteger(v) ? String(v) : v.toFixed(1)), label: `${SKILL_LABEL[skill]} band over time` })
      : el('p', { class: 'muted chart-empty' }, skill === 'writing' || skill === 'speaking' ? 'Bands appear here once Claude has marked your answers.' : 'No bands yet.'),
    waiting ? el('p', { class: 'muted chart-note' }, `${waiting} attempt${waiting === 1 ? '' : 's'} not marked yet${skill === 'writing' || skill === 'speaking' ? ' — ask Claude: “Mark my last attempt”' : ''}.`) : null,
    marked.length > MAX_POINTS ? el('p', { class: 'muted chart-note' }, `The chart shows the last ${MAX_POINTS} of ${marked.length}; the table has all of them.`) : null,
    s.points.length ? el('details', { class: 'details table-view' }, el('summary', null, 'Show the numbers'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table compact' },
        el('thead', null, el('tr', null, ['Date', 'Test', 'Band', 'Score'].map(x => el('th', null, x)))),
        el('tbody', null, [...s.points].reverse().map(p => el('tr', { class: 'clickable', onclick: () => { location.hash = `#/result/${p.attemptId}`; } },
          el('td', { class: 'nowrap' }, fmtShortDate(p.date)),
          el('td', null, p.title),
          el('td', null, el('b', null, fmtBandValue(p.band))),
          el('td', { class: 'nowrap' }, p.total ? `${p.raw} / ${p.total}` : '–'))))))) : null);
}

function typeCard(t: TypeHistory): HTMLElement {
  const shown = t.points.slice(-MAX_POINTS);
  const points: LinePoint[] = shown.map(p => ({
    y: pct(p.raw, p.total), x: fmtShortDate(p.date), href: `#/result/${p.attemptId}`,
    tip: { value: `${pct(p.raw, p.total)}%`, head: fmtDate(p.date), sub: `${p.title} · ${p.raw}/${p.total} correct` }
  }));
  const name = TYPE_LABEL[t.type] ?? t.type;
  return el('article', { class: 'card type-card' },
    el('div', { class: 'type-head' },
      el('b', { class: 'type-name' }, name),
      el('span', { class: 'type-acc' }, `${pct(t.raw, t.total)}%`)),
    el('div', { class: 'type-sub muted' }, `${t.raw} / ${t.total} correct · ${t.points.length} attempt${t.points.length === 1 ? '' : 's'} · `, trendText(t.trend)),
    lineChart({ points, yMin: 0, yMax: 100, yTicks: [100, 50, 0], yFormat: v => `${v}%`, label: `${name} accuracy over time`, height: 120 }));
}
