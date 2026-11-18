/*
 * Auto-scoring (spec §4): case-insensitive, trimmed, trailing full stop ignored; any string in accept[] counts,
 * with optional words in brackets; an answer over the word limit is wrong; a misspelling is wrong
 * (but labelled, and the exact typed answer is kept so Claude can show it).
 */
import { acceptedForms, countWords, describeWordLimit, expandOptional, fitsWordLimit, normalizeAnswer } from './answers';
import { estimateBand, type BandEstimate, type BandTable } from './config/band-tables';
import { listItems, sectionSkillOf } from './document';
import type { WordLimit } from './schema/common';
import type { QuestionGroup, QuestionType } from './schema/groups';
import { isCompletionType, isMatchingType } from './schema/groups';
import type { AnswerKey, Part, SectionSkill, Skill, TestContent } from './schema/test';

export type MarkReason = 'correct' | 'blank' | 'wrong' | 'over_word_limit' | 'likely_spelling';

export interface QuestionResult {
  questionId: string;
  /** one result per question number ("choose TWO" gives two) */
  number: number;
  type: QuestionType;
  partId: string;
  groupId: string;
  /** exactly what was typed / chosen (null when blank) */
  answer: string | null;
  /** the accepted answers, as written in the key */
  correctAnswers: string[];
  correct: boolean;
  reason: MarkReason;
  /** e.g. "3 words — limit: NO MORE THAN TWO WORDS"; "close to: dark surfaces" */
  note?: string;
  explanation?: string;
}

export interface ScoreTally { raw: number; total: number }

export interface OpenItemResult {
  id: string;
  type: QuestionType;
  partId: string;
  words: number;
  minWords?: number;
  answered: boolean;
}

export interface AutoScore {
  version: 1;
  raw: number;
  total: number;
  /** estimated band for single-skill reading / listening tests (null otherwise) */
  band: number | null;
  bandInfo: BandEstimate | null;
  /** per section in a mixed test, or the one section otherwise */
  sections: Partial<Record<SectionSkill, ScoreTally & { band: number | null; bandInfo: BandEstimate | null }>>;
  perPart: Record<string, ScoreTally>;
  perType: Partial<Record<QuestionType, ScoreTally>>;
  reasons: Record<MarkReason, number>;
  questions: QuestionResult[];
  /** writing / speaking answers, marked by Claude */
  openItems: OpenItemResult[];
  scoredAt: string;
}

/* ---------- spelling: optimal string alignment distance ---------- */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/**
 * The accepted answer this is probably a misspelling of, written as in the key (short words are never
 * treated as misspellings). Returns null when nothing is close.
 */
export function likelyMisspellingOf(answer: string, accept: readonly string[]): string | null {
  const a = normalizeAnswer(answer);
  let best: { shown: string; dist: number } | null = null;
  for (const spec of accept) {
    for (const variant of expandOptional(spec)) {
      const f = normalizeAnswer(variant);
      if (f.length < 5 || /^\d+$/.test(f)) continue;
      const allowed = f.length <= 8 ? 1 : 2;
      const dist = editDistance(a, f);
      if (dist > 0 && dist <= allowed && (!best || dist < best.dist)) best = { shown: variant.trim(), dist };
    }
  }
  return best?.shown ?? null;
}

/* ---------- one free-text or label answer ---------- */
function markText(answer: string, accept: string[], limit: WordLimit | undefined): { correct: boolean; reason: MarkReason; note?: string } {
  if (!normalizeAnswer(answer)) return { correct: false, reason: 'blank' };
  if (limit && !fitsWordLimit(answer, limit)) {
    const c = countWords(answer);
    const counted = `${c.words} word${c.words === 1 ? '' : 's'}${c.numbers ? ` + ${c.numbers} number${c.numbers === 1 ? '' : 's'}` : ''}`;
    return { correct: false, reason: 'over_word_limit', note: `${counted} — limit: ${describeWordLimit(limit)}` };
  }
  if (acceptedForms(accept).includes(normalizeAnswer(answer))) return { correct: true, reason: 'correct' };
  const near = likelyMisspellingOf(answer, accept);
  return near ? { correct: false, reason: 'likely_spelling', note: `close to “${near}”` } : { correct: false, reason: 'wrong' };
}

function markLabel(answer: string, accept: string[]): { correct: boolean; reason: MarkReason } {
  const a = String(answer ?? '').trim().toLowerCase();
  if (!a) return { correct: false, reason: 'blank' };
  return accept.some(x => x.trim().toLowerCase() === a) ? { correct: true, reason: 'correct' } : { correct: false, reason: 'wrong' };
}

/** does this group's answer come from a fixed list (letters, TRUE/FALSE…) rather than free text? */
function isLabelAnswer(g: QuestionGroup): boolean {
  if (g.type === 'tfng' || g.type === 'ynng' || g.type === 'mcq_single' || g.type === 'mcq_multi') return true;
  if (isMatchingType(g.type)) return true;
  return isCompletionType(g.type) && !!(g as { options?: unknown[] }).options?.length;
}

