/*
 * Vocabulary bank (Phase 8, ielts-site-spec.md item 2): one card per set; a set page with Table, Flashcards and Test me.
 * Marking a word on the page (or in a flashcard) is saved at once.
 */
import { WORD_STATUSES, type VocabSetSummary, type VocabSetView, type VocabWordRow, type WordStatus } from '@ielts/shared';
import { api } from '../lib/api';
import { el, setChildren } from '../lib/dom';
import { fmtDay } from '../lib/format';
import { toast } from '../lib/ui';
import { appHeader } from './common';

const STATUS_LABEL: Record<WordStatus, string> = { new: 'New', learning: 'Learning', learned: 'Learned', weak: 'Weak' };
const setName = (s: { number: number | null; theme: string }) => `${s.number !== null ? `Set ${s.number}: ` : ''}${s.theme}`;
const statusChip = (s: WordStatus) => el('span', { class: `word-status st-${s}` }, STATUS_LABEL[s]);

/** a thin segmented bar of word statuses, with the counts beside it */
function statusBar(by: Record<WordStatus, number>, total: number): HTMLElement {
  const order: WordStatus[] = ['learned', 'learning', 'weak', 'new'];
  return el('div', { class: 'status-bar-wrap' },
    el('div', { class: 'status-bar', role: 'img', 'aria-label': order.map(s => `${by[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(', ') },
      order.filter(s => by[s]).map(s => el('span', { class: `sb-${s}`, style: { width: `${(by[s] / Math.max(1, total)) * 100}%` }, title: `${STATUS_LABEL[s]}: ${by[s]}` }))),
    el('div', { class: 'status-legend' }, order.filter(s => by[s]).map(s => el('span', null, el('i', { class: `sb-${s}` }), `${by[s]} ${STATUS_LABEL[s].toLowerCase()}`))));
}

export async function mountVocab(root: HTMLElement): Promise<void> {
  const sets = await api<VocabSetSummary[]>('/vocab/sets');
  const page = el('div', { class: 'page' });
  root.append(appHeader('Vocabulary'), page);
  if (!sets.length) {
    page.appendChild(el('div', { class: 'empty' }, el('h3', null, 'No vocabulary sets yet'), el('p', null, 'Ask Claude in claude.ai to move your Vocabulary Bank onto the site.')));
    return;
  }
  const all = sets.reduce((acc, s) => { for (const k of WORD_STATUSES) acc[k] += s.byStatus[k]; return acc; }, { new: 0, learning: 0, learned: 0, weak: 0 } as Record<WordStatus, number>);
  const total = sets.reduce((n, s) => n + s.words, 0);
  page.append(
    el('section', { class: 'card vocab-total' }, el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, `${total} words in ${sets.length} set${sets.length === 1 ? '' : 's'}`)), statusBar(all, total)),
    el('div', { class: 'set-grid' }, sets.map(s => el('a', { class: 'card set-card', href: `#/vocab/${encodeURIComponent(s.id)}` },
      el('div', { class: 'set-card-top' }, s.number !== null ? el('span', { class: 'set-num' }, String(s.number)) : null, el('b', null, s.theme)),
      el('div', { class: 'muted set-meta' }, `${s.words} words${s.studyDay !== null ? ` · Day ${s.studyDay}` : ''}`),
      statusBar(s.byStatus, s.words),
      el('div', { class: 'set-last' }, s.lastResult
        ? `Last self-test: ${s.lastResult.score}/${s.lastResult.total} on ${fmtDay(s.lastResult.date)}`
        : el('span', { class: 'muted' }, 'No self-test yet'))))));
}

