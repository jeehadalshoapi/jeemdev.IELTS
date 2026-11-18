// Fresh database for browser checks: the sample reading test, a listening drill (with transcript, read aloud), a writing task,
// for Phase 6 a chart gallery, a Task 2 plan + introduction drill and a speaking test, and for Phase 7 finished
// attempts over two weeks (reading, listening, a Task 2 essay), two of them with Claude's feedback.
//   npx tsx scripts/e2e/prepare-db.ts        (writes .data/e2e/ids.json)
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { exampleTestForType } from '../../shared/src';
import { createAttempt, saveAttempt } from '../../server/src/attempts/service';
import { openDatabase } from '../../server/src/db/client';
import { attempts } from '../../server/src/db/schema';
import { addMistakes, recordVocabResult, saveLesson, upsertVocabSet } from '../../server/src/study/store';
import { seedSample } from '../../server/src/seed';
import { createTest } from '../../server/src/tests/repository';

rmSync('.data/e2e', { recursive: true, force: true });
mkdirSync('.data/e2e', { recursive: true });
const d = await openDatabase({ pgliteDir: '.data/e2e/pglite' });
await d.migrate();
await seedSample(d.db);
const listening = await createTest(d.db, { ...exampleTestForType('form_completion'), title: 'Listening drill — Hotel booking', timeLimitMin: 10 }, { source: 'claude' });
const writing = await createTest(d.db, { ...exampleTestForType('writing_task1'), title: 'Writing Task 1 — City temperatures', kind: 'homework', dueDate: '2026-12-31' }, { source: 'claude' });

