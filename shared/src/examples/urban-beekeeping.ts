import type { TestDocumentInput } from '../schema/test';

/** the sample reading test (also used as the database seed) */
export const URBAN_BEEKEEPING: TestDocumentInput = {
  title: 'Sample Reading — Urban Beekeeping',
  skill: 'reading',
  kind: 'practice',
  timeLimitMin: 20,
  instructions: 'A short one-passage reading test that uses several question types. You have 20 minutes.',
  parts: [
    {
      id: 'p1',
      title: 'Passage 1',
      instructions: 'Read the text and answer questions 1–17.',
      passage: {
        title: 'The Return of the Urban Beekeeper',
        paragraphs: [
          { label: 'A', text: 'Twenty years ago, the idea of keeping bees on the roof of an office tower would have struck most city planners as eccentric at best. Today, hives can be found on hotels in Paris, railway stations in Tokyo and public libraries in Toronto. The number of registered urban beekeepers in London alone more than doubled between 2008 and 2013, and similar growth has been reported in many large cities. What began as a hobby for a handful of enthusiasts has become a visible part of the modern urban landscape.' },
          { label: 'B', text: "The trend was driven largely by alarm. In the mid-2000s, beekeepers in North America and Europe began reporting sudden and unexplained losses of entire colonies, a phenomenon that was later labelled 'colony collapse disorder'. Media coverage was intense, and many city dwellers concluded that they could help by giving bees a home. Supporters also pointed out that cities can be surprisingly good places for bees: parks, private gardens and roadside verges offer a wide variety of flowers, and urban areas are often treated with fewer agricultural pesticides than the surrounding countryside." },
          { label: 'C', text: 'Yet not all scientists are convinced that the boom has been beneficial. The honeybee is only one of thousands of bee species, and most of the others are wild, solitary insects that do not live in hives at all. Researchers at several universities have warned that when too many managed colonies are placed in a small area, honeybees compete with these wild species for nectar and pollen. One study in Paris found that the number of wild pollinators visiting flowers fell noticeably in districts with the highest density of hives.' },
          { label: 'D', text: 'Disease is a further concern. Honeybees kept close together can pass parasites and viruses from one colony to another, and some of these infections can also spread to wild bees visiting the same flowers. Experienced keepers inspect their hives regularly, but many newcomers lack the knowledge to recognise early signs of illness. For this reason, several cities now require beekeepers to register their hives, and some offer free training courses before a permit is issued.' },
          { label: 'E', text: 'Supporters of urban beekeeping argue that the hobby has educational value that is hard to measure. Schools that keep hives report that pupils become more interested in nature and in where their food comes from. Honey from rooftop hives has also become a popular local product, with some restaurants charging premium prices for dishes made with honey produced only a few metres away.' },
          { label: 'F', text: "Many ecologists now suggest a different approach. Rather than adding more hives, they argue, cities should concentrate on planting the right flowers. Native wildflowers, flowering trees and 'green roofs' covered with low-growing plants benefit honeybees and wild species alike. In this view, the best thing a city resident can do for bees is not to keep them, but to feed them." }
        ]
      },
      questionGroups: [
        {
          id: 'g1', type: 'matching_headings',
          instructions: 'Reading Passage 1 has six paragraphs, **A–F**.\n\nChoose the correct heading for paragraphs **B–F** from the list of headings below.',
          optionsTitle: 'List of Headings',
          options: [
            { label: 'i', text: 'A threat to other insects' },
            { label: 'ii', text: 'The financial cost of keeping bees' },
            { label: 'iii', text: 'Why people started keeping bees in cities' },
            { label: 'iv', text: 'Benefits beyond honey production' },
            { label: 'v', text: 'A risk of spreading illness' },
            { label: 'vi', text: 'Feeding rather than keeping' },
            { label: 'vii', text: 'The decline of rural farming' }
          ],
          questions: [
            { id: 'q1', number: 1, text: 'Paragraph B' },
            { id: 'q2', number: 2, text: 'Paragraph C' },
            { id: 'q3', number: 3, text: 'Paragraph D' },
            { id: 'q4', number: 4, text: 'Paragraph E' },
            { id: 'q5', number: 5, text: 'Paragraph F' }
          ]
        },
        {
          id: 'g2', type: 'tfng',
          instructions: 'Do the following statements agree with the information given in Reading Passage 1?',
          questions: [
            { id: 'q6', number: 6, text: 'The number of urban beekeepers in London rose by more than 100% in five years.' },
            { id: 'q7', number: 7, text: 'Colony collapse disorder was first identified in Europe.' },
            { id: 'q8', number: 8, text: 'Cities generally use more agricultural pesticides than rural areas.' },
            { id: 'q9', number: 9, text: 'Most bee species live in hives.' }
          ]
        },
        {
          id: 'g3', type: 'mcq_single',
          instructions: 'Choose the correct letter, **A**, **B**, **C** or **D**.',
          questions: [{
            id: 'q10', number: 10, text: 'According to paragraph C, the study in Paris showed that',
            options: [
              'honeybee colonies were smaller in the city centre.',
              'fewer wild pollinators visited flowers where hives were most concentrated.',
              'wild bees had started to attack honeybee hives.',
              'the number of flowers in Paris had fallen.'
            ]
          }]
        },
        {
          id: 'g4', type: 'summary_completion',
          instructions: 'Complete the summary below.\n\nChoose **ONE WORD ONLY** from the passage for each answer.',
          title: 'Helping bees in the city',
          wordLimit: { maxWords: 1 },
          template: 'Because illness can spread between colonies, several cities now ask beekeepers to {{q11}} their hives, and some provide free training before a {{q12}} is given. Ecologists believe residents should focus on planting native wildflowers, flowering trees and green {{q13}}, because these help honeybees and {{q14}} species alike.',
          questions: [
            { id: 'q11', number: 11 }, { id: 'q12', number: 12 }, { id: 'q13', number: 13 }, { id: 'q14', number: 14 }
          ]
        },
        {
          id: 'g5', type: 'mcq_multi',
          instructions: 'Choose **TWO** letters, **A–E**.',
          questions: [{
            id: 'q15', numbers: [15, 16], text: 'Which **TWO** benefits of urban beekeeping are mentioned in paragraph E?',
            options: [
              'Pupils become more interested in the natural world.',
              'Beekeepers can earn a high income.',
              'Restaurants can sell expensive dishes made with local honey.',
              'Hives help to reduce air pollution.',
              'Bees make city gardens more attractive.'
            ]
          }]
        },
        {
          id: 'g6', type: 'short_answer',
          instructions: 'Answer the question below.\n\nChoose **NO MORE THAN THREE WORDS** from the passage for the answer.',
          wordLimit: { maxWords: 3 },
          questions: [{ id: 'q17', number: 17, text: 'What name was given to the sudden loss of whole bee colonies?' }]
        }
      ]
    }
  ],
  answerKey: {
    q1: { accept: ['iii'] }, q2: { accept: ['i'] }, q3: { accept: ['v'] }, q4: { accept: ['iv'] }, q5: { accept: ['vi'] },
    q6: { accept: ['TRUE'], explanation: 'Paragraph A: the number “more than doubled between 2008 and 2013”.' },
    q7: { accept: ['NOT GIVEN'], explanation: 'Paragraph B says losses were reported in North America and Europe, but not where it was first identified.' },
    q8: { accept: ['FALSE'], explanation: 'Paragraph B: urban areas are treated with fewer agricultural pesticides.' },
    q9: { accept: ['FALSE'], explanation: 'Paragraph C: most other species are solitary and do not live in hives.' },
    q10: { accept: ['B'] },
    q11: { accept: ['register'] }, q12: { accept: ['permit'] }, q13: { accept: ['roofs'] }, q14: { accept: ['wild'] },
    q15: { accept: ['A', 'C'] },
    q17: { accept: ['(the) colony collapse disorder'] }
  }
};