export async function mountVocabSet(root: HTMLElement, id: string): Promise<void> {
  const v = await api<VocabSetView>(`/vocab/sets/${encodeURIComponent(id)}`);
  const words = v.set.words;
  const page = el('div', { class: 'page vocab-set' });
  root.append(appHeader('Vocabulary', true), page);
  const by = Object.fromEntries(WORD_STATUSES.map(s => [s, words.filter(w => w.status === s).length])) as Record<WordStatus, number>;
  const summary = el('div');
  const drawSummary = () => {
    for (const s of WORD_STATUSES) by[s] = words.filter(w => w.status === s).length;
    summary.replaceChildren(statusBar(by, words.length));
  };
  drawSummary();

  const save = async (w: VocabWordRow, patch: { status?: WordStatus; timesMissed?: number }) => {
    try {
      const next = await api<VocabWordRow>(`/vocab/sets/${encodeURIComponent(id)}/words`, { method: 'PATCH', body: { word: w.word, ...patch } });
      Object.assign(w, next);
      drawSummary();
    } catch (e) { toast((e as Error).message, 'err'); }
  };

  const tabs = ['Table', 'Flashcards', 'Test me'] as const;
  let tab: (typeof tabs)[number] = 'Table';
  const tabBar = el('div', { class: 'seg', role: 'tablist' });
  const body = el('div', { class: 'vocab-body' });
  const draw = () => {
    tabBar.replaceChildren(...tabs.map(t => el('button', { type: 'button', role: 'tab', class: `seg-btn${t === tab ? ' on' : ''}`, 'aria-selected': String(t === tab), onclick: () => { tab = t; draw(); } }, t)));
    body.replaceChildren(tab === 'Table' ? tableView(words, save) : tab === 'Flashcards' ? flashcards(words, save) : testView(v));
  };
  page.append(
    el('a', { class: 'back-link', href: '#/vocab' }, '← All sets'),
    el('header', { class: 'lesson-head' }, el('h1', null, setName(v.set)), el('p', { class: 'muted' }, `${words.length} words${v.set.studyDay !== null ? ` · introduced on Day ${v.set.studyDay}` : ''}`), summary),
    el('div', { class: 'toolbar' }, tabBar), body);
  draw();
}

function statusSelect(w: VocabWordRow, save: (w: VocabWordRow, p: { status: WordStatus }) => Promise<void>): HTMLElement {
  const sel = el('select', { class: `input status-select st-${w.status}`, 'aria-label': `Status of ${w.word}` },
    WORD_STATUSES.map(s => el('option', { value: s, selected: s === w.status }, STATUS_LABEL[s])));
  sel.addEventListener('change', async () => { await save(w, { status: sel.value as WordStatus }); sel.className = `input status-select st-${w.status}`; });
  return sel;
}

function tableView(words: VocabWordRow[], save: (w: VocabWordRow, p: { status?: WordStatus }) => Promise<void>): HTMLElement {
  return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', { class: 'table vocab-table' },
    el('thead', null, el('tr', null, ['Word', 'Arabic', 'Meaning', 'Opposite', 'Example', 'Status'].map(h => el('th', null, h)))),
    el('tbody', null, words.map(w => el('tr', null,
      el('td', null, el('b', { class: 'vw' }, w.word), w.pos ? el('span', { class: 'muted pos' }, ` ${w.pos}`) : null, w.timesMissed ? el('div', { class: 'missed' }, `missed ${w.timesMissed}×`) : null),
      el('td', { class: 'ar', dir: 'rtl', lang: 'ar' }, w.arabic ?? ''),
      el('td', null, w.meaning ?? ''),
      el('td', null, w.opposite ?? ''),
      el('td', null, w.example ? el('i', null, w.example) : null, w.trap ? el('div', { class: 'trap' }, '⚠ ', w.trap) : null),
      el('td', null, statusSelect(w, save))))))));
}

