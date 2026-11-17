import { z } from 'zod';

/** ids are referenced by the answer key and by attempts, so keep them short and safe */
export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export const Id = z
  .string({ error: 'must be a string id such as "q1"' })
  .regex(ID_PATTERN, { error: 'must start with a letter and use only letters, digits, "-" or "_" (max 64 characters), e.g. "q1", "p2", "g3"' });

export const NonEmptyText = z
  .string({ error: 'must be a string' })
  .trim()
  .min(1, { error: 'must not be empty' });

export const OptionalText = z.string({ error: 'must be a string' }).optional();

/** absolute http(s) URL, or a file stored on this server (/files/<id>) */
export const Url = z
  .string({ error: 'must be a URL string' })
  .refine(s => /^https?:\/\/\S+$/i.test(s) || /^\/files\/[A-Za-z0-9-]+$/.test(s), {
    error: 'must be an http(s) URL or a "/files/<id>" path on this site'
  });

export const QuestionNumber = z
  .number({ error: 'must be a number' })
  .int({ error: 'must be a whole number' })
  .min(1, { error: 'must be 1 or higher' })
  .max(200, { error: 'must be 200 or lower' });

export const Minutes = z
  .number({ error: 'must be a number of minutes' })
  .positive({ error: 'must be more than 0' })
  .max(300, { error: 'must be 300 minutes or less' });

export const Seconds = z
  .number({ error: 'must be a number of seconds' })
  .int({ error: 'must be a whole number of seconds' })
  .positive({ error: 'must be more than 0' })
  .max(3600, { error: 'must be 3600 seconds or less' });

export const WordTarget = z
  .number({ error: 'must be a number of words' })
  .int({ error: 'must be a whole number' })
  .min(0, { error: 'must be 0 or more' })
  .max(1000, { error: 'must be 1000 or less' });

/** an option in a list the candidate chooses from: "i" + "The origins of glass", or "A" + "" for paragraph letters */
export const Option = z.strictObject({
  label: z.string({ error: 'must be a string such as "A" or "iv"' }).trim().min(1, { error: 'must not be empty' }).max(12, { error: 'must be 12 characters or less' }),
  text: z.string({ error: 'must be a string' }).default('')
});

/** "NO MORE THAN TWO WORDS AND/OR A NUMBER" = { maxWords: 2, allowNumber: true } */
export const WordLimit = z.strictObject({
  maxWords: z.number({ error: 'must be a number' }).int({ error: 'must be a whole number' }).min(1, { error: 'must be at least 1' }).max(10, { error: 'must be 10 or less' }),
  allowNumber: z.boolean({ error: 'must be true or false' }).default(false)
});

export type WordLimit = z.output<typeof WordLimit>;
export type Option = z.output<typeof Option>;
