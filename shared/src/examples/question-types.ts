import type { QuestionType } from '../schema/groups';
import type { AnswerKeyEntry, SectionSkill, TestDocumentInput } from '../schema/test';

export interface QuestionTypeExample {
  description: string;
  /** which kind of part the group goes in */
  section: SectionSkill;
  group: Record<string, unknown>;
  answerKey: Record<string, AnswerKeyEntry>;
}

const MAP_URL = 'https://example.com/images/campus-map.png';
const DIAGRAM_URL = 'https://example.com/images/solar-water-heater.png';

/** one small, valid example per question type (used by tests and by the get_test_format tool) */
export const QUESTION_TYPE_EXAMPLES: Record<QuestionType, QuestionTypeExample> = {
  tfng: {
    description: 'TRUE / FALSE / NOT GIVEN statements about the passage.',
    section: 'reading',
    group: { id: 'g1', type: 'tfng', instructions: 'Do the following statements agree with the information given in the passage?', questions: [{ id: 'q1', number: 1, text: 'Green roofs reduce indoor temperatures.' }] },
    answerKey: { q1: { accept: ['TRUE'] } }
  },
  ynng: {
    description: "YES / NO / NOT GIVEN statements about the writer's views.",
    section: 'reading',
    group: { id: 'g1', type: 'ynng', instructions: 'Do the following statements agree with the claims of the writer?', questions: [{ id: 'q1', number: 1, text: 'Cities should plant more trees.' }] },
    answerKey: { q1: { accept: ['YES'] } }
  },
  mcq_single: {
    description: 'Multiple choice with one correct answer; options are shown as A, B, C…',
    section: 'reading',
    group: { id: 'g1', type: 'mcq_single', instructions: 'Choose the correct letter, A, B, C or D.', questions: [{ id: 'q1', number: 1, text: 'What is the main cause of urban heat?', options: ['traffic', 'dark surfaces', 'air conditioning', 'factories'] }] },
    answerKey: { q1: { accept: ['B'] } }
  },
  mcq_multi: {
    description: 'Choose TWO/THREE: one question with one number per correct option (each correct option = 1 mark). The key lists exactly that many letters.',
    section: 'reading',
    group: { id: 'g1', type: 'mcq_multi', instructions: 'Choose TWO letters, A–E.', questions: [{ id: 'q1', numbers: [1, 2], text: 'Which TWO methods of cooling cities are mentioned?', options: ['painting roofs white', 'banning cars', 'planting trees', 'building canals', 'closing factories'] }] },
    answerKey: { q1: { accept: ['A', 'C'] } }
  },
  matching_headings: {
    description: 'Choose a heading for each paragraph. Options are the headings (labels i, ii, iii…); the key is a label.',
    section: 'reading',
    group: { id: 'g1', type: 'matching_headings', instructions: 'Choose the correct heading for each paragraph.', optionsTitle: 'List of Headings', options: [{ label: 'i', text: 'Why cities are hotter' }, { label: 'ii', text: 'Solutions from nature' }, { label: 'iii', text: 'The cost of air conditioning' }], questions: [{ id: 'q1', number: 1, text: 'Paragraph A' }, { id: 'q2', number: 2, text: 'Paragraph B' }] },
    answerKey: { q1: { accept: ['i'] }, q2: { accept: ['ii'] } }
  },
  matching_information: {
    description: 'Which paragraph contains the information? Options are the paragraph letters (text can be empty).',
    section: 'reading',
    group: { id: 'g1', type: 'matching_information', instructions: 'Which paragraph contains the following information? You may use any letter more than once.', allowReuse: true, options: [{ label: 'A' }, { label: 'B' }], questions: [{ id: 'q1', number: 1, text: 'a reference to the cost of cooling buildings' }] },
    answerKey: { q1: { accept: ['B'] } }
  },
  matching_features: {
    description: 'Match statements with people, places or dates.',
    section: 'reading',
    group: { id: 'g1', type: 'matching_features', instructions: 'Match each statement with the correct researcher, A–C.', optionsTitle: 'List of Researchers', options: [{ label: 'A', text: 'Dr Lee' }, { label: 'B', text: 'Prof. Martins' }, { label: 'C', text: 'Dr Okafor' }], questions: [{ id: 'q1', number: 1, text: 'measured temperatures on green roofs' }] },
    answerKey: { q1: { accept: ['C'] } }
  },
  matching_sentence_endings: {
    description: 'Complete each sentence with the correct ending.',
    section: 'reading',
    group: { id: 'g1', type: 'matching_sentence_endings', instructions: 'Complete each sentence with the correct ending, A–C.', options: [{ label: 'A', text: 'reflect more sunlight.' }, { label: 'B', text: 'store heat overnight.' }, { label: 'C', text: 'need less water.' }], questions: [{ id: 'q1', number: 1, text: 'Light-coloured roofs' }] },
    answerKey: { q1: { accept: ['A'] } }
  },
  definition_match: {
    description: 'Vocabulary quiz (skill "vocabulary", no passage): match each word with its meaning. Add "vocabularySetId" to the test to log the result in that set.',
    section: 'vocabulary',
    group: { id: 'g1', type: 'definition_match', instructions: 'Match each word with its meaning, A-D.', optionsTitle: 'Meanings', options: [{ label: 'A', text: 'make less severe' }, { label: 'B', text: 'make worse' }, { label: 'C', text: 'harmful' }, { label: 'D', text: 'become smaller' }], questions: [{ id: 'q1', number: 1, text: 'mitigate' }, { id: 'q2', number: 2, text: 'exacerbate' }] },
    answerKey: { q1: { accept: ['A'] }, q2: { accept: ['B'] } }
  },
  opposite_match: {
    description: 'Vocabulary quiz: match each word with its opposite (trains the near-opposite trap of word boxes).',
    section: 'vocabulary',
    group: { id: 'g1', type: 'opposite_match', instructions: 'Choose the OPPOSITE of each word, A-C.', optionsTitle: 'Opposites', options: [{ label: 'A', text: 'aggravate' }, { label: 'B', text: 'beneficial' }, { label: 'C', text: 'proliferate' }], questions: [{ id: 'q1', number: 1, text: 'mitigate' }, { id: 'q2', number: 2, text: 'detrimental' }] },
    answerKey: { q1: { accept: ['A'] }, q2: { accept: ['B'] } }
  },
  map_labelling: {
    description: 'Listening: label a map or plan with letters. imageUrl is required.',
    section: 'listening',
    group: { id: 'g1', type: 'map_labelling', instructions: 'Label the map below. Write the correct letter, A–D.', imageUrl: MAP_URL, options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }], questions: [{ id: 'q1', number: 1, text: 'Library' }, { id: 'q2', number: 2, text: 'Sports centre' }] },
    answerKey: { q1: { accept: ['C'] }, q2: { accept: ['A'] } }
  },
  sentence_completion: {
    description: 'Each question is a sentence with "______" where the gap goes. wordLimit is enforced when marking.',
    section: 'reading',
    group: { id: 'g1', type: 'sentence_completion', instructions: 'Complete the sentences. Choose NO MORE THAN TWO WORDS AND/OR A NUMBER from the passage.', wordLimit: { maxWords: 2, allowNumber: true }, questions: [{ id: 'q1', number: 1, text: 'Cities absorb heat because of their ______.' }] },
    answerKey: { q1: { accept: ['dark surfaces', '(the) dark surface'] } }
  },
  summary_completion: {
    description: 'A summary with gaps. Here with a word box: "options" makes each answer an option label.',
    section: 'reading',
    group: { id: 'g1', type: 'summary_completion', instructions: 'Complete the summary using the list of words, A–D.', title: 'Cooling cities', template: 'Green roofs are {{q1}} to install but they reduce {{q2}} costs.', options: [{ label: 'A', text: 'cheap' }, { label: 'B', text: 'expensive' }, { label: 'C', text: 'energy' }, { label: 'D', text: 'water' }], questions: [{ id: 'q1', number: 1 }, { id: 'q2', number: 2 }] },
    answerKey: { q1: { accept: ['B'] }, q2: { accept: ['C'] } }
  },
  note_completion: {
    description: 'Notes laid out in a template: "# heading", "- bullet", with {{questionId}} at each gap.',
    section: 'listening',
    group: { id: 'g1', type: 'note_completion', instructions: 'Complete the notes. Write ONE WORD ONLY for each answer.', wordLimit: { maxWords: 1 }, template: '# Urban heat\n- Main cause: dark {{q1}}\n- Best solution: planting {{q2}}', questions: [{ id: 'q1', number: 1 }, { id: 'q2', number: 2 }] },
    answerKey: { q1: { accept: ['surfaces'] }, q2: { accept: ['trees'] } }
  },
  table_completion: {
    description: 'A table in the template: one row per line, cells separated by "|"; the first row is the header.',
    section: 'listening',
    group: { id: 'g1', type: 'table_completion', instructions: 'Complete the table. Write NO MORE THAN TWO WORDS AND/OR A NUMBER.', wordLimit: { maxWords: 2, allowNumber: true }, template: 'City | Temperature rise | Main solution\nParis | {{q1}} | green roofs\nTokyo | 3°C | {{q2}}', questions: [{ id: 'q1', number: 1 }, { id: 'q2', number: 2 }] },
    answerKey: { q1: { accept: ['2°C', '2 degrees'] }, q2: { accept: ['white roofs'] } }
  },
  flowchart_completion: {
    description: 'A flow-chart: each "> " line in the template is a box.',
    section: 'reading',
    group: { id: 'g1', type: 'flowchart_completion', instructions: 'Complete the flow-chart. Choose ONE WORD ONLY from the passage.', wordLimit: { maxWords: 1 }, template: '> Sunlight hits dark {{q1}}\n> Heat is stored\n> Heat is released at {{q2}}', questions: [{ id: 'q1', number: 1 }, { id: 'q2', number: 2 }] },
    answerKey: { q1: { accept: ['surfaces'] }, q2: { accept: ['night'] } }
  },
  diagram_labelling: {
    description: 'Label a diagram with words; each question text names the part, with "______" for the gap.',
    section: 'reading',
    group: { id: 'g1', type: 'diagram_labelling', instructions: 'Label the diagram. Choose ONE WORD ONLY from the passage.', imageUrl: DIAGRAM_URL, wordLimit: { maxWords: 1 }, questions: [{ id: 'q1', number: 1, text: 'Water is heated in the ______' }] },
    answerKey: { q1: { accept: ['panel'] } }
  },
  form_completion: {
    description: 'A form (listening): template lines such as "Name: {{q1}}".',
    section: 'listening',
    group: { id: 'g1', type: 'form_completion', instructions: 'Complete the form. Write ONE WORD AND/OR A NUMBER for each answer.', wordLimit: { maxWords: 1, allowNumber: true }, template: '# Booking form\nName: Sarah {{q1}}\nPhone: {{q2}}', questions: [{ id: 'q1', number: 1 }, { id: 'q2', number: 2 }] },
    answerKey: { q1: { accept: ['Mitchell'] }, q2: { accept: ['07700900123', '07700 900123'] } }
  },
  short_answer: {
    description: 'Short-answer questions with a word limit.',
    section: 'reading',
    group: { id: 'g1', type: 'short_answer', instructions: 'Answer the questions. Choose NO MORE THAN THREE WORDS from the passage.', wordLimit: { maxWords: 3 }, questions: [{ id: 'q1', number: 1, text: 'What material do most city roads use?' }] },
    answerKey: { q1: { accept: ['(black) asphalt'] } }
  },
  writing_task1: {
    description: 'Academic Task 1: the visual is stored as chart data (line, bar, pie, table, process, map) and drawn on the page. imageUrl is optional.',
    section: 'writing',
    group: {
      id: 'w1', type: 'writing_task1',
      prompt: 'The chart below shows the average summer temperature in three cities in 1990 and 2020.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.\n\nWrite at least 150 words.',
      charts: [{ chartType: 'bar', title: 'Average summer temperature (°C)', unit: '°C', labels: ['Paris', 'Tokyo', 'Cairo'], series: [{ name: '1990', values: [24, 29, 34] }, { name: '2020', values: [27, 31, 36] }] }],
      minWords: 150, timeLimitMin: 20
    },
    answerKey: { w1: { notes: 'Look for an overview: all three cities got hotter; Cairo remained the hottest.' } }
  },
  writing_task2: {
    description: 'Task 2 essay. mode "plan_intro" is the drill: a plan and an introduction only, each with its own timer.',
    section: 'writing',
    group: { id: 'w1', type: 'writing_task2', prompt: 'Some people think cities should spend money on parks rather than on roads. To what extent do you agree or disagree?', mode: 'plan_intro', planTimeMin: 5, introTimeMin: 10, introMinWords: 40 },
    answerKey: { w1: { modelAnswer: 'Plan: … Introduction: …' } }
  },
  sentence_rewrite: {
    description: 'Repair task / sentence homework: one answer box per sentence, each marked by you (save_feedback "items": [{ "itemId": "r1", "correct": true, "comment": "..." }]). answerKey.<itemId>.modelAnswer is shown after marking.',
    section: 'writing',
    group: { id: 'w1', type: 'sentence_rewrite', instructions: 'Rewrite each sentence at band 7+.', items: [{ id: 'r1', number: 1, text: 'Many graduates can not find job because of leak of experience.' }, { id: 'r2', number: 2, text: 'Government should to invest more money for public transport.' }] },
    answerKey: { r1: { modelAnswer: 'Many graduates cannot find a job because they lack experience.' }, r2: { modelAnswer: 'The government should invest more in public transport.' } }
  },
  paragraph: {
    description: 'A single body paragraph (PEEL: Point, Explain, Example, Link).',
    section: 'writing',
    group: { id: 'w1', type: 'paragraph', prompt: 'Write one PEEL paragraph arguing that green roofs should be compulsory on new buildings.', structure: 'PEEL', minWords: 100, timeLimitMin: 15 },
    answerKey: {}
  },
  speaking_part1: {
    description: 'Speaking Part 1: short questions on a familiar topic. Answered by recording and/or typed notes.',
    section: 'speaking',
    group: { id: 's1', type: 'speaking_part1', topic: 'Your home town', questions: [{ id: 's1q1', text: 'Where is your home town?' }, { id: 's1q2', text: 'What do you like most about it?' }] },
    answerKey: {}
  },
  speaking_part2: {
    description: 'Speaking Part 2: cue card with 1 minute to prepare and 2 minutes to talk.',
    section: 'speaking',
    group: { id: 's2', type: 'speaking_part2', cueCard: { topic: 'Describe a park you enjoy visiting.', bullets: ['where it is', 'how often you go there', 'what you do there'], closing: 'and explain why you enjoy visiting it.' }, prepTimeSec: 60, talkTimeSec: 120, followUps: [{ id: 's2f1', text: 'Do many people go there?' }] },
    answerKey: {}
  },
  speaking_part3: {
    description: 'Speaking Part 3: discussion questions linked to the Part 2 topic.',
    section: 'speaking',
    group: { id: 's3', type: 'speaking_part3', topic: 'Public spaces', questions: [{ id: 's3q1', text: 'Why are parks important in cities?' }] },
    answerKey: {}
  }
};

const EXAMPLE_PASSAGE = {
  title: 'Cooling the Concrete Jungle',
  paragraphs: [
    { label: 'A', text: 'Cities are often several degrees warmer than the surrounding countryside because dark surfaces absorb sunlight.' },
    { label: 'B', text: 'Planting trees and painting roofs white are two of the cheapest ways to cool a city.' }
  ]
};

/** wrap one example group in a complete, valid test document */
export function exampleTestForType(type: QuestionType): TestDocumentInput {
  const ex = QUESTION_TYPE_EXAMPLES[type];
  const part: Record<string, unknown> = { id: 'p1', title: ex.section === 'writing' ? 'Task' : ex.section === 'speaking' ? 'Speaking' : 'Part 1', questionGroups: [ex.group] };
  if (ex.section === 'reading') part.passage = EXAMPLE_PASSAGE;
  if (ex.section === 'vocabulary') part.title = 'Vocabulary';
  if (ex.section === 'listening') part.transcript = 'Narrator: You will hear a conversation about … (the full transcript goes here).';
  return {
    title: `Example — ${type}`,
    skill: ex.section,
    kind: 'practice',
    parts: [part as never],
    answerKey: ex.answerKey
  };
}
