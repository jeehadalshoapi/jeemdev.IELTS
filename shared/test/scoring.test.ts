import { describe, expect, it } from 'vitest';
import {
  editDistance, estimateBand, exampleTestForType, scoreAnswers, splitDocument, URBAN_BEEKEEPING, validateTest,
  type AutoScore, type TestDocumentInput
} from '../src';

function prepared(input: TestDocumentInput) {
  const r = validateTest(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return { doc: r.test, ...splitDocument(r.test) };
}
const score = (input: TestDocumentInput, answers: Record<string, unknown>): AutoScore => {
  const p = prepared(input);
  return scoreAnswers(p.doc.skill, p.content, p.answerKey, answers);
};
const q = (s: AutoScore, n: number) => s.questions.find(x => x.number === n)!;

const ALL_RIGHT = {
  q1: 'iii', q2: 'i', q3: 'v', q4: 'iv', q5: 'vi', q6: 'TRUE', q7: 'NOT GIVEN', q8: 'FALSE', q9: 'FALSE', q10: 'B',
  q11: 'register', q12: 'permit', q13: 'roofs', q14: 'wild', q15: ['A', 'C'], q17: 'colony collapse disorder'
};

describe('auto-scoring', () => {
  it('scores a perfect attempt 17/17 with an estimated band', () => {
    const s = score(URBAN_BEEKEEPING, ALL_RIGHT);
    expect(s.raw).toBe(17);
    expect(s.total).toBe(17);
    expect(s.band).toBe(9);
    expect(s.bandInfo).toMatchObject({ table: 'academic_reading', scaledRaw: 40, basedOn: 17, scaled: true });
    expect(s.reasons).toMatchObject({ correct: 17, wrong: 0, blank: 0 });
  });

  it('ignores case, extra spaces and a final full stop; accepts optional words', () => {
    const s = score(URBAN_BEEKEEPING, { ...ALL_RIGHT, q1: 'III', q11: '  Register. ', q17: 'colony  collapse disorder.' });
    expect([q(s, 1).correct, q(s, 11).correct, q(s, 17).correct]).toEqual([true, true, true]);
  });

  it('marks an answer over the word limit wrong, with the reason', () => {
    // (the) colony collapse disorder is accepted, but "the …" is 4 words and the limit is THREE
    const s = score(URBAN_BEEKEEPING, { ...ALL_RIGHT, q17: 'the colony collapse disorder' });
    expect(q(s, 17)).toMatchObject({ correct: false, reason: 'over_word_limit', answer: 'the colony collapse disorder', note: '4 words — limit: NO MORE THAN THREE WORDS' });
  });

  it('spec example: 3 words where the limit is 2 is wrong; "dark surface\'s" is a likely misspelling', () => {
    const t = exampleTestForType('sentence_completion');
    expect(q(score(t, { q1: 'the dark surfaces' }), 1)).toMatchObject({ correct: false, reason: 'over_word_limit' });
    expect(q(score(t, { q1: "dark surface's" }), 1)).toMatchObject({ correct: false, reason: 'likely_spelling', answer: "dark surface's", note: 'close to “dark surfaces”' });
    expect(q(score(t, { q1: 'Dark Surfaces' }), 1).correct).toBe(true);
    expect(q(score(t, { q1: 'tall buildings' }), 1)).toMatchObject({ correct: false, reason: 'wrong' });
  });

  it('spelling counts: a misspelling is wrong but labelled', () => {
    const s = score(URBAN_BEEKEEPING, { ...ALL_RIGHT, q17: 'colony colapse disorder', q12: 'permits', q14: 'wilde' });
    expect(q(s, 17)).toMatchObject({ correct: false, reason: 'likely_spelling' });
    expect(q(s, 12)).toMatchObject({ correct: false, reason: 'likely_spelling', note: 'close to “permit”' });
    expect(q(s, 14)).toMatchObject({ correct: false, reason: 'wrong' }); // "wild" is too short to guess at
    expect(s.raw).toBe(14);
  });

  it('gives one mark per correct option in "choose TWO"', () => {
    const half = score(URBAN_BEEKEEPING, { ...ALL_RIGHT, q15: ['D', 'A'] });
    expect([q(half, 15), q(half, 16)].map(x => [x.answer, x.correct])).toEqual([['A', true], ['D', false]]);
    const none = score(URBAN_BEEKEEPING, { ...ALL_RIGHT, q15: [] });
    expect([q(none, 15).reason, q(none, 16).reason]).toEqual(['blank', 'blank']);
  });

  it('counts blanks and keeps per part / per type tallies', () => {
    const s = score(URBAN_BEEKEEPING, { q6: 'TRUE', q7: 'TRUE' });
    expect(s.raw).toBe(1);
    expect(s.reasons).toMatchObject({ correct: 1, wrong: 1, blank: 15 });
    expect(s.perType.tfng).toEqual({ raw: 1, total: 4 });
    expect(s.perPart.p1).toEqual({ raw: 1, total: 17 });
    expect(s.band).toBe(2); // 1/17 -> 2/40
  });

  it('band tables', () => {
    expect(estimateBand('academic_reading', 30, 40)?.band).toBe(7);
    expect(estimateBand('listening', 26, 40)?.band).toBe(6.5);
    expect(estimateBand('general_reading', 30, 40)?.band).toBe(6);
    expect(estimateBand('academic_reading', 13, 17)).toMatchObject({ band: 7, scaledRaw: 31 });
    expect(estimateBand('listening', 0, 0)).toBeNull();
  });

  it('a mixed full mock gets a band per section, and writing is left for Claude', () => {
    const doc: TestDocumentInput = {
      title: 'Mock', skill: 'mixed', kind: 'full_mock',
      parts: [
        { ...(exampleTestForType('note_completion').parts[0] as object), id: 'L1', skill: 'listening' } as never,
        { id: 'R1', title: 'Reading', skill: 'reading', passage: { paragraphs: [{ text: 'x' }] }, questionGroups: [{ id: 'gR', type: 'tfng', questions: [{ id: 'r1', number: 3, text: 'x' }] }] },
        { id: 'W1', title: 'Writing', skill: 'writing', questionGroups: [{ id: 'w2', type: 'writing_task2', prompt: 'Discuss.' }] }
      ],
      answerKey: { q1: { accept: ['surfaces'] }, q2: { accept: ['trees'] }, r1: { accept: ['FALSE'] } }
    };
    const s = score(doc, { q1: 'surfaces', q2: 'tress', r1: 'FALSE', w2: 'Some people think that parks matter more than roads.' });
    expect(s.sections.listening).toMatchObject({ raw: 1, total: 2 });
    expect(s.sections.reading).toMatchObject({ raw: 1, total: 1, band: 9 });
    expect(s.band).toBeNull();
    expect(s.openItems).toEqual([{ id: 'w2', type: 'writing_task2', partId: 'W1', words: 9, minWords: 250, answered: true }]);
  });

  it('names the misspelt answer as it is written in the key', () => {
    const s = score(exampleTestForType('form_completion'), { q1: 'Mitchel' });
    expect(q(s, 1)).toMatchObject({ reason: 'likely_spelling', note: 'close to “Mitchell”' });
  });

  it('edit distance counts a swap of two letters as one change', () => {
    expect(editDistance('recieve', 'receive')).toBe(1);
    expect(editDistance('surfaces', 'surface')).toBe(1);
    expect(editDistance('abc', 'xyz')).toBe(3);
  });
});
