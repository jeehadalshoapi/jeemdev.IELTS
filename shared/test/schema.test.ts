import { describe, expect, it } from 'vitest';
import {
  QUESTION_TYPES, QUESTION_TYPE_EXAMPLES, URBAN_BEEKEEPING, exampleTestForType, joinDocument, listItems,
  splitDocument, toPublicContent, totalMarks, validateTest, type Issue, type TestDocumentInput
} from '../src';

const clone = <T>(x: T): T => structuredClone(x);

/** a valid little reading test to break in different ways */
function base(): any {
  return {
    title: 'Reading Practice – Urban Heat',
    skill: 'reading',
    kind: 'homework',
    timeLimitMin: 20,
    parts: [{
      id: 'p1', title: 'Passage 1',
      passage: { title: 'Cooling the Concrete Jungle', paragraphs: [{ label: 'A', text: 'Dark surfaces absorb heat.' }] },
      questionGroups: [
        { id: 'g1', type: 'tfng', instructions: 'Do the statements agree?', questions: [{ id: 'q1', number: 1, text: 'Green roofs reduce heat.' }] },
        { id: 'g2', type: 'sentence_completion', instructions: 'Complete the sentences.', wordLimit: { maxWords: 2, allowNumber: true }, questions: [{ id: 'q2', number: 2, text: 'Cities absorb heat because of their ______.' }] }
      ]
    }],
    answerKey: { q1: { accept: ['TRUE'] }, q2: { accept: ['dark surfaces', 'dark surface'] } }
  };
}

function errorsOf(input: unknown): Issue[] {
  const r = validateTest(input);
  if (r.ok) throw new Error('expected the test to be invalid');
  return r.errors;
}

const has = (issues: Issue[], path: string, text: string) =>
  expect(issues.some(i => i.path === path && i.message.includes(text)), `expected "${path}: …${text}…" in\n${issues.map(i => `${i.path}: ${i.message}`).join('\n')}`).toBe(true);

describe('valid tests', () => {
  it('accepts the example from the spec (section 4)', () => {
    const r = validateTest(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toEqual([]);
  });

  it('accepts the urban beekeeping sample with 17 marks and no warnings', () => {
    const r = validateTest(URBAN_BEEKEEPING);
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors, null, 1)).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(totalMarks(r.test.parts)).toBe(17);
    expect(listItems(r.test.parts).map(i => i.numbers).flat()).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });

  it('has a valid example for every question type', () => {
    expect(Object.keys(QUESTION_TYPE_EXAMPLES).sort()).toEqual([...QUESTION_TYPES].sort());
    for (const type of QUESTION_TYPES) {
      const r = validateTest(exampleTestForType(type));
      expect(r.ok, `${type}: ${r.ok ? '' : JSON.stringify(r.errors)}`).toBe(true);
      if (r.ok) expect(r.warnings, type).toEqual([]);
    }
  });

  it('fills in defaults', () => {
    const doc = base();
    delete doc.kind;
    const r = validateTest(doc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.test.kind).toBe('practice');
      expect(r.test.variant).toBe('academic');
    }
  });

  it('accepts a mixed full mock when every part says its section', () => {
    const doc: TestDocumentInput = {
      title: 'Full mock', skill: 'mixed', kind: 'full_mock',
      parts: [
        { ...(exampleTestForType('note_completion').parts[0] as object), id: 'L1', skill: 'listening' } as never,
        { ...(exampleTestForType('tfng').parts[0] as object), id: 'R1', skill: 'reading', questionGroups: [{ id: 'gR', type: 'tfng', questions: [{ id: 'r1', number: 3, text: 'x' }] }] } as never,
        { id: 'W1', title: 'Writing', skill: 'writing', questionGroups: [{ id: 'w2', type: 'writing_task2', prompt: 'Discuss.' }] }
      ],
      answerKey: { q1: { accept: ['surfaces'] }, q2: { accept: ['trees'] }, r1: { accept: ['FALSE'] } }
    };
    const r = validateTest(doc);
    expect(r.ok, r.ok ? '' : JSON.stringify(r.errors, null, 1)).toBe(true);
  });
});

