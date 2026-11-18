/* Results page (spec §5.4): every answer vs the correct answer, the reason when wrong, raw score, estimated band, time used. */
import { type MarkReason, type QuestionGroup, type QuestionResult, type ResultView } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { fmtDate, fmtDuration, wordCount } from '../lib/format';
import { inlineMd, mdBlock } from '../lib/markup';
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
  page.appendChild(el('section', { class: 'card hero' },
    el('div', { class: 'hero-band' }, el('div', { class: 'band-num' }, fmtBandValue(s.band ?? feedbackBand(r))), el('div', { class: 'band-label' }, bandNote)),
    el('div', { class: 'hero-info' },
      el('div', { class: 'badges' }, skillBadge(r.test.skill), el('span', { class: 'badge' }, r.attempt.mode === 'exam' ? 'Exam mode' : 'Practice mode')),
      el('h2', null, r.test.title),
      el('div', { class: 'hero-rows' },
        s.total ? el('div', null, el('small', null, 'Score'), el('b', null, `${s.raw} / ${s.total}`)) : null,
        s.total ? el('div', null, el('small', null, 'Accuracy'), el('b', null, `${pct}%`)) : null,
        el('div', null, el('small', null, 'Time used'), el('b', null, fmtDuration(r.attempt.timeUsedSec))),
        el('div', null, el('small', null, 'Submitted'), el('b', null, fmtDate(r.attempt.submittedAt)))),
      r.attempt.autoSubmitted ? el('p', { class: 'pill-warn inline-note' }, 'Time ran out, so the answers saved at that moment were submitted.') : null,
      el('div', { class: 'row-actions' },
        el('a', { class: 'btn btn-primary', href: `#/review/${r.attempt.id}` }, '🔍 Review in the test'),
        el('a', { class: 'btn', href: `#/test/${r.test.id}` }, '↻ Take again')))));

  // per-section bands in a full mock
  const sections = Object.entries(s.sections);
  if (sections.length > 1) {
    page.appendChild(el('section', { class: 'section-cards' }, sections.map(([sec, t]) => el('div', { class: `card sec-card mod-${sec}` },
      skillBadge(sec as 'reading'), el('div', { class: 'sec-band' }, fmtBandValue(t?.band)), el('div', { class: 'sec-sub' }, `${t?.raw ?? 0} / ${t?.total ?? 0} correct · estimated band`)))));
  }

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
          el('tbody', null, qs.map(q => answerRow(q, groupOf.get(q.groupId))))))));
    }
    if (part.transcript) {
      page.appendChild(el('details', { class: 'card details transcript-card' }, el('summary', null, `${part.title} — transcript`), el('div', { html: mdBlock(part.transcript) })));
    }
  }

  /* ---------- writing / speaking ---------- */
  for (const item of s.openItems) {
    const part = parts.find(p => p.id === item.partId);
    const g = part?.questionGroups.find(x => x.id === item.id) ?? part?.questionGroups.find(x => 'questions' in x && (x.questions as Array<{ id: string }>).some(q => q.id === item.id));
    const v = r.attempt.answers[item.id];
    const text = typeof v === 'string' ? v : v && typeof v === 'object' && !Array.isArray(v) ? Object.entries(v).map(([k, x]) => `${k === 'plan' ? 'PLAN' : 'INTRODUCTION'}\n${x ?? ''}`).join('\n\n') : '';
    const short = item.minWords !== undefined && item.words < item.minWords;
    page.appendChild(el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h3', { class: 'card-title' }, `${part?.title ?? ''} · ${TYPE_LABEL[item.type]}`),
        item.minWords !== undefined ? el('span', { class: short ? 'pill-bad' : 'pill-ok' }, `${wordCount(text)} words${short ? ` (minimum ${item.minWords})` : ' ✓'}`) : null),
      g && 'prompt' in g ? el('details', { class: 'details' }, el('summary', null, 'Task'), el('div', { html: mdBlock(g.prompt) })) : null,
      g ? speakingQuestion(g, item.id) : null,
      el('div', { class: 'essay' }, text || el('span', { class: 'muted' }, item.type.startsWith('speaking') ? 'Nothing typed or transcribed.' : 'No answer written.')),
      extrasFor(r, item.id),
      r.modelAnswers[item.id] ? el('details', { class: 'details' }, el('summary', null, 'Model answer'), el('div', { class: 'essay', html: mdBlock(r.modelAnswers[item.id]) })) : null,
      el('p', { class: 'muted' }, 'Claude marks writing and speaking: in claude.ai, ask “Mark my last attempt”.')));
  }

  /* ---------- Claude's feedback ---------- */
  page.appendChild(el('section', { class: 'card feedback-card' },
    el('h3', { class: 'card-title' }, 'Claude’s feedback'),
    r.feedback ? feedbackBlock(r.feedback) : el('p', { class: 'muted' }, 'No feedback yet. After the connector is set up (Phase 5), Claude’s marking will appear here.')));
}

