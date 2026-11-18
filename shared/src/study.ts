/*
 * Study material besides tests (Phase 8, ielts-site-spec.md items 1–3): lessons, the vocabulary bank with its
 * self-test log, and the mistakes log. The same zod schemas check the MCP tools and the website API.
 */
import { z } from 'zod';

const Text = z.string({ error: 'must be a string' });
const NonEmpty = Text.trim().min(1, { error: 'must not be empty' });
/** "day23-band-6-7-8", "set-3", "task2-method" */
export const Slug = z.string({ error: 'must be a string id like "day23-band-6-7-8"' })
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/, { error: 'must use letters, digits, "-" or "_" (up to 80), e.g. "day23-band-6-7-8" or "set-3"' });
const Day = z.number({ error: 'must be a day number such as 23' }).int({ error: 'must be a whole number' }).min(0).max(999);
const IsoDate = z.string({ error: 'must be a date like 2026-11-18' }).regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'must be a date like 2026-11-18' });

/* ---------------------------------------------------------------- lessons */

export const LESSON_SKILLS = ['reading', 'listening', 'writing', 'speaking', 'vocabulary', 'general'] as const;
export const LESSON_KINDS = ['lesson', 'reference'] as const;

export const LessonSection = z.strictObject({
  heading: NonEmpty.optional(),
  /** text: **bold**, *italic*, "- " bullets, "1. " steps, "# " sub-headings */
  markdown: NonEmpty.optional(),
  table: z.strictObject({
    header: z.array(Text).min(1, { error: 'needs at least one column' }),
    rows: z.array(z.array(Text))
  }).optional(),
  examples: z.array(z.strictObject({ label: Text.optional(), text: NonEmpty, notes: z.array(Text).optional() })).min(1).optional(),
  /** a highlighted box (like the blue boxes in the Word files) */
  tip: NonEmpty.optional()
}).refine(s => s.markdown || s.table || s.examples || s.tip || s.heading, { error: 'a section needs at least one of: heading, markdown, table, examples, tip' });

export const Lesson = z.strictObject({
  id: Slug,
  title: NonEmpty,
  day: Day.optional(),
  /** the study week, e.g. "writing", "reading", "listening" */
  week: NonEmpty.optional(),
  skill: z.enum(LESSON_SKILLS, { error: `must be one of: ${LESSON_SKILLS.join(', ')}` }).optional(),
  /** "reference" = a permanent page (method, rules, phrase bank) */
  kind: z.enum(LESSON_KINDS, { error: 'must be "lesson" or "reference"' }).default('lesson'),
  /** one line shown in the list */
  summary: Text.optional(),
  sections: z.array(LessonSection).min(1, { error: 'needs at least one section' }),
  relatedTestIds: z.array(z.uuid({ error: 'must be a test id (uuid) from list_tests' })).optional(),
  vocabularySetIds: z.array(Slug).optional()
});
export type Lesson = z.output<typeof Lesson>;
export type LessonInput = z.input<typeof Lesson>;
export type LessonSection = z.output<typeof LessonSection>;

export interface LessonSummary {
  id: string; title: string; day: number | null; week: string | null; skill: string | null; kind: 'lesson' | 'reference';
  summary: string | null; updatedAt: string;
}
export interface LessonView {
  lesson: Lesson;
  updatedAt: string;
  tests: Array<{ id: string; title: string; skill: string; status: string }>;
  vocabularySets: Array<{ id: string; theme: string; number: number | null }>;
}

/* ---------------------------------------------------------------- vocabulary */

export const WORD_STATUSES = ['new', 'learning', 'learned', 'weak'] as const;
export type WordStatus = (typeof WORD_STATUSES)[number];

export const VocabWord = z.strictObject({
  word: NonEmpty,
  /** part of speech: n, v, adj, adv, phr … */
  pos: Text.optional(),
  arabic: Text.optional(),
  meaning: Text.optional(),
  opposite: Text.optional(),
  /** the near-miss trap: "mitigate risks/effects; alleviate pain/poverty" */
  trap: Text.optional(),
  example: Text.optional(),
  status: z.enum(WORD_STATUSES, { error: `must be one of: ${WORD_STATUSES.join(', ')}` }).optional(),
  timesMissed: z.number().int().min(0).optional()
});
export type VocabWordInput = z.input<typeof VocabWord>;
export interface VocabWordRow extends Omit<z.output<typeof VocabWord>, 'status' | 'timesMissed'> { status: WordStatus; timesMissed: number }

export const VocabSet = z.strictObject({
  id: Slug,
  number: z.number().int().min(0).optional(),
  theme: NonEmpty,
  /** the study day the set was introduced (the review rule counts from it) */
  studyDay: Day.optional(),
  words: z.array(VocabWord).min(1, { error: 'needs at least one word' })
}).superRefine((s, ctx) => {
  const seen = new Map<string, number>();
  s.words.forEach((w, i) => {
    const k = w.word.trim().toLowerCase();
    if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['words', i, 'word'], message: `"${w.word}" is already words[${seen.get(k)}]` });
    else seen.set(k, i);
  });
});
export type VocabSetInput = z.input<typeof VocabSet>;

export const VocabResult = z.strictObject({
  setId: Slug,
  quiz: z.number().int().min(1).optional(),
  date: IsoDate,
  score: z.number().int().min(0),
  total: z.number().int().min(1),
  weakWords: z.array(NonEmpty).optional(),
  attemptId: z.uuid().optional()
}).refine(r => r.score <= r.total, { error: 'score cannot be more than total', path: ['score'] });
export type VocabResultInput = z.input<typeof VocabResult>;

