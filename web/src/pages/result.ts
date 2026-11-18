/* Results page (spec §5.4): every answer vs the correct answer, the reason when wrong, raw score, estimated band, time used. */
import { wordDiff, type Feedback, type FeedbackMistake, type MarkReason, type OpenItemResult, type QuestionGroup, type QuestionResult, type ResultView } from '@ielts/shared';
import { api } from '../lib/api';
import { el, type Child } from '../lib/dom';
import { fmtDate, fmtDuration, wordCount } from '../lib/format';
import { inlineMd, mdBlock, mdRich } from '../lib/markup';
import { appHeader, fmtBandValue, REASON_LABEL, skillBadge, TYPE_LABEL } from './common';

export async function mountResult(root: HTMLElement, attemptId: string): Promise<void> {
  const r = await api<ResultView>(`/attempts/${attemptId}/result`);
  const s = r.autoScore;
  const parts = r.test.content.parts;
  const groupOf = new Map<string, QuestionGroup>();
  for (const p of parts) for (const g of p.questionGroups) groupOf.set(g.id, g);
  const page = el('div', { class: 'page results' });
  root.append(appHeader('Results', true), page);

  /* ---------- summary ---------- */
  const pct = s.total ? Math.round((s.raw / s.total) * 100) : 0;
  const bandNote = s.bandInfo
    ? s.bandInfo.scaled ? `Estimated band · based on ${s.bandInfo.basedOn} question${s.bandInfo.basedOn === 1 ? '' : 's'} (≈ ${s.bandInfo.scaledRaw}/40)` : 'Estimated band'
    : r.test.skill === 'writing' || r.test.skill === 'speaking' ? 'Band from Claude’s marking' : 'Estimated band';
  // a vocabulary quiz has no band: the circle shows the share of right answers
  const vocab = r.test.skill === 'vocabulary';
  page.appendChild(el('section', { class: 'card hero' },
    el('div', { class: 'hero-band' }, el('div', { class: 'band-num' }, vocab ? `${pct}%` : fmtBandValue(s.band ?? feedbackBand(r))), el('div', { class: 'band-label' }, vocab ? 'Right answers · vocabulary quiz' : bandNote)),
    el('div', { class: 'hero-info' },
      el('div', { class: 'badges' }, skillBadge(r.test.skill), el('span', { class: 'badge' }, r.attempt.mode === 'exam' ? 'Exam mode' : 'Practice mode')),
      el('h2', null, r.test.title),
      el('div', { class: 'hero-rows' },
        s.total ? el('div', null, el('small', null, 'Score'), el('b', null, `${s.raw} / ${s.total}`)) : null,
        s.total ? el('div', null, el('small', null, 'Accuracy'), el('b', null, `${pct}%`)) : null,
        el('div', null, el('small', null, 'Time used'), el('b', null, fmtDuration(r.attempt.timeUsedSec))),
        el('div', null, el('small', null, 'Submitted'), el('b', null, fmtDate(r.attempt.submittedAt)))),
      r.attempt.autoSubmitted ? el('p', { class: 'pill-warn inline-note' }, 'Time ran out, so the answers saved at that moment were submitted.') : null,
      r.test.content.vocabularySetId ? el('p', { class: 'inline-note muted' }, 'Saved in the self-test log of ', el('a', { href: `#/vocab/${encodeURIComponent(r.test.content.vocabularySetId)}` }, 'this vocabulary set'), '; missed words are marked weak.') : null,
      el('div', { class: 'row-actions' },
        el('a', { class: 'btn btn-primary', href: `#/review/${r.attempt.id}` }, '🔍 Review in the test'),
        el('a', { class: 'btn', href: `#/test/${r.test.id}` }, '↻ Take again')))));

  // per-section bands in a full mock
  const sections = Object.entries(s.sections);
  if (sections.length > 1) {
    page.appendChild(el('section', { class: 'section-cards' }, sections.map(([sec, t]) => el('div', { class: `card sec-card mod-${sec}` },
      skillBadge(sec as 'reading'), el('div', { class: 'sec-band' }, fmtBandValue(t?.band)), el('div', { class: 'sec-sub' }, `${t?.raw ?? 0} / ${t?.total ?? 0} correct · estimated band`)))));
  }

  /* ---------- Claude's feedback: near the top, because it is the main thing once it exists ---------- */
  const fb = r.feedback ? routeFeedback(r.feedback, s.questions, s.openItems) : null;
  if (r.feedback && fb) page.appendChild(feedbackCard(r.feedback, fb, parts));

  /* ---------- breakdowns ---------- */
  if (s.total) {
    const bar = (label: string, raw: number, total: number) => el('div', { class: 'bd-row' },
      el('span', { class: 'bd-label', title: label }, label),
      el('div', { class: 'bd-track' }, el('div', { class: 'bd-fill', style: { width: `${total ? (raw / total) * 100 : 0}%` } })),
      el('b', { class: 'bd-val' }, `${raw}/${total}`));
    page.appendChild(el('div', { class: 'grid-2' },
      el('section', { class: 'card' }, el('h3', { class: 'card-title' }, 'By part'),
        parts.filter(p => s.perPart[p.id]).map(p => bar(p.title, s.perPart[p.id]!.raw, s.perPart[p.id]!.total))),
      el('section', { class: 'card' }, el('h3', { class: 'card-title' }, 'By question type'),
        Object.entries(s.perType).map(([t, v]) => bar(TYPE_LABEL[t as keyof typeof TYPE_LABEL] ?? t, v!.raw, v!.total)))));
    const mistakes = (['over_word_limit', 'likely_spelling', 'wrong', 'blank'] as MarkReason[]).filter(k => s.reasons[k]);
    if (mistakes.length) {
      page.appendChild(el('div', { class: 'reason-chips' }, el('b', null, 'Mistakes: '),
        mistakes.map(k => el('span', { class: `reason reason-${k}` }, `${s.reasons[k]} × ${REASON_LABEL[k].toLowerCase()}`))));
    }
  }

  /* ---------- every question, part by part ---------- */
  for (const part of parts) {
    const qs = s.questions.filter(q => q.partId === part.id);
    if (qs.length) {
      page.appendChild(el('section', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', { class: 'card-title' }, part.title), el('span', { class: 'muted' }, `${s.perPart[part.id]?.raw ?? 0} / ${s.perPart[part.id]?.total ?? 0}`)),
        el('div', { class: 'table-wrap' }, el('table', { class: 'table answers' },
          el('thead', null, el('tr', null, ['Q', 'Your answer', 'Correct answer', 'Result'].map(h => el('th', null, h)))),
          el('tbody', null, qs.map((q, i) => answerRow(q, groupOf.get(q.groupId), fb, qs[i - 1]?.questionId !== q.questionId)))))));
    }
    if (part.transcript) {
      page.appendChild(el('details', { class: 'card details transcript-card' }, el('summary', null, `${part.title} — transcript`), el('div', { html: mdBlock(part.transcript) })));
    }
  }

  /* ---------- writing / speaking ---------- */
  /* ---------- sentence rewrite: one table per task ---------- */
  const rewriteOf = new Map<string, Extract<QuestionGroup, { type: 'sentence_rewrite' }>>();
  for (const p of parts) for (const g of p.questionGroups) if (g.type === 'sentence_rewrite') for (const it of g.items) rewriteOf.set(it.id, g);
  for (const g of new Set(rewriteOf.values())) page.appendChild(rewriteCard(r, g, fb));

  for (const item of s.openItems) {
    if (rewriteOf.has(item.id)) continue;
    const part = parts.find(p => p.id === item.partId);
    const g = part?.questionGroups.find(x => x.id === item.id) ?? part?.questionGroups.find(x => 'questions' in x && (x.questions as Array<{ id: string }>).some(q => q.id === item.id));
    const v = r.attempt.answers[item.id];
    const drill = v && typeof v === 'object' && !Array.isArray(v) ? v as { plan?: string; introduction?: string } : null;
    const text = typeof v === 'string' ? v : drill ? Object.entries(drill).map(([k, x]) => `${k === 'plan' ? 'PLAN' : 'INTRODUCTION'}\n${x ?? ''}`).join('\n\n') : '';
    const short = item.minWords !== undefined && item.words < item.minWords;
    const corrected = fb?.correctedFor === item.id ? r.feedback?.correctedText : undefined;
    const notes = fb?.byItem.get(item.id) ?? [];
    const empty = el('span', { class: 'muted' }, item.type.startsWith('speaking') ? 'Nothing typed or transcribed.' : 'No answer written.');
    page.appendChild(el('section', { class: 'card item-card', id: `item-${item.id}` },
      el('div', { class: 'card-head' },
        el('h3', { class: 'card-title' }, `${part?.title ?? ''} · ${TYPE_LABEL[item.type]}`),
        item.minWords !== undefined ? el('span', { class: short ? 'pill-bad' : 'pill-ok' }, `${wordCount(text)} words${short ? ` (minimum ${item.minWords})` : ' ✓'}`) : null),
      g && 'prompt' in g ? el('details', { class: 'details' }, el('summary', null, 'Task'), el('div', { html: mdBlock(g.prompt) })) : null,
      g ? speakingQuestion(g, item.id) : null,
      corrected
        // a plan + introduction drill is compared on its introduction; the plan is shown as it was
        ? [drill?.plan ? el('div', { class: 'essay' }, `PLAN\n${drill.plan}`) : null, compareView(drill ? drill.introduction ?? '' : text, corrected)]
        : el('div', { class: 'essay' }, text || empty),
      notes.length ? el('div', { class: 'item-notes' }, el('h4', null, `Claude’s notes on this answer (${notes.length})`), el('ul', { class: 'fb-mistakes' }, notes.map(m => mistakeItem(m, null)))) : null,
      extrasFor(r, item.id),
      r.modelAnswers[item.id] ? el('details', { class: 'details' }, el('summary', null, 'Model answer'), el('div', { class: 'essay', html: mdBlock(r.modelAnswers[item.id]) })) : null,
      r.feedback ? null : el('p', { class: 'muted' }, 'Claude marks writing and speaking: in claude.ai, ask “Mark my last attempt”.')));
  }

  const blocks = studyBlocks(r);
  if (blocks) page.appendChild(blocks);

  if (!r.feedback) {
    page.appendChild(el('section', { class: 'card feedback-card' },
      el('h3', { class: 'card-title' }, 'Claude’s feedback'),
      el('p', { class: 'muted' }, 'No feedback yet. In claude.ai, ask Claude: “Mark my last attempt”. The marking appears here.')));
  }
}

