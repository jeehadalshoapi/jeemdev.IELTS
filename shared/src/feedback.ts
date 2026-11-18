/* Claude's marking of an attempt (spec §6 "Feedback JSON"), saved with the save_feedback tool. */
import { z } from 'zod';

const Band = z.number({ error: 'must be a band number such as 6.5' })
  .min(0, { error: 'must be 0–9' }).max(9, { error: 'must be 0–9' })
  .refine(n => Number.isInteger(n * 2), { error: 'must be a whole or half band, e.g. 6 or 6.5' });

const Text = z.string({ error: 'must be a string' });

export const FeedbackMistake = z.looseObject({
  /** the question (e.g. "q14"), or the writing / speaking item id */
  questionId: Text.optional(),
  yourAnswer: Text.optional(),
  correct: Text.optional(),
  explanation: Text.trim().min(1, { error: 'must not be empty' }),
  /** e.g. "spelling", "word limit", "paraphrase", "grammar", "task response" */
  category: Text.optional()
});

export const Feedback = z.looseObject({
  /** overall band for this attempt (optional for short drills) */
  overallBand: Band.optional(),
  /** Writing: TR/TA, CC, LR, GRA. Speaking: FC, LR, GRA, P */
  criteria: z.record(z.string(), Band, { error: 'must be an object like { "TR": 6, "CC": 6.5 }' }).optional(),
  /** the main message, markdown allowed */
  summary: Text.trim().min(1, { error: 'must not be empty — write the overall verdict here' }),
  mistakes: z.array(FeedbackMistake).default([]),
  /** an improved version of a writing answer */
  correctedText: Text.optional(),
  nextSteps: z.array(Text).default([])
});

export type FeedbackMistake = z.output<typeof FeedbackMistake>;
export type Feedback = z.output<typeof Feedback> & { savedAt?: string };
