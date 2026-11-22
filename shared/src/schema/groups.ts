import { z } from 'zod';
import { Id, Minutes, NonEmptyText, Option, OptionalText, QuestionNumber, Seconds, Url, WordLimit, WordTarget } from './common';

/* ======================================================================
   Question types
   ====================================================================== */

export const MATCHING_TYPES = ['matching_headings', 'matching_information', 'matching_features', 'matching_sentence_endings', 'definition_match', 'opposite_match'] as const;
export const COMPLETION_TYPES = ['sentence_completion', 'summary_completion', 'note_completion', 'table_completion', 'flowchart_completion', 'diagram_labelling', 'form_completion'] as const;
export const OBJECTIVE_TYPES = ['tfng', 'ynng', 'mcq_single', 'mcq_multi', ...MATCHING_TYPES, ...COMPLETION_TYPES, 'short_answer', 'map_labelling', 'dictation'] as const;
export const WRITING_TYPES = ['writing_task1', 'writing_task2', 'paragraph', 'sentence_rewrite'] as const;
/** the types a vocabulary quiz may use */
export const VOCABULARY_TYPES = ['sentence_completion', 'short_answer', 'matching_features', 'mcq_single', 'definition_match', 'opposite_match', 'dictation'] as const;
export const SPEAKING_TYPES = ['speaking_part1', 'speaking_part2', 'speaking_part3'] as const;
export const QUESTION_TYPES = [...OBJECTIVE_TYPES, ...WRITING_TYPES, ...SPEAKING_TYPES] as const;

export type MatchingType = (typeof MATCHING_TYPES)[number];
export type CompletionType = (typeof COMPLETION_TYPES)[number];
export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];
export type WritingType = (typeof WRITING_TYPES)[number];
export type SpeakingType = (typeof SPEAKING_TYPES)[number];
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const TFNG_CHOICES = ['TRUE', 'FALSE', 'NOT GIVEN'] as const;
export const YNNG_CHOICES = ['YES', 'NO', 'NOT GIVEN'] as const;

/** fields every question group may have */
const groupBase = {
  id: Id,
  instructions: OptionalText,
  /** heading shown above the questions, e.g. "Notes on the museum" */
  title: OptionalText,
  imageUrl: Url.optional()
};

const NumberedQuestion = z.strictObject({ id: Id, number: QuestionNumber, text: NonEmptyText });

/* ---------- TRUE/FALSE/NOT GIVEN, YES/NO/NOT GIVEN ---------- */
export const TfngGroup = z.strictObject({ ...groupBase, type: z.literal('tfng'), questions: z.array(NumberedQuestion).min(1, { error: 'needs at least one question' }) });
export const YnngGroup = z.strictObject({ ...groupBase, type: z.literal('ynng'), questions: z.array(NumberedQuestion).min(1, { error: 'needs at least one question' }) });

/* ---------- multiple choice ---------- */
const McqOptions = z.array(NonEmptyText).min(2, { error: 'needs at least 2 options' }).max(10, { error: 'can have at most 10 options' });

export const McqSingleGroup = z.strictObject({
  ...groupBase,
  type: z.literal('mcq_single'),
  questions: z.array(z.strictObject({
    id: Id, number: QuestionNumber, text: NonEmptyText,
    /** option texts in order; they are shown as A, B, C… */
    options: McqOptions
  })).min(1, { error: 'needs at least one question' })
});

/** "Choose TWO letters": one question that is worth one mark per correct option, so it has several numbers */
export const McqMultiGroup = z.strictObject({
  ...groupBase,
  type: z.literal('mcq_multi'),
  questions: z.array(z.strictObject({
    id: Id,
    /** one number per mark, e.g. [14, 15] for "choose TWO" */
    numbers: z.array(QuestionNumber).min(2, { error: 'needs one number per correct option, e.g. [14, 15] for "choose TWO"' }).max(5, { error: 'can have at most 5 numbers' }),
    text: NonEmptyText,
    options: McqOptions
  })).min(1, { error: 'needs at least one question' })
});

/* ---------- matching ---------- */
const matchingFields = {
  /** the list to choose from: headings, paragraph letters, people, sentence endings, map letters */
  options: z.array(Option).min(2, { error: 'needs at least 2 options' }).max(26, { error: 'can have at most 26 options' }),
  /** heading above the option list, e.g. "List of Headings" */
  optionsTitle: OptionalText,
  /** "You may use any letter more than once" */
  allowReuse: z.boolean({ error: 'must be true or false' }).default(false),
  questions: z.array(NumberedQuestion).min(1, { error: 'needs at least one question' })
};
const matchingGroup = <T extends MatchingType>(type: T) => z.strictObject({ ...groupBase, type: z.literal(type), ...matchingFields });