describe('clear errors (path + reason)', () => {
  it('unknown question type', () => {
    const doc = base();
    doc.parts[0].questionGroups[0].type = 'true_false';
    has(errorsOf(doc), 'parts[0].questionGroups[0].type', 'unknown question type "true_false". Use one of: tfng, ynng');
  });

  it('misspelt field names', () => {
    const doc = base();
    doc.parts[0].questionGroup = doc.parts[0].questionGroups;
    delete doc.parts[0].questionGroups;
    const errs = errorsOf(doc);
    has(errs, 'parts[0]', 'unknown field "questionGroup"');
    has(errs, 'parts[0].questionGroups', 'is required');
  });

  it('missing answer', () => {
    const doc = base();
    delete doc.answerKey.q2;
    has(errorsOf(doc), 'answerKey.q2', 'is missing — question 2');
  });

  it('answer for a question that does not exist', () => {
    const doc = base();
    doc.answerKey.q9 = { accept: ['x'] };
    has(errorsOf(doc), 'answerKey.q9', 'there is no question with id "q9"');
  });

  it('duplicate ids and question numbers', () => {
    const doc = base();
    doc.parts[0].questionGroups[1].questions[0].id = 'q1';
    doc.parts[0].questionGroups[1].questions[0].number = 1;
    const errs = errorsOf(doc);
    has(errs, 'parts[0].questionGroups[1].questions[0].id', 'duplicate id "q1"');
    has(errs, 'parts[0].questionGroups[1].questions[0].number', 'question number 1 is used twice');
  });

  it('TRUE/FALSE/NOT GIVEN key must use the full words', () => {
    const doc = base();
    doc.answerKey.q1 = { accept: ['T'] };
    has(errorsOf(doc), 'answerKey.q1.accept[0]', 'must be TRUE, FALSE or NOT GIVEN (got "T")');
  });

  it('accepted answer over the word limit', () => {
    const doc = base();
    doc.answerKey.q2 = { accept: ['the dark surfaces of buildings'] };
    has(errorsOf(doc), 'answerKey.q2.accept', 'no accepted answer fits the word limit (NO MORE THAN TWO WORDS AND/OR A NUMBER)');
  });

  it('warns about a key entry that can never be correct', () => {
    const doc = base();
    doc.answerKey.q2 = { accept: ['dark surfaces', 'the dark surfaces'] };
    const r = validateTest(doc);
    expect(r.ok).toBe(true);
    has(r.warnings, 'answerKey.q2.accept[1]', 'is over the word limit');
  });

  it('choose TWO needs exactly two letters', () => {
    const doc = clone(exampleTestForType('mcq_multi')) as any;
    doc.answerKey.q1 = { accept: ['A'] };
    has(errorsOf(doc), 'answerKey.q1.accept', 'must list exactly 2 correct letters');
    doc.answerKey.q1 = { accept: ['A', 'G'] };
    has(errorsOf(doc), 'answerKey.q1.accept[1]', 'must be an option letter A–E (got "G")');
  });

  it('matching answer must be an option label', () => {
    const doc = clone(exampleTestForType('matching_headings')) as any;
    doc.answerKey.q1 = { accept: ['iv'] };
    has(errorsOf(doc), 'answerKey.q1.accept[0]', 'must be one of the option labels i, ii, iii (got "iv")');
  });

  it('template gaps must match the questions', () => {
    const doc = clone(exampleTestForType('note_completion')) as any;
    doc.parts[0].questionGroups[0].template = '# Urban heat\n- Main cause: dark {{q1}}\n- Best solution: planting {{q3}}';
    const errs = errorsOf(doc);
    has(errs, 'parts[0].questionGroups[0].template', '{{q3}} does not match any question id');
    has(errs, 'parts[0].questionGroups[0].questions[1]', 'has no {{q2}} gap');
  });

  it('sentence completion without template needs question text', () => {
    const doc = base();
    delete doc.parts[0].questionGroups[1].questions[0].text;
    has(errorsOf(doc), 'parts[0].questionGroups[1].questions[0].text', 'is required when the group has no "template"');
  });

  it('reading part needs a passage; listening part needs a transcript or audio', () => {
    const r = base();
    delete r.parts[0].passage;
    has(errorsOf(r), 'parts[0].passage', 'is required for reading parts');
    const l = clone(exampleTestForType('form_completion')) as any;
    delete l.parts[0].transcript;
    has(errorsOf(l), 'parts[0].transcript', 'is required for a listening part without "audioUrl"');
  });

  it('mixed tests need a section on each part, and types must fit the section', () => {
    const doc = base();
    doc.skill = 'mixed';
    has(errorsOf(doc), 'parts[0].skill', 'is required when the test skill is "mixed"');
    const w = base();
    w.parts[0].questionGroups.push({ id: 'w1', type: 'writing_task2', prompt: 'Discuss.' });
    has(errorsOf(w), 'parts[0].questionGroups[2].type', '"writing_task2" cannot be used in a reading part');
  });

  it('writing tasks use modelAnswer/notes, not accept', () => {
    const doc = clone(exampleTestForType('writing_task2')) as any;
    doc.answerKey.w1 = { accept: ['x'] };
    has(errorsOf(doc), 'answerKey.w1.accept', 'marked by Claude');
  });

  it('chart data must line up', () => {
    const doc = clone(exampleTestForType('writing_task1')) as any;
    doc.parts[0].questionGroups[0].charts[0].series[0].values = [24, 29];
    has(errorsOf(doc), 'parts[0].questionGroups[0].charts[0].series[0].values', 'has 2 values but there are 3 labels');
    doc.parts[0].questionGroups[0].charts[0].chartType = 'radar';
    has(errorsOf(doc), 'parts[0].questionGroups[0].charts[0].chartType', 'chartType must be one of line, bar, pie, table, process, map (got "radar")');
  });

  it('bad ids and wrong value types', () => {
    const doc = base();
    doc.parts[0].questionGroups[0].questions[0].id = '1';
    doc.timeLimitMin = '20';
    doc.skill = 'Reading';
    const errs = errorsOf(doc);
    has(errs, 'parts[0].questionGroups[0].questions[0].id', 'must start with a letter');
    has(errs, 'timeLimitMin', 'must be a number of minutes');
    has(errs, 'skill', 'must be one of: reading, listening, writing, speaking, mixed');
  });

  it('reports every problem at once, even when one group is malformed', () => {
    const doc = base();
    doc.parts[0].questionGroups.push({ id: 'g3', type: 'multiple_choice', questions: [{ id: 'q9', number: 9, text: 'x' }] });
    doc.parts[0].questionGroups[1].questions.push({ id: 'q3', number: 2, text: 'Heat is released at ______.' });
    doc.answerKey.q2 = { accept: ['the dark surfaces of buildings'] };
    doc.answerKey.q9 = { accept: ['A'] };
    const errs = errorsOf(doc);
    has(errs, 'parts[0].questionGroups[2].type', 'unknown question type "multiple_choice"');
    has(errs, 'parts[0].questionGroups[1].questions[1].number', 'question number 2 is used twice');
    has(errs, 'answerKey.q2.accept', 'no accepted answer fits the word limit');
    has(errs, 'answerKey.q3', 'is missing');
    expect(errs.some(e => e.path === 'answerKey.q9')).toBe(false); // belongs to the malformed group
  });

  it('warns about gaps in the numbering', () => {
    const doc = base();
    doc.parts[0].questionGroups[1].questions[0].number = 4;
    const r = validateTest(doc);
    expect(r.ok).toBe(true);
    has(r.warnings, 'parts', 'question numbers skip 2, 3');
  });
});

describe('storage helpers', () => {
  it('split → join gives back the same document', () => {
    const r = validateTest(URBAN_BEEKEEPING);
    if (!r.ok) throw new Error('invalid');
    const { meta, content, answerKey } = splitDocument(r.test);
    expect(JSON.stringify(content)).not.toContain('"accept"');
    expect(joinDocument(meta, content, answerKey)).toEqual(r.test);
  });

  it('public content has no transcripts and leaves the original alone', () => {
    const r = validateTest(exampleTestForType('form_completion'));
    if (!r.ok) throw new Error('invalid');
    const { content } = splitDocument(r.test);
    const pub = toPublicContent(content);
    expect(pub.parts[0]?.transcript).toBeUndefined();
    expect(content.parts[0]?.transcript).toBeTruthy();
  });
});