function flashcards(all: VocabWordRow[], save: (w: VocabWordRow, p: { status?: WordStatus; timesMissed?: number }) => Promise<void>): HTMLElement {
  let only: 'all' | 'notLearned' | 'weak' = 'all';
  let deck: VocabWordRow[] = [];
  let i = 0, shown = false, knew = 0, missed = 0;
  const wrap = el('div', { class: 'fc-wrap' });
  const pick = () => { deck = all.filter(w => only === 'all' || (only === 'weak' ? w.status === 'weak' : w.status !== 'learned')); i = 0; shown = false; };
  const shuffle = () => { for (let k = deck.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [deck[k], deck[j]] = [deck[j]!, deck[k]!]; } i = 0; shown = false; draw(); };
  const next = (d: number) => { i = Math.max(0, Math.min(deck.length - 1, i + d)); shown = false; draw(); };
  const answer = async (ok: boolean) => {
    const w = deck[i];
    if (!w) return;
    if (ok) { knew++; await save(w, { status: w.status === 'learning' || w.status === 'learned' ? 'learned' : 'learning' }); }
    else { missed++; await save(w, { status: 'weak', timesMissed: w.timesMissed + 1 }); }
    if (i < deck.length - 1) next(1); else draw();
  };
  const draw = () => {
    const w = deck[i];
    setChildren(wrap,
      el('div', { class: 'fc-tools' },
        el('div', { class: 'seg' }, ([['all', 'All words'], ['notLearned', 'Not learned yet'], ['weak', 'Weak only']] as const).map(([k, label]) =>
          el('button', { type: 'button', class: `seg-btn${only === k ? ' on' : ''}`, onclick: () => { only = k; pick(); draw(); } }, label))),
        el('button', { type: 'button', class: 'btn btn-sm', onclick: shuffle }, '🔀 Shuffle'),
        el('span', { class: 'muted' }, deck.length ? `${i + 1} / ${deck.length}` : '', knew || missed ? ` · ✓ ${knew}  ✗ ${missed}` : '')),
      !w ? el('p', { class: 'empty' }, 'No words here.') : el('div', {
        class: `flashcard${shown ? ' shown' : ''}`, tabindex: '0', role: 'button', 'aria-label': shown ? 'Card, answer shown' : 'Card: tap to show the answer',
        onclick: () => { shown = !shown; draw(); }
      },
      el('div', { class: 'fc-word' }, w.word, w.pos ? el('span', { class: 'pos' }, ` ${w.pos}`) : null),
      shown
        ? el('div', { class: 'fc-back' },
          w.arabic ? el('div', { class: 'fc-ar', dir: 'rtl', lang: 'ar' }, w.arabic) : null,
          w.meaning ? el('div', { class: 'fc-meaning' }, w.meaning) : null,
          w.opposite ? el('div', null, el('small', { class: 'muted' }, 'Opposite: '), w.opposite) : null,
          w.example ? el('div', { class: 'fc-example' }, w.example) : null,
          w.trap ? el('div', { class: 'trap' }, '⚠ ', w.trap) : null)
        : el('div', { class: 'muted fc-hint' }, 'Say the meaning, then tap to check')),
      w ? el('div', { class: 'fc-actions' },
        el('button', { type: 'button', class: 'btn', disabled: i === 0, onclick: () => next(-1) }, '←'),
        el('button', { type: 'button', class: 'btn btn-bad', onclick: () => answer(false) }, '✗ Not yet'),
        el('button', { type: 'button', class: 'btn btn-good', onclick: () => answer(true) }, '✓ I knew it'),
        el('button', { type: 'button', class: 'btn', disabled: i >= deck.length - 1, onclick: () => next(1) }, '→')) : null);
    (wrap.querySelector('.flashcard') as HTMLElement | null)?.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); shown = !shown; draw(); (wrap.querySelector('.flashcard') as HTMLElement | null)?.focus(); }
      else if (e.key === 'ArrowRight') next(1);
      else if (e.key === 'ArrowLeft') next(-1);
    });
  };
  pick();
  draw();
  return wrap;
}

function testView(v: VocabSetView): HTMLElement {
  return el('div', null,
    el('section', { class: 'card' }, el('h3', { class: 'card-title' }, 'Quizzes for this set'),
      v.tests.length
        ? el('div', { class: 'row-actions' }, v.tests.map(t => el('a', { class: 'btn', href: `#/test/${t.id}` }, `▶ ${t.title}`)))
        : el('p', { class: 'muted' }, 'No quiz yet. Ask Claude for a quiz on this set.')),
    el('section', { class: 'card' }, el('h3', { class: 'card-title' }, 'Self-test log'),
      v.results.length
        ? el('div', { class: 'table-wrap' }, el('table', { class: 'table compact' },
          el('thead', null, el('tr', null, ['Date', 'Quiz', 'Score', 'Weak words'].map(h => el('th', null, h)))),
          el('tbody', null, v.results.map(r => el('tr', null,
            el('td', { class: 'nowrap' }, fmtDay(r.date)),
            el('td', null, r.quiz !== null ? String(r.quiz) : '–'),
            el('td', { class: 'nowrap' }, el('b', null, `${r.score} / ${r.total}`), r.attemptId ? el('a', { href: `#/result/${r.attemptId}`, class: 'small-link' }, ' result') : null),
            el('td', null, r.weakWords.join(', ') || '–'))))))
        : el('p', { class: 'muted' }, 'No results yet.')));
}