export const MatchingHeadingsGroup = matchingGroup('matching_headings');
export const MatchingInformationGroup = matchingGroup('matching_information');
export const MatchingFeaturesGroup = matchingGroup('matching_features');
export const MatchingSentenceEndingsGroup = matchingGroup('matching_sentence_endings');
/** vocabulary: each question is a word, the options are meanings */
export const DefinitionMatchGroup = matchingGroup('definition_match');
/** vocabulary: each question is a word, the options are opposites (trains the near-opposite trap) */
export const OppositeMatchGroup = matchingGroup('opposite_match');
/** one feature of a map drawn by the site; positions are percentages of the map area */
export const MapFeature = z.strictObject({
  label: NonEmptyText,
  shape: z.enum(['building', 'area', 'road', 'water', 'trees', 'point'], { error: 'must be one of building, area, road, water, trees, point' }).default('building'),
  x: z.number().min(0).max(100, { error: 'x must be 0–100 (% of the width)' }),
  y: z.number().min(0).max(100, { error: 'y must be 0–100 (% of the height)' }),
  width: z.number().min(0).max(100).optional(),
  height: z.number().min(0).max(100).optional()
});

/**
 * listening map / plan labelling: like matching, with a picture of the map — either "imageUrl" (e.g. from upload_asset)
 * or "map": features drawn by the site (letters A, B… as point or building labels, plus named landmarks)
 */
export const MapLabellingGroup = z.strictObject({
  ...groupBase, type: z.literal('map_labelling'),
  map: z.strictObject({ title: OptionalText, features: z.array(MapFeature).min(1, { error: 'needs at least one feature' }) }).optional(),
  ...matchingFields
});

/* ---------- completion (gap filling) ----------
   Two layouts:
   1. questions with text containing a blank "______" (e.g. sentence completion), or
   2. a "template" laid out as notes / table / flow-chart / form, with {{questionId}} where each gap goes:
        "# Notes heading", "- bullet", "a | b | c" table rows (first row = header), "> flow-chart box"
   With "options" (a word box), the answer to each gap is an option label instead of free text. */
const completionGroup = <T extends CompletionType>(type: T) => z.strictObject({
  ...groupBase,
  type: z.literal(type),
  wordLimit: WordLimit.optional(),
  template: OptionalText,
  options: z.array(Option).min(2, { error: 'a word box needs at least 2 options' }).max(26, { error: 'can have at most 26 options' }).optional(),
  questions: z.array(z.strictObject({
    id: Id,
    number: QuestionNumber,
    /** required unless the group has a template; use "______" to place the gap inside the sentence */
    text: OptionalText
  })).min(1, { error: 'needs at least one question' })
});

export const SentenceCompletionGroup = completionGroup('sentence_completion');
export const SummaryCompletionGroup = completionGroup('summary_completion');
export const NoteCompletionGroup = completionGroup('note_completion');
export const TableCompletionGroup = completionGroup('table_completion');
export const FlowchartCompletionGroup = completionGroup('flowchart_completion');
export const DiagramLabellingGroup = completionGroup('diagram_labelling');
export const FormCompletionGroup = completionGroup('form_completion');

/* ---------- short answer ---------- */
export const ShortAnswerGroup = z.strictObject({
  ...groupBase,
  type: z.literal('short_answer'),
  wordLimit: WordLimit.optional(),
  questions: z.array(NumberedQuestion).min(1, { error: 'needs at least one question' })
});

/* ---------- dictation (spelling) ----------
   Each question gets a play button: the browser reads "sentence" and then "say", at most "maxPlays" times, and the
   student types the word. "say" and "sentence" never reach the page before submission (the server sends them per play). */
export const DictationGroup = z.strictObject({
  ...groupBase,
  type: z.literal('dictation'),
  maxPlays: z.number({ error: 'must be a number of plays' }).int().min(1).max(5).default(2),
  questions: z.array(z.strictObject({
    id: Id,
    number: QuestionNumber,
    /** the word (or short phrase) to write */
    say: NonEmptyText,
    /** a sentence that uses the word, read before it */
    sentence: OptionalText
  })).min(1, { error: 'needs at least one word' })
});

/* ======================================================================
   Writing (marked by Claude)
   ====================================================================== */