function answerRow(q: QuestionResult, g: QuestionGroup | undefined): HTMLElement {
  const optionText = (label: string | null) => {
    if (!label || !g || !('options' in g) || !Array.isArray(g.options)) return '';
    if (typeof g.options[0] === 'string') return ''; // multiple choice options are shown by letter
    const o = (g.options as Array<{ label: string; text: string }>).find(x => x.label.toLowerCase() === label.toLowerCase());
    return o?.text ? ` — ${o.text}` : '';
  };
  return el('tr', { class: q.correct ? 'ok' : 'bad' },
    el('td', null, el('b', null, String(q.number))),
    el('td', null, q.answer === null ? el('span', { class: 'muted' }, '— not answered —') : el('span', { class: 'typed' }, q.answer, optionText(q.answer))),
    // "choose TWO": every listed letter is needed; elsewhere the list holds alternatives
    el('td', null, q.type === 'mcq_multi' ? q.correctAnswers.join(', ')
      : q.correctAnswers.map((a, i) => [i ? el('span', { class: 'muted' }, ' / ') : null, a, q.correctAnswers.length === 1 ? optionText(a) : ''])),
    el('td', { class: 'mark-cell' },
      el('span', { class: `reason reason-${q.reason}` }, q.correct ? '✓ Correct' : `✗ ${REASON_LABEL[q.reason]}`),
      q.note ? el('div', { class: 'note' }, q.note) : null,
      q.explanation ? el('div', { class: 'explanation', html: inlineMd(q.explanation) }) : null));
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
  const drill = r.attempt.state[`drill:${itemId}`] as { planSec?: number; introSec?: number } | undefined;
  const bits: HTMLElement[] = [];
  if (rec) bits.push(el('div', { class: 'rec-result' }, el('span', null, '🎙 Your recording'), el('audio', { controls: true, preload: 'none', src: rec.url }), rec.durationSec ? el('span', { class: 'muted' }, fmtDuration(rec.durationSec)) : null));
  if (typeof prep === 'string' && prep.trim()) bits.push(el('details', { class: 'details' }, el('summary', null, 'Your preparation notes'), el('div', { class: 'essay' }, prep)));
  if (drill && (drill.planSec || drill.introSec)) bits.push(el('p', { class: 'muted' }, `Time: plan ${fmtDuration(drill.planSec ?? 0)} · introduction ${fmtDuration(drill.introSec ?? 0)}`));
  return bits.length ? el('div', { class: 'item-extras' }, bits) : null;
}

function feedbackBand(r: ResultView): number | null {
  const b = (r.feedback as { overallBand?: unknown } | null)?.overallBand;
  return typeof b === 'number' ? b : null;
}

/** a basic view of Claude's feedback; Phase 7 makes it richer */
function feedbackBlock(f: Record<string, unknown>): HTMLElement {
  const summary = typeof f.summary === 'string' ? f.summary : '';
  const steps = Array.isArray(f.nextSteps) ? (f.nextSteps as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return el('div', null,
    typeof f.overallBand === 'number' ? el('p', null, el('b', null, `Overall band: ${f.overallBand.toFixed(1)}`)) : null,
    summary ? el('div', { html: mdBlock(summary) }) : null,
    steps.length ? el('ul', null, steps.map(x => el('li', { html: inlineMd(x) }))) : null);
}