// Phase 6: every Task 1 chart type, the Task 2 plan + introduction drill, and a speaking test
const task1 = (id: string, charts: unknown[]) => ({ id: `part-${id}`, title: `Task 1 — ${id}`, questionGroups: [{ id, type: 'writing_task1', prompt: `The ${id} below shows information. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.`, charts }] });
const gallery = await createTest(d.db, {
  title: 'Chart gallery (e2e)', skill: 'writing', kind: 'practice',
  parts: [
    task1('line', [{ chartType: 'line', title: 'Average temperature in three cities', unit: '°C', xLabel: 'Month', yLabel: 'Temperature (°C)', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [
      { name: 'London', values: [5, 6, 9, 12, 15, 18] }, { name: 'Cairo', values: [14, 16, 19, 23, 27, 29] }, { name: 'Moscow', values: [-7, -6, null, 6, 13, 17] }] }]),
    task1('bars', [
      { chartType: 'bar', title: 'Visitors to three museums', unit: 'thousands', labels: ['2019', '2020', '2021', '2022'], series: [
        { name: 'Science', values: [420, 180, 260, 390] }, { name: 'History', values: [310, 120, 200, 330] }, { name: 'Art', values: [150, 60, 110, 170] }] },
      { chartType: 'bar', orientation: 'horizontal', stacked: true, title: 'How students travel to school', unit: '%', labels: ['Walk', 'Bicycle', 'Bus', 'Car', 'Train'], series: [
        { name: '2000', values: [30, 10, 25, 25, 10] }, { name: '2020', values: [22, 18, 30, 20, 10] }] }]),
    task1('pie', [{ chartType: 'pie', title: 'Electricity sources', unit: '%', pies: [
      { title: '1990', slices: [{ label: 'Coal', value: 52 }, { label: 'Gas', value: 23 }, { label: 'Nuclear', value: 17 }, { label: 'Renewables', value: 8 }] },
      { title: '2020', slices: [{ label: 'Coal', value: 18 }, { label: 'Gas', value: 35 }, { label: 'Nuclear', value: 16 }, { label: 'Renewables', value: 31 }] }] }]),
    task1('process', [{ chartType: 'process', title: 'How glass bottles are recycled', cyclic: true, steps: [
      { label: 'Collection', detail: 'bottles are taken to a collection point' }, { label: 'Sorting', detail: 'by colour' }, { label: 'Cleaning' },
      { label: 'Melting', detail: 'at 1,500°C' }, { label: 'Moulding', detail: 'into new bottles' }] },
      { chartType: 'table', title: 'Bottles recycled per year', unit: 'millions', columns: ['Country', '2010', '2020'], rows: [['Spain', 120, 210], ['Italy', 140, 260], ['Greece', 30, 75]] }]),
    task1('maps', [{ chartType: 'map', title: 'Riverside village', maps: [
      { title: '1995', features: [{ label: 'River', shape: 'water', x: 50, y: 88, width: 100, height: 14 }, { label: 'Main Road', shape: 'road', x: 50, y: 50 }, { label: 'Farm', shape: 'area', x: 25, y: 25, width: 34, height: 30 }, { label: 'Houses', shape: 'building', x: 72, y: 28, width: 18, height: 14 }, { label: 'Forest', shape: 'trees', x: 75, y: 70, width: 30, height: 16 }] },
      { title: 'Today', features: [{ label: 'River', shape: 'water', x: 50, y: 88, width: 100, height: 14 }, { label: 'Main Road', shape: 'road', x: 50, y: 50 }, { label: 'Shopping centre', shape: 'building', x: 25, y: 25, width: 30, height: 22 }, { label: 'Houses', shape: 'building', x: 72, y: 28, width: 18, height: 14 }, { label: 'Car park', shape: 'area', x: 75, y: 70, width: 30, height: 16 }, { label: 'Bus stop', shape: 'point', x: 45, y: 42 }] }] }])
  ]
}, { source: 'claude' });
const drill = await createTest(d.db, { ...exampleTestForType('writing_task2'), title: 'Task 2 drill (e2e)', kind: 'homework' }, { source: 'claude' });
const p1 = exampleTestForType('speaking_part1'), p2 = exampleTestForType('speaking_part2');
const speaking = await createTest(d.db, {
  title: 'Speaking practice (e2e)', skill: 'speaking', kind: 'practice',
  parts: [
    { ...(p1.parts[0] as object), id: 'sp1', title: 'Part 1' } as never,
    { ...(p2.parts[0] as object), id: 'sp2', title: 'Part 2' } as never
  ]
}, { source: 'claude' });
// Phase 7: finished attempts spread over two weeks (for the progress charts), two of them marked by Claude
const SAMPLE = '5a3f6c1e-0000-4000-8000-000000000001';
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);
async function finished(testId: string, answers: Record<string, unknown>, ago: number, feedback?: Record<string, unknown>): Promise<string> {
  const id = await createAttempt(d.db, testId, 'practice');
  await saveAttempt(d.db, id, { answers }, 'e2e', { submit: true });
  await d.db.update(attempts).set({
    startedAt: daysAgo(ago + 0.02), submittedAt: daysAgo(ago), updatedAt: daysAgo(ago), timeSpentSec: { total: 900 + ago * 20 },
    ...(feedback ? { feedback: { ...feedback, savedAt: daysAgo(ago - 0.05).toISOString() } as never, status: 'marked' as const } : {})
  }).where(eq(attempts.id, id));
  return id;
}
/** the sample reading test with these questions right and the rest wrong */
const KEY: Record<string, string | string[]> = { q1: 'iii', q2: 'i', q3: 'v', q4: 'iv', q5: 'vi', q6: 'TRUE', q7: 'NOT GIVEN', q8: 'FALSE', q9: 'FALSE', q10: 'B', q11: 'register', q12: 'permit', q13: 'roofs', q14: 'wild', q15: ['A', 'C'], q17: 'colony collapse disorder' };
const WRONG: Record<string, string | string[]> = { q1: 'ii', q2: 'iv', q3: 'i', q4: 'v', q5: 'ii', q6: 'FALSE', q7: 'FALSE', q8: 'TRUE', q9: 'NOT GIVEN', q10: 'C', q11: 'record', q12: 'permitt', q13: 'gardens', q14: 'native', q15: ['A', 'D'], q17: 'the colony collapse disorder problem' };
const reading = (right: string[]) => Object.fromEntries(Object.keys(KEY).map(q => [q, right.includes(q) ? KEY[q]! : WRONG[q]!]));
const r1 = ['q1', 'q2', 'q6', 'q10', 'q11'];
await finished(SAMPLE, reading(r1), 13);
await finished(SAMPLE, reading([...r1, 'q3', 'q7', 'q13']), 9);
await finished(SAMPLE, reading([...r1, 'q3', 'q7', 'q13', 'q4', 'q8', 'q14']), 6);
await finished(SAMPLE, reading([...r1, 'q3', 'q7', 'q13', 'q4', 'q8', 'q14', 'q5', 'q9']), 3);
const readingMarked = await finished(SAMPLE, reading([...r1, 'q3', 'q13', 'q4', 'q8', 'q14', 'q5', 'q9', 'q12', 'q15']), 1, {
  overallBand: 7,
  summary: 'A strong attempt: **16 of 17** on the headings, summary and multiple choice.\n\nTwo things cost you marks:\n- the word limit on question 17\n- a NOT GIVEN trap on question 7',
  mistakes: [
    { questionId: 'q17', yourAnswer: 'the colony collapse disorder problem', correct: 'colony collapse disorder', explanation: 'Five words where the limit is **NO MORE THAN THREE WORDS**: marked wrong even though the idea is right.', category: 'word limit' },
    { questionId: '7', yourAnswer: 'FALSE', correct: 'NOT GIVEN', explanation: 'The passage says where losses were *reported*, not where the problem was first found.', category: 'reading trap' },
    { explanation: 'You spent 11 minutes on the matching headings. Aim for 8.', category: 'timing' }
  ],
  nextSteps: ['Count the words of every gap answer before moving on.', 'Do the NOT GIVEN drill on the dashboard.'],
  strengths: ['Fast and accurate on True / False / Not Given', 'No spelling mistakes this time']
});
await finished(listening.id, { q1: 'Mitchel', q2: '07700 900123' }, 10);
await finished(listening.id, { q1: 'Mitchell', q2: '07700 900123' }, 4);