const chartBase = { title: OptionalText, unit: OptionalText };

const Series = z.strictObject({
  name: NonEmptyText,
  values: z.array(z.number({ error: 'must be a number (use null for a missing value)' }).nullable())
});

const LineChart = z.strictObject({ ...chartBase, chartType: z.literal('line'), xLabel: OptionalText, yLabel: OptionalText, labels: z.array(NonEmptyText).min(2, { error: 'needs at least 2 labels (x-axis points)' }), series: z.array(Series).min(1, { error: 'needs at least one series' }) });
const BarChart = z.strictObject({
  ...chartBase, chartType: z.literal('bar'), xLabel: OptionalText, yLabel: OptionalText,
  orientation: z.enum(['vertical', 'horizontal'], { error: 'must be "vertical" or "horizontal"' }).default('vertical'),
  stacked: z.boolean().default(false),
  labels: z.array(NonEmptyText).min(1, { error: 'needs at least 1 label (category)' }),
  series: z.array(Series).min(1, { error: 'needs at least one series' })
});
const PieChart = z.strictObject({
  ...chartBase, chartType: z.literal('pie'),
  pies: z.array(z.strictObject({
    title: OptionalText,
    slices: z.array(z.strictObject({ label: NonEmptyText, value: z.number().nonnegative({ error: 'must be 0 or more' }) })).min(2, { error: 'needs at least 2 slices' })
  })).min(1, { error: 'needs at least one pie' }).max(4, { error: 'can have at most 4 pies' })
});
const TableChart = z.strictObject({
  ...chartBase, chartType: z.literal('table'),
  columns: z.array(NonEmptyText).min(2, { error: 'needs at least 2 columns' }),
  rows: z.array(z.array(z.union([z.string(), z.number()], { error: 'cells must be text or numbers' }))).min(1, { error: 'needs at least one row' })
});
const ProcessChart = z.strictObject({
  ...chartBase, chartType: z.literal('process'),
  steps: z.array(z.strictObject({ label: NonEmptyText, detail: OptionalText })).min(2, { error: 'needs at least 2 steps' }),
  /** true for a life cycle that returns to the first step */
  cyclic: z.boolean().default(false)
});
const MapChart = z.strictObject({
  ...chartBase, chartType: z.literal('map'),
  /** one or two maps (e.g. "1990" and "Today"); positions are percentages of the map area */
  maps: z.array(z.strictObject({
    title: NonEmptyText,
    features: z.array(MapFeature).min(1, { error: 'needs at least one feature' })
  })).min(1, { error: 'needs at least one map' }).max(2, { error: 'can have at most 2 maps' })
});

export const CHART_TYPES = ['line', 'bar', 'pie', 'table', 'process', 'map'] as const;
export const Chart = z.discriminatedUnion('chartType', [LineChart, BarChart, PieChart, TableChart, ProcessChart, MapChart], {
  error: iss => `chartType must be one of ${CHART_TYPES.join(', ')}${typeof (iss.input as { chartType?: unknown })?.chartType === 'string' ? ` (got "${(iss.input as { chartType: string }).chartType}")` : ''}`
});

export const WritingTask1Group = z.strictObject({
  id: Id,
  type: z.literal('writing_task1'),
  instructions: OptionalText,
  prompt: NonEmptyText,
  /** Task 1 visuals stored as data and drawn on the page */
  charts: z.array(Chart).default([]),
  imageUrl: Url.optional(),
  minWords: WordTarget.default(150),
  timeLimitMin: Minutes.optional()
});

export const WritingTask2Group = z.strictObject({
  id: Id,
  type: z.literal('writing_task2'),
  instructions: OptionalText,
  prompt: NonEmptyText,
  minWords: WordTarget.default(250),
  timeLimitMin: Minutes.optional(),
  /** "essay" = full essay; "plan_intro" = drill: a plan and an introduction only, each with its own timer */
  mode: z.enum(['essay', 'plan_intro'], { error: 'must be "essay" or "plan_intro"' }).default('essay'),
  planTimeMin: Minutes.default(5),
  introTimeMin: Minutes.default(10),
  introMinWords: WordTarget.default(40)
});

/** a single body paragraph, e.g. PEEL (Point, Explain, Example, Link) */
export const ParagraphGroup = z.strictObject({
  id: Id,
  type: z.literal('paragraph'),
  instructions: OptionalText,
  prompt: NonEmptyText,
  structure: z.enum(['PEEL', 'free'], { error: 'must be "PEEL" or "free"' }).default('PEEL'),
  minWords: WordTarget.default(100),
  timeLimitMin: Minutes.optional()
});

