import { describe, expect, it } from 'vitest';
import { wordDiff, type DiffPiece } from '../src';

const marked = (p: DiffPiece[]) => p.map(x => (x.changed ? `[${x.text}]` : x.text)).join('');

describe('word diff (corrected text on the results page)', () => {
  it('marks removed words on the original and added words on the correction', () => {
    const d = wordDiff('Many graduates can not find job because of leak of experience.', 'Many graduates cannot find a job because of a lack of experience.')!;
    expect(marked(d.before)).toBe('Many graduates [can not] find job because of [leak] of experience.');
    expect(marked(d.after)).toBe('Many graduates [cannot] find [a] job because of [a lack] of experience.');
    expect(d.removed).toBe(3);
    expect(d.added).toBe(4);
  });

  it('keeps line breaks and paragraphs, and leaves the whitespace before a change unmarked', () => {
    const d = wordDiff('First line.\n\nSecond experiance here.\n', 'First line.\n\nSecond experience here.\n')!;
    expect(d.before.map(p => p.text).join('')).toBe('First line.\n\nSecond experiance here.\n');
    expect(d.after.map(p => p.text).join('')).toBe('First line.\n\nSecond experience here.\n');
    expect(d.before.find(p => p.changed)?.text).toBe('experiance');
    expect(d.after.find(p => p.changed)?.text).toBe('experience');
  });

  it('counts case and punctuation as changes, and handles identical or empty texts', () => {
    expect(marked(wordDiff('however it works', 'However, it works')!.after)).toBe('[However,] it works');
    expect(wordDiff('same text', 'same text')).toMatchObject({ removed: 0, added: 0 });
    expect(marked(wordDiff('', 'new words')!.after)).toBe('[new words]');
    expect(wordDiff('old', '')!.before).toEqual([{ text: 'old', changed: true }]);
  });

  it('gives up on texts too long to compare quickly', () => {
    expect(wordDiff('a b c d', 'e f g h', 10)).toBeNull();
    expect(wordDiff('x a b c d', 'x e f g h', 16)).not.toBeNull(); // the shared start is set aside
  });
});