const essayTest = await createTest(d.db, {
  title: 'Writing Task 2 — Parks or roads (e2e)', skill: 'writing', kind: 'homework',
  parts: [{ id: 'task2', title: 'Task 2', questionGroups: [{ id: 'essay', type: 'writing_task2', prompt: 'Some people think cities should spend money on parks rather than on roads. To what extent do you agree or disagree?' }] }]
}, { source: 'claude' });
const ESSAY = 'Nowadays many people think that goverments should spend more money on parks than roads. I completely agree with this opinion because parks improve our health and they make cities more beautiful.\n\nFirstly, parks give people a place to do exercise. Many graduates can not find job because of leak of experiance, but they can at least walk in a park for free. In addition, trees clean the air.\n\nIn conclusion, I believe parks is more important than roads.';
const CORRECTED = 'Nowadays many people think that governments should spend more money on parks than on roads. I completely agree with this opinion because parks improve our health and make cities more beautiful.\n\nFirstly, parks give people a place to exercise. Many young people cannot afford a gym, but they can at least walk in a park for free. In addition, trees clean the air.\n\nIn conclusion, I believe parks are more important than roads.';
await finished(essayTest.id, { essay: ESSAY }, 11, { overallBand: 5.5, summary: 'A clear position but too short.', mistakes: [{ questionId: 'essay', explanation: 'Under 250 words.', category: 'task response' }] });
await finished(essayTest.id, { essay: ESSAY }, 7, { overallBand: 6, summary: 'Better paragraphing.', mistakes: [{ questionId: 'essay', yourAnswer: 'goverments', correct: 'governments', explanation: 'Spelling.', category: 'spelling' }] });
const writingMarked = await finished(essayTest.id, { essay: ESSAY }, 2, {
  overallBand: 6.5,
  criteria: { TR: 6, CC: 6.5, LR: 6.5, GRA: 6 },
  summary: 'Your position is clear from the first paragraph and you keep to it. The essay is **too short** (about 90 words), so Task Response cannot go above 6.',
  mistakes: [
    { questionId: 'essay', yourAnswer: 'goverments', correct: 'governments', explanation: 'One of your "never again" words.', category: 'spelling' },
    { questionId: 'essay', yourAnswer: 'experiance', correct: 'experience', explanation: 'experi-ENCE, like science and evidence.', category: 'spelling' },
    { questionId: 'essay', yourAnswer: 'can not find job because of leak of', correct: 'cannot find a job because of a lack of', explanation: '*cannot* is one word; *job* needs an article; *leak* means water escaping.', category: 'grammar' },
    { questionId: 'essay', yourAnswer: 'parks is', correct: 'parks are', explanation: 'Plural subject, plural verb.', category: 'grammar' }
  ],
  correctedText: CORRECTED,
  nextSteps: ['Write at least 260 words: plan 4 paragraphs of about 65 words.', 'Add the spelling words to your daily review.']
});