function answerRow(q: QuestionResult, g: QuestionGroup | undefined, fb: RoutedFeedback | null, first: boolean): HTMLElement {
  const notes = first ? fb?.byQuestion.get(q.questionId) ?? [] : [];
  const optionText = (label: string | null) => {
    if (!label || !g || !('options' in g) || !Array.isArray(g.options)) return '';
    if (typeof g.options[0] === 'string') return ''; // multiple choice options are shown by letter
    const o = (g.options as Array<{ label: string; text: string }>).find(x => x.label.toLowerCase() === label.toLowerCase());
    return o?.text ? ` — ${o.text}` : '';
  };
  return el('tr', { class: `${q.correct ? 'ok' : 'bad'}${notes.length ? ' has-note' : ''}`, id: first ? `ans-${q.questionId}` : null },
    el('td', null, el('b', null, String(q.number))),
    el('td', null, q.answer === null ? el('span', { class: 'muted' }, '— not answered —') : el('span', { class: 'typed' }, q.answer, optionText(q.answer))),
    // "choose TWO": every listed letter is needed; elsewhere the list holds alternatives
    el('td', null, q.type === 'mcq_multi' ? q.correctAnswers.join(', ')
      : q.correctAnswers.map((a, i) => [i ? el('span', { class: 'muted' }, ' / ') : null, a, q.correctAnswers.length === 1 ? optionText(a) : ''])),
    el('td', { class: 'mark-cell' },
      el('span', { class: `reason reason-${q.reason}` }, q.correct ? '✓ Correct' : `✗ ${REASON_LABEL[q.reason]}`),
      q.note ? el('div', { class: 'note' }, q.note) : null,
      q.explanation ? el('div', { class: 'explanation', html: inlineMd(q.explanation) }) : null,
      notes.map(m => el('div', { class: 'claude-note' }, el('b', null, 'Claude: '), m.category ? el('span', { class: 'fb-cat' }, m.category) : null, ' ', el('span', { html: inlineMd(m.explanation) })))));
}