function bandTableFor(section: SectionSkill, variant: string): BandTable | null {
  if (section === 'listening') return 'listening';
  if (section === 'reading') return variant === 'general_training' ? 'general_reading' : 'academic_reading';
  return null;
}

const words = (v: unknown): number =>
  typeof v === 'string' ? countWords(v).words + countWords(v).numbers
    : v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v).reduce<number>((s, x) => s + (typeof x === 'string' ? countWords(x).words + countWords(x).numbers : 0), 0) : 0;

/** score a set of answers against the key */
export function scoreAnswers(skill: Skill, content: TestContent, key: AnswerKey, answers: Record<string, unknown>, now = new Date()): AutoScore {
  const questions: QuestionResult[] = [];
  const openItems: OpenItemResult[] = [];
  const groups = new Map<string, { g: QuestionGroup; part: Part }>();
  for (const part of content.parts) for (const g of part.questionGroups) groups.set(g.id, { g, part });

  for (const item of listItems(content.parts)) {
    const { g, part } = groups.get(item.groupId)!;
    const raw = answers[item.id];
    if (item.kind !== 'objective') {
      const min = 'minWords' in g ? (g as { minWords?: number }).minWords : undefined;
      openItems.push({ id: item.id, type: item.type, partId: part.id, words: words(raw), ...(min !== undefined ? { minWords: min } : {}), answered: words(raw) > 0 });
      continue;
    }
    const k = key[item.id];
    const accept = k?.accept ?? [];
    const base = { questionId: item.id, type: item.type, partId: part.id, groupId: g.id, correctAnswers: accept, ...(k?.explanation ? { explanation: k.explanation } : {}) };

    if (item.type === 'mcq_multi') {
      // each correct option chosen = 1 mark; correct choices fill the first numbers
      const chosen = Array.isArray(raw) ? [...new Set(raw.map(x => String(x).toUpperCase()))].sort() : [];
      const keySet = new Set(accept.map(a => a.trim().toUpperCase()));
      const right = chosen.filter(c => keySet.has(c));
      const wrong = chosen.filter(c => !keySet.has(c));
      item.numbers.forEach((number, i) => {
        const pick = right[i] ?? wrong[i - right.length] ?? null;
        const correct = i < right.length;
        questions.push({ ...base, number, answer: pick, correct, reason: correct ? 'correct' : pick === null ? 'blank' : 'wrong' });
      });
      continue;
    }

    const answer = typeof raw === 'string' && raw.trim() ? raw : null;
    const limit = 'wordLimit' in g ? (g as { wordLimit?: WordLimit }).wordLimit : undefined;
    const r = answer === null ? { correct: false, reason: 'blank' as const } : isLabelAnswer(g) ? markLabel(answer, accept) : markText(answer, accept, limit);
    for (const number of item.numbers) questions.push({ ...base, number, answer, ...r });
  }
  questions.sort((a, b) => a.number - b.number);

  const tally = (list: QuestionResult[]): ScoreTally => ({ raw: list.filter(q => q.correct).length, total: list.length });
  const perPart: Record<string, ScoreTally> = {};
  const perType: Partial<Record<QuestionType, ScoreTally>> = {};
  const reasons: Record<MarkReason, number> = { correct: 0, blank: 0, wrong: 0, over_word_limit: 0, likely_spelling: 0 };
  for (const q of questions) {
    (perPart[q.partId] ??= { raw: 0, total: 0 }).total++;
    (perType[q.type] ??= { raw: 0, total: 0 }).total++;
    if (q.correct) { perPart[q.partId]!.raw++; perType[q.type]!.raw++; }
    reasons[q.reason]++;
  }

  const sections: AutoScore['sections'] = {};
  for (const part of content.parts) {
    const s = sectionSkillOf(part, skill);
    if (!s || (s !== 'reading' && s !== 'listening')) continue;
    const t = sections[s] ?? { raw: 0, total: 0, band: null, bandInfo: null };
    t.raw += perPart[part.id]?.raw ?? 0;
    t.total += perPart[part.id]?.total ?? 0;
    sections[s] = t;
  }
  for (const [s, t] of Object.entries(sections) as Array<[SectionSkill, NonNullable<AutoScore['sections'][SectionSkill]>]>) {
    const table = bandTableFor(s, content.variant);
    t.bandInfo = table ? estimateBand(table, t.raw, t.total) : null;
    t.band = t.bandInfo?.band ?? null;
  }
  const only = Object.values(sections);
  const total = tally(questions);
  const single = only.length === 1 ? only[0]! : null;
  return {
    version: 1,
    ...total,
    band: single?.band ?? null,
    bandInfo: single?.bandInfo ?? null,
    sections, perPart, perType, reasons, questions, openItems,
    scoredAt: now.toISOString()
  };
}