// Phase 8: lessons, a vocabulary set with a self-test, a mistakes log
await saveLesson(d.db, {
  id: 'day23-band-6-7-8', day: 23, week: 'writing', title: 'What separates band 6, 7 and 8', skill: 'writing', summary: 'Task Response, Coherence, Lexis and Grammar at three levels.',
  sections: [
    { heading: 'The one-line difference', markdown: 'Band 6 answers the topic. Band 7 answers **the exact question**. Band 8 does it with precision:\n- a clear position in the introduction\n- every paragraph supports it' },
    { heading: 'Band descriptors', table: { header: ['', 'Band 6', 'Band 7', 'Band 8'], rows: [['Task Response', 'relevant, some parts unclear', 'clear position throughout', 'fully developed'], ['Lexical Resource', 'adequate range', 'less common items', 'wide range, natural']] } },
    { heading: 'Same paragraph at three levels', examples: [{ label: 'Band 6', text: 'Parks is good for health because people can walk there.', notes: ['grammar slip', 'vague reason'] }, { label: 'Band 8', text: 'Green spaces encourage regular exercise, which reduces the burden on public health systems.' }] },
    { tip: 'Before writing, underline the **question words** and answer exactly those.' }
  ],
  relatedTestIds: [essayTest.id], vocabularySetIds: ['set-3']
}, 'create');
await saveLesson(d.db, { id: 'tfng-rules', kind: 'reference', title: 'True / False / Not Given rules', skill: 'reading', summary: 'How to decide in under a minute.', sections: [{ markdown: '1. Find the topic words\n2. Compare the claim, not the words\n3. No information = NOT GIVEN' }, { tip: '*many* ≠ *most*' }] }, 'create');
await upsertVocabSet(d.db, {
  id: 'set-3', number: 3, theme: 'Good and bad effects', studyDay: 23, words: [
    { word: 'mitigate', pos: 'v', arabic: 'يخفف (من حدة)', meaning: 'make less severe', opposite: 'aggravate', trap: 'mitigate risks/effects; alleviate pain/poverty', example: 'Trees can mitigate the effects of heat.' },
    { word: 'alleviate', pos: 'v', arabic: 'يخفف', meaning: 'make pain or a problem less', opposite: 'worsen', example: 'Aid alleviated poverty.' },
    { word: 'exacerbate', pos: 'v', arabic: 'يفاقم', meaning: 'make worse', opposite: 'ease', example: 'Traffic exacerbates pollution.' },
    { word: 'detrimental', pos: 'adj', arabic: 'ضار', meaning: 'harmful', opposite: 'beneficial', example: 'Noise is detrimental to sleep.' }
  ]
});
await upsertVocabSet(d.db, { id: 'set-1', number: 1, theme: 'Change and trends', studyDay: 18, words: [{ word: 'dwindle', meaning: 'become smaller' }, { word: 'proliferate', meaning: 'increase rapidly' }, { word: 'unprecedented', meaning: 'never done before' }] });
await recordVocabResult(d.db, { setId: 'set-1', quiz: 1, date: '2026-11-17', score: 4, total: 7, weakWords: ['dwindle', 'proliferate'] });
await addMistakes(d.db, [
  { category: 'spelling', wrong: 'experiance', correct: 'experience', rule: 'experi-ence, like science and evidence.', timesWrong: 3 },
  { category: 'spelling', wrong: 'goverment', correct: 'government', rule: 'govern + ment', timesWrong: 2 },
  { category: 'spelling', wrong: 'enviroment', correct: 'environment', rule: 'environ + ment' },
  { category: 'grammar', wrong: 'parks is', correct: 'parks are', rule: 'plural subject, plural verb' },
  { category: 'capitals', wrong: 'english', correct: 'English', rule: 'Languages take a capital.' },
  { category: 'reading_trap', wrong: 'most', correct: 'many', rule: 'many ≠ most' }
]);

writeFileSync('.data/e2e/ids.json', JSON.stringify({ sample: SAMPLE, listening: listening.id, writing: writing.id, gallery: gallery.id, drill: drill.id, speaking: speaking.id, essay: essayTest.id, readingMarked, writingMarked }));
await d.close();
console.log('Ready. Start the server with:  PGLITE_DIR=.data/e2e/pglite UPLOAD_DIR=.data/e2e/uploads node server/dist/main.js');