/** the question a speaking answer belongs to */
function speakingQuestion(g: QuestionGroup, itemId: string): HTMLElement | null {
  if (g.type === 'speaking_part2') {
    if (g.id === itemId) return el('p', { class: 'sp-question' }, el('b', null, 'Cue card: '), g.cueCard.topic);
    const f = g.followUps.find(q => q.id === itemId);
    return f ? el('p', { class: 'sp-question' }, el('b', null, 'Question: '), f.text) : null;
  }
  if (g.type === 'speaking_part1' || g.type === 'speaking_part3') {
    const q = g.questions.find(x => x.id === itemId);
    return q ? el('p', { class: 'sp-question' }, el('b', null, 'Question: '), q.text) : null;
  }
  return null;
}

/** a speaking recording, Part 2 notes, or the drill's stage times */
function extrasFor(r: ResultView, itemId: string): HTMLElement | null {
  const rec = r.recordings?.[itemId];
  const prep = r.attempt.state[`prep:${itemId}`];
  const plan = r.attempt.state[`plan:${itemId}`];
  const drill = r.attempt.state[`drill:${itemId}`] as { planSec?: number; introSec?: number } | undefined;
  const bits: HTMLElement[] = [];
  if (rec) bits.push(el('div', { class: 'rec-result' }, el('span', null, '🎙 Your recording'), el('audio', { controls: true, preload: 'none', src: rec.url }), rec.durationSec ? el('span', { class: 'muted' }, fmtDuration(rec.durationSec)) : null));
  if (typeof plan === 'string' && plan.trim()) bits.push(el('details', { class: 'details' }, el('summary', null, 'Your plan'), el('div', { class: 'essay' }, plan)));
  if (typeof prep === 'string' && prep.trim()) bits.push(el('details', { class: 'details' }, el('summary', null, 'Your preparation notes'), el('div', { class: 'essay' }, prep)));
  if (drill && (drill.planSec || drill.introSec)) bits.push(el('p', { class: 'muted' }, `Time: plan ${fmtDuration(drill.planSec ?? 0)} · introduction ${fmtDuration(drill.introSec ?? 0)}`));
  return bits.length ? el('div', { class: 'item-extras' }, bits) : null;
}