/** repair task: one answer box per sentence, each marked by Claude (answerKey.<itemId>.modelAnswer shown afterwards) */
export const SentenceRewriteGroup = z.strictObject({
  id: Id,
  type: z.literal('sentence_rewrite'),
  instructions: OptionalText,
  title: OptionalText,
  items: z.array(z.strictObject({
    id: Id,
    /** shown as the sentence number (not part of the auto-scored numbering) */
    number: QuestionNumber.optional(),
    /** the sentence to rewrite or correct */
    text: NonEmptyText
  })).min(1, { error: 'needs at least one sentence' }).max(40, { error: 'can have at most 40 sentences' })
});

/* ======================================================================
   Speaking (answers: audio recording and/or typed notes)
   ====================================================================== */

const SpeakingQuestion = z.strictObject({ id: Id, text: NonEmptyText });

export const SpeakingPart1Group = z.strictObject({
  id: Id, type: z.literal('speaking_part1'), instructions: OptionalText, topic: OptionalText,
  questions: z.array(SpeakingQuestion).min(1, { error: 'needs at least one question' })
});

export const SpeakingPart2Group = z.strictObject({
  id: Id, type: z.literal('speaking_part2'), instructions: OptionalText,
  cueCard: z.strictObject({
    topic: NonEmptyText,
    bullets: z.array(NonEmptyText).min(1, { error: 'needs at least one bullet point' }).max(6, { error: 'can have at most 6 bullet points' }),
    closing: OptionalText
  }),
  prepTimeSec: Seconds.default(60),
  talkTimeSec: Seconds.default(120),
  /** optional rounding-off questions after the talk */
  followUps: z.array(SpeakingQuestion).default([])
});

export const SpeakingPart3Group = z.strictObject({
  id: Id, type: z.literal('speaking_part3'), instructions: OptionalText, topic: OptionalText,
  questions: z.array(SpeakingQuestion).min(1, { error: 'needs at least one question' })
});

/* ======================================================================
   The union of all groups
   ====================================================================== */

export const QuestionGroup = z.discriminatedUnion('type', [
  TfngGroup, YnngGroup, McqSingleGroup, McqMultiGroup,
  MatchingHeadingsGroup, MatchingInformationGroup, MatchingFeaturesGroup, MatchingSentenceEndingsGroup, DefinitionMatchGroup, OppositeMatchGroup, MapLabellingGroup,
  SentenceCompletionGroup, SummaryCompletionGroup, NoteCompletionGroup, TableCompletionGroup, FlowchartCompletionGroup, DiagramLabellingGroup, FormCompletionGroup,
  ShortAnswerGroup, DictationGroup,
  WritingTask1Group, WritingTask2Group, ParagraphGroup, SentenceRewriteGroup,
  SpeakingPart1Group, SpeakingPart2Group, SpeakingPart3Group
], {
  error: iss => {
    const t = (iss.input as { type?: unknown } | undefined)?.type;
    if (t === undefined) return `missing "type". Use one of: ${QUESTION_TYPES.join(', ')}`;
    return `unknown question type ${JSON.stringify(t)}. Use one of: ${QUESTION_TYPES.join(', ')}`;
  }
});

export type QuestionGroup = z.output<typeof QuestionGroup>;
export type ObjectiveGroup = Extract<QuestionGroup, { type: ObjectiveType }>;
export type WritingGroup = Extract<QuestionGroup, { type: WritingType }>;
export type SpeakingGroup = Extract<QuestionGroup, { type: SpeakingType }>;
export type MatchingLikeGroup = Extract<QuestionGroup, { type: MatchingType | 'map_labelling' }>;
export type CompletionGroup = Extract<QuestionGroup, { type: CompletionType }>;
export type Chart = z.output<typeof Chart>;

export const isObjectiveType = (t: string): t is ObjectiveType => (OBJECTIVE_TYPES as readonly string[]).includes(t);
export const isWritingType = (t: string): t is WritingType => (WRITING_TYPES as readonly string[]).includes(t);
export const isSpeakingType = (t: string): t is SpeakingType => (SPEAKING_TYPES as readonly string[]).includes(t);
export const isMatchingType = (t: string): t is MatchingType | 'map_labelling' => t === 'map_labelling' || (MATCHING_TYPES as readonly string[]).includes(t);
export const isCompletionType = (t: string): t is CompletionType => (COMPLETION_TYPES as readonly string[]).includes(t);
