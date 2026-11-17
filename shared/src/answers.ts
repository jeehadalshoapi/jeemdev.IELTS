import type { WordLimit } from './schema/common';

/**
 * Normalise a typed answer or a key entry for comparison:
 * case-insensitive, trimmed, single spaces, curly quotes/dashes made plain, "1,000" = "1000",
 * and a trailing full stop ignored. Spelling is NOT corrected — a misspelling stays wrong.
 */
export function normalizeAnswer(s: string): string {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .trim();
}

/** "(the) dark surfaces" -> ["the dark surfaces", "dark surfaces"]; several brackets give every combination */
export function expandOptional(spec: string, limit = 64): string[] {
  const out: string[] = [];
  const walk = (s: string) => {
    if (out.length >= limit) return;
    const m = s.match(/\(([^()]*)\)/);
    if (!m || m.index === undefined) { out.push(s.replace(/\s+/g, ' ').trim()); return; }
    const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
    walk(before + m[1] + after);
    walk(before + ' ' + after);
  };
  walk(spec);
  return [...new Set(out.filter(Boolean))];
}

/** every normalised form a key accepts */
export function acceptedForms(accept: readonly string[]): string[] {
  return [...new Set(accept.flatMap(a => expandOptional(a)).map(normalizeAnswer).filter(Boolean))];
}

const NUMBER_TOKEN = /^[£$€]?\d[\d.,:/-]*(%|st|nd|rd|th|am|pm|a\.m\.|p\.m\.|kg|km|cm|mm|m|g|ml|l)?$/i;

/**
 * count words and numbers the way IELTS word limits do: "well-known" = 1 word, "1,500" = a number,
 * and digit groups written together ("07700 900123") = one number
 */
export function countWords(answer: string): { words: number; numbers: number } {
  const tokens = String(answer ?? '').trim().split(/\s+/).filter(t => /[\p{L}\p{N}]/u.test(t));
  let words = 0, numbers = 0, prevWasDigits = false;
  for (const t of tokens) {
    const digitsOnly = /^\d+$/.test(t);
    if (NUMBER_TOKEN.test(t)) {
      if (!(digitsOnly && prevWasDigits)) numbers++;
    } else words++;
    prevWasDigits = digitsOnly;
  }
  return { words, numbers };
}

export function fitsWordLimit(answer: string, limit?: WordLimit): boolean {
  if (!limit) return true;
  const { words, numbers } = countWords(answer);
  return limit.allowNumber ? words <= limit.maxWords && numbers <= 1 : words + numbers <= limit.maxWords;
}

const NUMBER_WORDS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];

/** { maxWords: 2, allowNumber: true } -> "NO MORE THAN TWO WORDS AND/OR A NUMBER" */
export function describeWordLimit(limit: WordLimit): string {
  const n = NUMBER_WORDS[limit.maxWords] ?? String(limit.maxWords);
  if (limit.maxWords === 1) return limit.allowNumber ? 'ONE WORD AND/OR A NUMBER' : 'ONE WORD ONLY';
  return `NO MORE THAN ${n} WORDS${limit.allowNumber ? ' AND/OR A NUMBER' : ''}`;
}

/** option letters for multiple choice: 0 -> "A" */
export const letter = (i: number): string => String.fromCharCode(65 + i);