function feedbackBand(r: ResultView): number | null {
  const b = r.feedback?.overallBand;
  return typeof b === 'number' ? b : null;
}

/* ---------------------------------------------------------------- Claude's feedback (spec §6 "Feedback JSON") */

interface RoutedFeedback {
  /** mistakes about an objective question, by question id (shown in that answer row too) */
  byQuestion: Map<string, FeedbackMistake[]>;
  /** mistakes about a writing / speaking answer, by item id (shown in that answer's card) */
  byItem: Map<string, FeedbackMistake[]>;
  /** everything else, only in the feedback card */
  general: FeedbackMistake[];
  /** the writing / speaking answer the corrected text belongs to; null = shown in the feedback card */
  correctedFor: string | null;
  questionNumber: Map<string, number>;
  items: OpenItemResult[];
}

/** sends every mistake to where it belongs; "q14", "Q14" and "14" all find question 14 */
function routeFeedback(f: Feedback, questions: QuestionResult[], items: OpenItemResult[]): RoutedFeedback {
  const questionNumber = new Map<string, number>();
  for (const q of questions) if (!questionNumber.has(q.questionId)) questionNumber.set(q.questionId, q.number);
  const byNumber = new Map(questions.map(q => [q.number, q.questionId]));
  const itemIds = new Set(items.map(i => i.id));
  const out: RoutedFeedback = { byQuestion: new Map(), byItem: new Map(), general: [], correctedFor: null, questionNumber, items };
  const add = (map: Map<string, FeedbackMistake[]>, id: string, m: FeedbackMistake) => map.set(id, [...(map.get(id) ?? []), m]);
  for (const m of Array.isArray(f.mistakes) ? f.mistakes : []) {
    const id = typeof m.questionId === 'string' ? m.questionId.trim() : '';
    const num = /^q?(\d+)$/i.exec(id)?.[1];
    if (questionNumber.has(id)) add(out.byQuestion, id, m);
    else if (itemIds.has(id)) add(out.byItem, id, m);
    else if (num && byNumber.has(Number(num))) add(out.byQuestion, byNumber.get(Number(num))!, m);
    else out.general.push(m);
  }
  if (typeof f.correctedText === 'string' && f.correctedText.trim()) {
    const writing = items.filter(i => i.type === 'writing_task1' || i.type === 'writing_task2' || i.type === 'paragraph');
    out.correctedFor = writing.length === 1 ? writing[0]!.id : items.length === 1 ? items[0]!.id : null;
  }
  return out;
}

