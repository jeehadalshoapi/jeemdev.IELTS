import { z } from 'zod';
import { Id, Minutes, NonEmptyText, OptionalText, Url } from './common';
import { QuestionGroup } from './groups';

export const SKILLS = ['reading', 'listening', 'writing', 'speaking', 'vocabulary', 'mixed'] as const;
export const SECTION_SKILLS = ['reading', 'listening', 'writing', 'speaking', 'vocabulary'] as const;
export const KINDS = ['homework', 'practice', 'full_mock'] as const;
export const STATUSES = ['assigned', 'archived'] as const;
export const SOURCES = ['claude', 'manual'] as const;
export const VARIANTS = ['academic', 'general_training'] as const;

export type Skill = (typeof SKILLS)[number];
export type SectionSkill = (typeof SECTION_SKILLS)[number];
export type Kind = (typeof KINDS)[number];
export type TestStatus = (typeof STATUSES)[number];
export type Source = (typeof SOURCES)[number];
export type Variant = (typeof VARIANTS)[number];

const enumError = (values: readonly string[]) => ({ error: `must be one of: ${values.join(', ')}` });

/** a paragraph of a reading passage; "label" is the paragraph letter (A, B…) when the passage has them */
export const PassageParagraph = z.strictObject({
  label: z.string().trim().min(1).max(4, { error: 'must be a short label such as "A"' }).optional(),
  /** optional sub-heading shown above this paragraph */
  heading: OptionalText,
  /** plain text; **bold** and *italic* are allowed */
  text: NonEmptyText
});

export const Passage = z.strictObject({
  title: OptionalText,
  subtitle: OptionalText,
  paragraphs: z.array(PassageParagraph).min(1, { error: 'needs at least one paragraph' })
});

export const Part = z.strictObject({
  id: Id,
  title: NonEmptyText,
  /** required in a "mixed" test (e.g. a full mock): which section this part belongs to */
  skill: z.enum(SECTION_SKILLS, enumError(SECTION_SKILLS)).optional(),
  /** e.g. "Read the text and answer questions 1–13." */
  instructions: OptionalText,
  /** time for this part alone (used for section timers and 15-minute blocks) */
  timeLimitMin: Minutes.optional(),
  /** reading parts */
  passage: Passage.optional(),
  /** listening parts: recording (optional) and transcript (hidden until the attempt is submitted) */
  audioUrl: Url.optional(),
  transcript: OptionalText,
  /** read-aloud listening: seconds to look at the questions before the part starts (default 30; 0 = none) */
  readingTimeSec: z.number({ error: 'must be a number of seconds' }).int().min(0).max(120).optional(),
  questionGroups: z.array(QuestionGroup).min(1, { error: 'needs at least one question group' })
});

/** answer for one question (objective) or notes for one writing/speaking task */
export const AnswerKeyEntry = z.strictObject({
  /** every accepted answer; brackets mark optional words: "(the) dark surfaces" */
  accept: z.array(NonEmptyText).min(1, { error: 'needs at least one accepted answer' }).optional(),
  /** why this is the answer (shown after submission) */
  explanation: OptionalText,
  /** writing / speaking: a model answer shown after submission */
  modelAnswer: OptionalText,
  /** writing / speaking: marking notes for Claude */
  notes: OptionalText
});

export const AnswerKey = z.record(Id, AnswerKeyEntry, { error: 'must be an object: { "questionId": { "accept": ["…"] } }' });

/** the complete test as Claude (or the import box) sends it */
export const TestDocument = z.strictObject({
  title: NonEmptyText.max(200, { error: 'must be 200 characters or less' }),
  skill: z.enum(SKILLS, enumError(SKILLS)),
  kind: z.enum(KINDS, enumError(KINDS)).default('practice'),
  /** which band table to use for reading (Academic by default) */
  variant: z.enum(VARIANTS, enumError(VARIANTS)).default('academic'),
  /** whole-test time limit; leave out for no countdown */
  timeLimitMin: Minutes.optional(),
  /** shown before the test starts */
  instructions: OptionalText,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'must be a date like "2026-11-30"' }).optional(),
  /** a vocabulary quiz on a set of the vocabulary bank: the result goes into the set's self-test log, missed words become "weak" */
  vocabularySetId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/, { error: 'must be a vocabulary set id such as "set-3"' }).optional(),
  /** a step of a mastery ladder: each scored (or marked) attempt counts towards passing that step */
  masteryStepId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/, { error: 'must be a mastery step id such as "w1-introduction"' }).optional(),
  parts: z.array(Part).min(1, { error: 'needs at least one part' }),
  answerKey: AnswerKey.default({})
});

export type PassageParagraph = z.output<typeof PassageParagraph>;
export type Passage = z.output<typeof Passage>;
export type Part = z.output<typeof Part>;
export type AnswerKeyEntry = z.output<typeof AnswerKeyEntry>;
export type AnswerKey = z.output<typeof AnswerKey>;
/** validated test (defaults filled in) */
export type TestDocument = z.output<typeof TestDocument>;
/** what may be sent in (defaults optional) */
export type TestDocumentInput = z.input<typeof TestDocument>;

/** the body stored in tests.content (title, skill etc. live in their own columns; the key in tests.answer_key) */
export interface TestContent {
  variant: Variant;
  timeLimitMin?: number;
  vocabularySetId?: string;
  masteryStepId?: string;
  parts: Part[];
}

export interface TestMeta {
  title: string;
  skill: Skill;
  kind: Kind;
  instructions?: string;
  dueDate?: string;
}