export interface VocabResultRow { id: string; setId: string; quiz: number | null; date: string; score: number; total: number; weakWords: string[]; attemptId: string | null }
export interface VocabSetSummary {
  id: string; number: number | null; theme: string; studyDay: number | null; words: number;
  byStatus: Record<WordStatus, number>; lastResult: VocabResultRow | null; updatedAt: string;
}
export interface VocabSetView {
  set: { id: string; number: number | null; theme: string; studyDay: number | null; words: VocabWordRow[] };
  results: VocabResultRow[];
  /** tests linked to this set (a vocabulary quiz with "vocabularySetId") */
  tests: Array<{ id: string; title: string; status: string }>;
}

export const WordPatch = z.strictObject({
  word: NonEmpty,
  status: z.enum(WORD_STATUSES).optional(),
  timesMissed: z.number().int().min(0).optional()
});

/* ---------------------------------------------------------------- mistakes log */

export const MISTAKE_CATEGORIES = ['spelling', 'grammar', 'capitals', 'word_choice', 'collocation', 'reading_trap'] as const;
export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];
export const MISTAKE_CATEGORY_LABEL: Record<MistakeCategory, string> = {
  spelling: 'Spelling', grammar: 'Grammar', capitals: 'Capitals', word_choice: 'Word choice', collocation: 'Collocation', reading_trap: 'Reading traps'
};

/** "Word choice", "word-choice", "reading trap" … -> the category, or null */
export function mistakeCategoryOf(c: unknown): MistakeCategory | null {
  const k = typeof c === 'string' ? c.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/s$/, '') : '';
  const alias: Record<string, MistakeCategory> = { capital: 'capitals', capitalisation: 'capitals', capitalization: 'capitals', vocabulary: 'word_choice', lexis: 'word_choice', trap: 'reading_trap', tfng: 'reading_trap' };
  return (MISTAKE_CATEGORIES as readonly string[]).includes(k) ? k as MistakeCategory
    : (MISTAKE_CATEGORIES as readonly string[]).includes(`${k}s`) ? `${k}s` as MistakeCategory
      : alias[k] ?? null;
}

export const MistakeInput = z.strictObject({
  category: z.enum(MISTAKE_CATEGORIES, { error: `must be one of: ${MISTAKE_CATEGORIES.join(', ')}` }),
  /** what I wrote (for reading traps: my answer) */
  wrong: NonEmpty,
  /** the correct form (for reading traps: the right answer) */
  correct: NonEmpty,
  /** the rule to remember, e.g. "experi-ence, like science and evidence" or "many ≠ most" */
  rule: Text.optional(),
  arabic: Text.optional(),
  source: z.strictObject({ date: IsoDate.optional(), attemptId: z.uuid().optional(), label: Text.optional() }).optional(),
  /** a new entry starts at this count (default 1); adding an existing wrong → correct pair adds 1 */
  timesWrong: z.number().int().min(1).optional(),
  /** set automatically at 2 or more */
  neverAgain: z.boolean().optional()
});
export type MistakeInput = z.input<typeof MistakeInput>;

export const MISTAKE_STATUSES = ['active', 'mastered'] as const;
export interface MistakeRow {
  id: string; category: MistakeCategory; wrong: string; correct: string; rule: string | null; arabic: string | null;
  source: { date?: string; attemptId?: string; label?: string } | null;
  timesWrong: number; neverAgain: boolean; streak: number; status: 'active' | 'mastered';
  lastReviewedOn: string | null; createdAt: string; updatedAt: string;
}

export const MistakePatch = z.strictObject({
  category: z.enum(MISTAKE_CATEGORIES).optional(),
  wrong: NonEmpty.optional(),
  correct: NonEmpty.optional(),
  rule: Text.nullable().optional(),
  arabic: Text.nullable().optional(),
  timesWrong: z.number().int().min(1).optional(),
  neverAgain: z.boolean().optional(),
  streak: z.number().int().min(0).optional(),
  status: z.enum(MISTAKE_STATUSES).optional()
});

/** POST /api/mistakes/:id/review — one answer in the daily review */
export const MistakeReviewBody = z.strictObject({ correct: z.boolean(), today: IsoDate });

/** a correct daily review 3 days in a row masters an entry ("tick it ✓") */
export const MASTERED_AFTER = 3;

/** the same pair, however it is typed: "Experiance " -> "experiance" */
export const pairKey = (wrong: string, correct: string) => `${wrong.trim().toLowerCase().replace(/\s+/g, ' ')}→${correct.trim().toLowerCase().replace(/\s+/g, ' ')}`;

/** checks a typed answer in the review: capitals count only in the "capitals" category */
export function reviewMatches(typed: string, correct: string, category: MistakeCategory): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/[.]$/, '').replace(/[’‘]/g, "'");
  return category === 'capitals' ? norm(typed) === norm(correct) : norm(typed).toLowerCase() === norm(correct).toLowerCase();
}

/** zod issues -> [{ path: "sections[2].table.rows", message }] */
export function zodIssueList(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map(i => ({
    path: i.path.reduce<string>((acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : acc ? `${acc}.${String(p)}` : String(p)), '') || '(top level)',
    message: i.message
  }));
}