const CRITERIA: Record<string, string> = {
  TR: 'Task Response', TA: 'Task Achievement', CC: 'Coherence and Cohesion', LR: 'Lexical Resource',
  GRA: 'Grammatical Range and Accuracy', FC: 'Fluency and Coherence', P: 'Pronunciation'
};
/** the official order (the database does not keep the order of keys): Writing TR/TA CC LR GRA, Speaking FC LR GRA P */
function orderCriteria(list: Array<[string, number]>): Array<[string, number]> {
  const speaking = list.some(([k]) => ['FC', 'P'].includes(k.toUpperCase()));
  const order = speaking ? ['FC', 'LR', 'GRA', 'P'] : ['TR', 'TA', 'CC', 'LR', 'GRA'];
  const rank = (k: string) => { const i = order.indexOf(k.toUpperCase()); return i < 0 ? order.length : i; };
  return [...list].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}
const KNOWN_FIELDS = new Set(['overallBand', 'criteria', 'summary', 'mistakes', 'correctedText', 'nextSteps', 'savedAt']);

/** scrolls to an answer row or card and flashes it */
function jumpTo(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('flash');
  void target.offsetWidth; // restart the animation
  target.classList.add('flash');
}

function mistakeItem(m: FeedbackMistake, ref: Child): HTMLElement {
  const fix = m.yourAnswer || m.correct;
  return el('li', { class: 'fb-mistake' },
    el('div', { class: 'fb-mistake-head' },
      ref,
      m.category ? el('span', { class: 'fb-cat' }, m.category) : null,
      fix ? el('span', { class: 'fb-fix' },
        m.yourAnswer ? el('span', { class: 'fb-yours' }, m.yourAnswer) : null,
        m.yourAnswer && m.correct ? el('span', { class: 'fb-arrow', 'aria-label': 'should be' }, '→') : null,
        m.correct ? el('span', { class: 'fb-right' }, m.correct) : null) : null),
    el('div', { class: 'fb-expl', html: inlineMd(m.explanation) }));
}

