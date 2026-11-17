import { describe, expect, it } from 'vitest';
import { acceptedForms, countWords, describeWordLimit, expandOptional, fitsWordLimit, normalizeAnswer } from '../src';

describe('answer helpers', () => {
  it('normalises case, spaces, curly quotes, thousands commas and a trailing full stop', () => {
    expect(normalizeAnswer('  Dark   Surfaces. ')).toBe('dark surfaces');
    expect(normalizeAnswer('the river’s edge')).toBe("the river's edge");
    expect(normalizeAnswer('1,000')).toBe('1000');
    expect(normalizeAnswer('surfaes')).toBe('surfaes'); // spelling is not corrected
  });

  it('expands optional words in brackets', () => {
    expect(expandOptional('(the) dark surfaces')).toEqual(['the dark surfaces', 'dark surfaces']);
    expect(expandOptional('(a) (small) boat')).toEqual(['a small boat', 'a boat', 'small boat', 'boat']);
    expect(acceptedForms(['(the) River', 'stream.'])).toEqual(['the river', 'river', 'stream']);
  });

  it('counts words and numbers like IELTS word limits', () => {
    expect(countWords('well-known artist')).toEqual({ words: 2, numbers: 0 });
    expect(countWords('15 March')).toEqual({ words: 1, numbers: 1 });
    expect(countWords('£1,500')).toEqual({ words: 0, numbers: 1 });
    expect(countWords('9.30am train')).toEqual({ words: 1, numbers: 1 });
  });

  it('enforces word limits', () => {
    const twoAndNumber = { maxWords: 2, allowNumber: true };
    const oneOnly = { maxWords: 1, allowNumber: false };
    expect(fitsWordLimit('dark surfaces', twoAndNumber)).toBe(true);
    expect(fitsWordLimit('the dark surfaces', twoAndNumber)).toBe(false);
    expect(fitsWordLimit('15 March holidays', twoAndNumber)).toBe(true);
    expect(fitsWordLimit('15 March 20', twoAndNumber)).toBe(false);
    expect(fitsWordLimit('07700 900123', { maxWords: 1, allowNumber: true })).toBe(true);
    expect(fitsWordLimit('1998', oneOnly)).toBe(true);
    expect(fitsWordLimit('in 1998', oneOnly)).toBe(false);
    expect(describeWordLimit(twoAndNumber)).toBe('NO MORE THAN TWO WORDS AND/OR A NUMBER');
    expect(describeWordLimit(oneOnly)).toBe('ONE WORD ONLY');
  });
});
