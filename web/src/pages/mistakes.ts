/*
 * My Mistakes (Phase 8, ielts-site-spec.md item 3): tabs per category, the "never again" banner, and a 5-minute daily
 * review that hides the correct form, asks for it, and asks for 3 practice entries after a wrong answer.
 * A right answer on 3 different days in a row masters the entry ("tick it ✓").
 */
import { MASTERED_AFTER, MISTAKE_CATEGORIES, MISTAKE_CATEGORY_LABEL, reviewMatches, type MistakeCategory, type MistakeRow } from '@ielts/shared';
import { api } from '../lib/api';
import { el, setChildren } from '../lib/dom';
import { fmtDay, formatClock } from '../lib/format';
import { toast } from '../lib/ui';
import { appHeader } from './common';

const REVIEW_SEC = 5 * 60;
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function mountMistakes(root: HTMLElement): Promise<void> {
  let rows = await api<MistakeRow[]>('/mistakes');
  const page = el('div', { class: 'page mistakes-page' });
  root.append(appHeader('My mistakes'), page);
  let tab: MistakeCategory | 'all' = 'all';
  let showMastered = false;

  const draw = () => {
    const never = rows.filter(m => m.neverAgain && m.status === 'active').slice(0, 10);
    const inTab = rows.filter(m => tab === 'all' || m.category === tab);
    const shown = inTab.filter(m => showMastered || m.status === 'active');
    const due = rows.filter(m => m.status === 'active' && m.lastReviewedOn !== todayStr()).length;
    setChildren(page,
      never.length ? el('section', { class: 'never-banner' },
        el('div', { class: 'never-title' }, '🚫 Never again'),
        el('div', { class: 'never-words' }, never.map(m => el('span', { class: 'never-word', title: m.rule ?? '' }, el('s', null, m.wrong), ' → ', el('b', null, m.correct))))) : null,
      el('div', { class: 'review-cta card' },
        el('div', null, el('b', null, '5-minute daily review'), el('div', { class: 'muted' }, due ? `${due} entr${due === 1 ? 'y' : 'ies'} waiting today. Right ${MASTERED_AFTER} days in a row = mastered.` : 'Everything has been reviewed today. 👍')),
        el('button', { type: 'button', class: 'btn btn-primary', disabled: !due, onclick: () => review(page, rows, tab, async () => { rows = await api<MistakeRow[]>('/mistakes'); draw(); }) }, '▶ Start the review')),
      el('div', { class: 'toolbar mistakes-tabs' },
        el('div', { class: 'seg', role: 'tablist' },
          (['all', ...MISTAKE_CATEGORIES] as const).map(c => {
            const n = rows.filter(m => (c === 'all' || m.category === c) && m.status === 'active').length;
            return el('button', { type: 'button', role: 'tab', class: `seg-btn${tab === c ? ' on' : ''}`, 'aria-selected': String(tab === c), onclick: () => { tab = c; draw(); } },
              c === 'all' ? 'All' : MISTAKE_CATEGORY_LABEL[c], n ? el('span', { class: 'tab-count' }, String(n)) : null);
          })),
        el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: showMastered, onchange: (e: Event) => { showMastered = (e.target as HTMLInputElement).checked; draw(); } }), ' Show mastered')),
      !rows.length
        ? el('div', { class: 'empty' }, el('h3', null, 'The log is empty'), el('p', null, 'Ask Claude to move your Misspelled Words list here, or to add mistakes when it marks an essay.'))
        : el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', { class: 'table mistakes-table' },
          el('thead', null, el('tr', null, ['Wrong', 'Correct', 'Rule', 'Times', 'Review', ''].map(h => el('th', null, h)))),
          el('tbody', null, shown.length ? shown.map(m => el('tr', { class: m.status === 'mastered' ? 'mastered' : '' },
            el('td', null, el('s', { class: 'm-wrong' }, m.wrong), m.neverAgain ? el('span', { class: 'never-tag', title: 'Never again' }, ' 🚫') : null,
              tab === 'all' ? el('div', { class: 'muted m-cat' }, MISTAKE_CATEGORY_LABEL[m.category]) : null),
            el('td', null, el('b', { class: 'm-right' }, m.correct), m.arabic ? el('div', { class: 'ar', dir: 'rtl', lang: 'ar' }, m.arabic) : null),
            el('td', { class: 'm-rule' }, m.rule ?? '', m.source?.label ? el('div', { class: 'muted m-src' }, `from ${m.source.label}${m.source.date ? `, ${fmtDay(m.source.date)}` : ''}`) : null),
            el('td', { class: 'nowrap' }, `${m.timesWrong}×`),
            el('td', { class: 'nowrap' }, m.status === 'mastered' ? el('span', { class: 'pill-ok' }, '✓ Mastered') : el('span', { class: 'streak' }, streakDots(m.streak))),
            el('td', { class: 'nowrap' }, el('button', {
              type: 'button', class: 'btn btn-ghost btn-sm', title: m.status === 'mastered' ? 'Put back in the review' : 'Mark as mastered',
              onclick: async () => {
                try {
                  const next = await api<MistakeRow>(`/mistakes/${m.id}`, { method: 'PATCH', body: m.status === 'mastered' ? { status: 'active', streak: 0 } : { status: 'mastered' } });
                  rows = rows.map(r => (r.id === next.id ? next : r)); draw();
                } catch (e) { toast((e as Error).message, 'err'); }
              }
            }, m.status === 'mastered' ? '↺' : '✓'))))
            : el('tr', null, el('td', { colspan: '6', class: 'muted' }, 'Nothing here.')))))));
  };
  draw();
}