function feedbackCard(f: Feedback, fb: RoutedFeedback, parts: ResultView['test']['content']['parts']): HTMLElement {
  const criteria = f.criteria && typeof f.criteria === 'object' ? orderCriteria(Object.entries(f.criteria).filter((e): e is [string, number] => typeof e[1] === 'number')) : [];
  const steps = Array.isArray(f.nextSteps) ? f.nextSteps.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  const qMistakes = [...fb.byQuestion.entries()].sort((a, b) => (fb.questionNumber.get(a[0]) ?? 0) - (fb.questionNumber.get(b[0]) ?? 0));
  const itemNotes = fb.items.filter(i => fb.byItem.has(i.id));
  const total = qMistakes.reduce((n, [, list]) => n + list.length, 0) + fb.general.length + itemNotes.reduce((n, i) => n + fb.byItem.get(i.id)!.length, 0);
  const extras = Object.entries(f).filter(([k, v]) => !KNOWN_FIELDS.has(k) && v !== null && v !== undefined && v !== '');
  const savedAt = typeof f.savedAt === 'string' ? f.savedAt : null;
  const itemName = (i: OpenItemResult) => (parts.length > 1 ? `${parts.find(p => p.id === i.partId)?.title ?? ''} · ` : '') + TYPE_LABEL[i.type];

  return el('section', { class: 'card feedback-card has-feedback' },
    el('div', { class: 'card-head' },
      el('h3', { class: 'card-title' }, '✓ Claude’s feedback'),
      savedAt ? el('span', { class: 'muted fb-saved' }, `Marked by Claude on ${fmtDate(savedAt)}`) : null),

    typeof f.overallBand === 'number' || criteria.length
      ? el('div', { class: 'fb-bands' },
        typeof f.overallBand === 'number' ? el('div', { class: 'fb-overall' }, el('small', null, 'Overall band'), el('b', null, f.overallBand.toFixed(1))) : null,
        criteria.length ? el('div', { class: 'fb-criteria', role: 'list', 'aria-label': 'Band for each criterion' }, criteria.map(([k, v]) => {
          const name = CRITERIA[k.toUpperCase()];
          return el('div', { class: 'crit-row', role: 'listitem', title: `${name ?? k}: band ${v.toFixed(1)} of 9` },
            el('span', { class: 'crit-name' }, name ?? k, name ? el('span', { class: 'muted' }, ` (${k})`) : null),
            el('span', { class: 'crit-track' }, el('span', { class: 'crit-fill', style: { width: `${(v / 9) * 100}%` } })),
            el('b', { class: 'crit-val' }, v.toFixed(1)));
        })) : null)
      : null,

    typeof f.summary === 'string' ? el('div', { class: 'fb-summary', html: mdRich(f.summary) }) : null,

    total ? el('div', { class: 'fb-section' },
      el('h4', null, `Mistakes (${total})`),
      el('ul', { class: 'fb-mistakes' },
        qMistakes.flatMap(([qid, list]) => list.map(m => mistakeItem(m,
          el('button', { type: 'button', class: 'fb-ref', title: 'Show this question in the answers below', onclick: () => jumpTo(`ans-${qid}`) }, `Q${fb.questionNumber.get(qid) ?? qid}`)))),
        itemNotes.map(i => el('li', { class: 'fb-mistake fb-item-link' },
          el('button', { type: 'button', class: 'fb-ref', title: 'Show this answer below', onclick: () => jumpTo(`item-${i.id}`) }, itemName(i)),
          ` ${fb.byItem.get(i.id)!.length} note${fb.byItem.get(i.id)!.length === 1 ? '' : 's'} next to your answer below.`)),
        fb.general.map(m => mistakeItem(m, m.questionId ? el('span', { class: 'fb-ref static' }, m.questionId) : null)))) : null,

    steps.length ? el('div', { class: 'fb-section' }, el('h4', null, 'Next steps'), el('ol', { class: 'fb-steps' }, steps.map(x => el('li', { html: inlineMd(x) })))) : null,

    typeof f.correctedText === 'string' && f.correctedText.trim() && !fb.correctedFor
      ? el('details', { class: 'details fb-section' }, el('summary', null, 'Corrected version'), el('div', { class: 'essay' }, f.correctedText))
      : null,

    extras.length ? el('div', { class: 'fb-section fb-extras' }, extras.map(([k, v]) => el('div', { class: 'fb-extra' }, el('h4', null, humanize(k)), extraValue(v)))) : null);
}

/** "bandJustification" / "band_justification" -> "Band justification" */
function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** a field the page does not know (the format allows extras): shown as escaped text, never as HTML */
function extraValue(v: unknown): HTMLElement {
  if (typeof v === 'string') return el('div', { html: mdRich(v) });
  if (typeof v === 'number' || typeof v === 'boolean') return el('p', null, String(v));
  if (Array.isArray(v) && v.every(x => typeof x === 'string')) return el('ul', null, v.map(x => el('li', { html: inlineMd(x) })));
  return el('pre', { class: 'fb-json' }, JSON.stringify(v, null, 2));
}

/** the student's answer next to Claude's corrected version, with the changed words marked on both sides */
function compareView(original: string, corrected: string): HTMLElement {
  const d = wordDiff(original, corrected);
  const side = (label: string, pieces: Child, cls: string) => el('div', { class: `cmp-side ${cls}` }, el('div', { class: 'cmp-label' }, label), el('div', { class: 'essay' }, pieces));
  if (!d) return el('div', { class: 'compare' }, side('Your answer', original, 'cmp-yours'), side('Corrected by Claude', corrected, 'cmp-fixed'));
  return el('div', { class: 'compare-wrap' },
    el('p', { class: 'cmp-legend muted' },
      el('del', { class: 'diff-del' }, 'crossed out'), ' = removed or changed · ', el('ins', { class: 'diff-ins' }, 'highlighted'), ' = Claude’s wording',
      ` · ${d.removed} word${d.removed === 1 ? '' : 's'} out, ${d.added} in`),
    el('div', { class: 'compare' },
      side('Your answer', d.before.map(p => (p.changed ? el('del', { class: 'diff-del' }, p.text) : p.text)), 'cmp-yours'),
      side('Corrected by Claude', d.after.map(p => (p.changed ? el('ins', { class: 'diff-ins' }, p.text) : p.text)), 'cmp-fixed')));
}

/** a sentence-rewrite task: the sentence, your version, the model, and Claude's verdict per sentence (feedback "items") */
function rewriteCard(r: ResultView, g: Extract<QuestionGroup, { type: 'sentence_rewrite' }>, fb: RoutedFeedback | null): HTMLElement {
  const verdicts = new Map((Array.isArray(r.feedback?.items) ? r.feedback.items : []).map(v => [v.itemId, v]));
  const right = g.items.filter(it => verdicts.get(it.id)?.correct === true).length;
  const marked = g.items.filter(it => typeof verdicts.get(it.id)?.correct === 'boolean').length;
  return el('section', { class: 'card item-card', id: `item-${g.items[0]?.id ?? g.id}` },
    el('div', { class: 'card-head' },
      el('h3', { class: 'card-title' }, g.title ?? TYPE_LABEL.sentence_rewrite),
      marked ? el('span', { class: right === marked ? 'pill-ok' : 'pill-warn' }, `${right} / ${marked} right`) : el('span', { class: 'muted' }, 'Waiting for Claude’s marking')),
    g.instructions ? el('div', { class: 'muted', html: mdBlock(g.instructions) }) : null,
    el('div', { class: 'table-wrap' }, el('table', { class: 'table rewrite-table' },
      el('thead', null, el('tr', null, ['#', 'Sentence', 'Your version', 'Model', 'Claude'].map(h => el('th', null, h)))),
      el('tbody', null, g.items.map((it, i) => {
        const v = verdicts.get(it.id);
        const ans = r.attempt.answers[it.id];
        const notes = fb?.byItem.get(it.id) ?? [];
        return el('tr', { id: `item-${it.id}`, class: v?.correct === true ? 'ok' : v?.correct === false ? 'bad' : '' },
          el('td', null, el('b', null, String(it.number ?? i + 1))),
          el('td', { class: 'rw-src', html: inlineMd(it.text) }),
          el('td', null, typeof ans === 'string' && ans.trim() ? el('span', { class: 'rw-yours' }, ans) : el('span', { class: 'muted' }, '— no answer —')),
          el('td', null, r.modelAnswers[it.id] ? el('span', { html: inlineMd(r.modelAnswers[it.id]!) }) : el('span', { class: 'muted' }, '–')),
          el('td', { class: 'mark-cell' },
            v && typeof v.correct === 'boolean' ? el('span', { class: `reason ${v.correct ? 'reason-correct' : 'reason-wrong'}` }, v.correct ? '✓ Right' : '✗ Not yet') : null,
            typeof v?.comment === 'string' && v.comment ? el('div', { class: 'explanation', html: inlineMd(v.comment) }) : null,
            typeof v?.corrected === 'string' && v.corrected ? el('div', { class: 'rw-fixed' }, '→ ', v.corrected) : null,
            notes.map(m => el('div', { class: 'claude-note' }, el('span', { html: inlineMd(m.explanation) })))));
      })))));
}

/** the sittings this attempt took (the runner's "blocks" log) */
function studyBlocks(r: ResultView): HTMLElement | null {
  const list = Array.isArray(r.attempt.state.blocks) ? (r.attempt.state.blocks as Array<{ start: string; end: string; sec: number; words: number }>).filter(b => b && typeof b.start === 'string' && b.sec >= 30) : [];
  if (!list.length) return null;
  const total = list.reduce((n, b) => n + b.sec, 0);
  return el('details', { class: 'card details blocks-card' },
    el('summary', null, `Study blocks: ${list.length} sitting${list.length === 1 ? '' : 's'}, ${fmtDuration(total)} of work`),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table compact' },
      el('thead', null, el('tr', null, ['Started', 'Worked', 'Words by the end'].map(h => el('th', null, h)))),
      el('tbody', null, list.map((b, i) => el('tr', null,
        el('td', { class: 'nowrap' }, fmtDate(b.start)),
        el('td', { class: 'nowrap' }, fmtDuration(b.sec)),
        el('td', null, `${b.words}${i > 0 && b.words - list[i - 1]!.words > 0 ? ` (+${b.words - list[i - 1]!.words})` : ''}`)))))));
}