const streakDots = (n: number) => el('span', { 'aria-label': `${n} of ${MASTERED_AFTER} days in a row` },
  Array.from({ length: MASTERED_AFTER }, (_, i) => el('i', { class: `dot${i < n ? ' on' : ''}` })));

/** the review: one entry at a time until the 5 minutes are up or nothing is left */
function review(page: HTMLElement, rows: MistakeRow[], tab: MistakeCategory | 'all', done: () => Promise<void>): void {
  const today = todayStr();
  const queue = rows.filter(m => m.status === 'active' && m.lastReviewedOn !== today && (tab === 'all' || m.category === tab))
    .sort((a, b) => Number(b.neverAgain) - Number(a.neverAgain) || b.timesWrong - a.timesWrong || (a.lastReviewedOn ?? '').localeCompare(b.lastReviewedOn ?? ''));
  if (!queue.length) { toast('Nothing to review in this tab today.'); return; }
  const started = Date.now();
  let right = 0, wrong = 0, mastered = 0, i = 0, timeUp = false;
  const clock = el('span', { class: 'rv-clock' }, formatClock(REVIEW_SEC));
  const box = el('div', { class: 'review-box' });
  const timer = window.setInterval(() => {
    const left = REVIEW_SEC - (Date.now() - started) / 1000;
    clock.textContent = formatClock(Math.max(0, left));
    if (left <= 0) { timeUp = true; clock.classList.add('up'); clock.textContent = 'time’s up — finish this one'; window.clearInterval(timer); }
  }, 500);
  const finish = () => {
    window.clearInterval(timer);
    box.replaceChildren(el('div', { class: 'rv-card rv-end' },
      el('h2', null, timeUp ? '⏱ Time’s up' : '🎉 All done'),
      el('p', null, `${right} right, ${wrong} to practise again${mastered ? `, ${mastered} mastered ✓` : ''}.`),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => { void done(); } }, 'Back to my mistakes')));
  };
  const next = () => { i++; if (timeUp || i >= queue.length) finish(); else ask(); };
  const ask = () => {
    const m = queue[i]!;
    const input = el('input', { class: 'input rv-input', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': 'Type the correct form' });
    const form = el('form', { class: 'rv-card' },
      el('div', { class: 'rv-top' }, el('span', { class: 'badge' }, MISTAKE_CATEGORY_LABEL[m.category]), m.neverAgain ? el('span', { class: 'never-tag' }, '🚫 never again') : null, el('span', { class: 'muted' }, `${i + 1} / ${queue.length}`)),
      el('div', { class: 'rv-prompt' }, el('small', null, m.category === 'reading_trap' ? 'Your answer was' : 'You wrote'), el('s', null, m.wrong)),
      m.category === 'reading_trap' && m.rule ? null : m.arabic ? el('div', { class: 'ar rv-hint', dir: 'rtl', lang: 'ar' }, m.arabic) : null,
      el('label', { class: 'rv-label' }, m.category === 'reading_trap' ? 'The right answer:' : 'Type it correctly:', input),
      el('button', { class: 'btn btn-primary', type: 'submit' }, 'Check'));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const ok = reviewMatches(input.value, m.correct, m.category);
      let after: MistakeRow | null = null;
      try { after = await api<MistakeRow>(`/mistakes/${m.id}/review`, { method: 'POST', body: { correct: ok, today } }); } catch (err) { toast((err as Error).message, 'err'); }
      if (ok) {
        right++;
        if (after?.status === 'mastered') mastered++;
        box.replaceChildren(el('div', { class: 'rv-card rv-ok' },
          el('div', { class: 'rv-verdict' }, '✓ ', el('b', null, m.correct)),
          after?.status === 'mastered' ? el('p', null, 'Mastered — right 3 days in a row. ✓') : el('p', null, streakDots(after?.streak ?? 0), ` ${after?.streak ?? 0} of ${MASTERED_AFTER} days`),
          m.rule ? el('p', { class: 'muted' }, m.rule) : null,
          nextButton()));
      } else {
        wrong++;
        practise(m);
      }
    });
    box.replaceChildren(form);
    input.focus();
  };
  const nextButton = () => { const b = el('button', { type: 'button', class: 'btn btn-primary', onclick: next }, timeUp || i >= queue.length - 1 ? 'Finish' : 'Next →'); setTimeout(() => b.focus(), 0); return b; };
  /** after a wrong answer: the correct form and the rule, then type it 3 times */
  const practise = (m: MistakeRow) => {
    const inputs = [0, 1, 2].map(k => el('input', { class: 'input rv-input', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', 'aria-label': `Practice ${k + 1}` }));
    const go = el('button', { type: 'button', class: 'btn btn-primary', disabled: true, onclick: next }, 'Next →');
    const check = () => {
      let all = true;
      for (const inp of inputs) { const good = reviewMatches(inp.value, m.correct, m.category); inp.classList.toggle('good', good); all &&= good; }
      go.disabled = !all;
    };
    inputs.forEach((inp, k) => inp.addEventListener('input', () => { check(); if (reviewMatches(inp.value, m.correct, m.category)) inputs[k + 1]?.focus(); }));
    box.replaceChildren(el('div', { class: 'rv-card rv-bad' },
      el('div', { class: 'rv-verdict' }, '✗ It is ', el('b', null, m.correct)),
      m.rule ? el('p', { class: 'rv-rule' }, m.rule) : null,
      el('p', { class: 'muted' }, 'Type it 3 times to fix it in memory:'),
      el('div', { class: 'rv-practice' }, inputs), go));
    inputs[0]!.focus();
  };
  page.replaceChildren(el('div', { class: 'review-head' },
    el('h2', null, '5-minute review'), clock,
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { window.clearInterval(timer); void done(); } }, 'Stop')), box);
  ask();
}
