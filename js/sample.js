/* ===== Built-in sample tests (original practice material) ===== */

function sampleExams() {
  const reading = {
    id: 'sample_reading_1',
    title: 'Sample Reading — Urban Beekeeping',
    module: 'reading', variant: 'academic', durationMinutes: 20,
    description: 'A short one-passage sample that uses every question type. Try it, then open it in the editor to see how it was built.',
    parts: [{
      id: 'sample_r_p1', title: 'Passage 1',
      passageTitle: 'The Return of the Urban Beekeeper',
      passage:
`[A] Twenty years ago, the idea of keeping bees on the roof of an office tower would have struck most city planners as eccentric at best. Today, hives can be found on hotels in Paris, railway stations in Tokyo and public libraries in Toronto. The number of registered urban beekeepers in London alone more than doubled between 2008 and 2013, and similar growth has been reported in many large cities. What began as a hobby for a handful of enthusiasts has become a visible part of the modern urban landscape.

[B] The trend was driven largely by alarm. In the mid-2000s, beekeepers in North America and Europe began reporting sudden and unexplained losses of entire colonies, a phenomenon that was later labelled 'colony collapse disorder'. Media coverage was intense, and many city dwellers concluded that they could help by giving bees a home. Supporters also pointed out that cities can be surprisingly good places for bees: parks, private gardens and roadside verges offer a wide variety of flowers, and urban areas are often treated with fewer agricultural pesticides than the surrounding countryside.

[C] Yet not all scientists are convinced that the boom has been beneficial. The honeybee is only one of thousands of bee species, and most of the others are wild, solitary insects that do not live in hives at all. Researchers at several universities have warned that when too many managed colonies are placed in a small area, honeybees compete with these wild species for nectar and pollen. One study in Paris found that the number of wild pollinators visiting flowers fell noticeably in districts with the highest density of hives.

[D] Disease is a further concern. Honeybees kept close together can pass parasites and viruses from one colony to another, and some of these infections can also spread to wild bees visiting the same flowers. Experienced keepers inspect their hives regularly, but many newcomers lack the knowledge to recognise early signs of illness. For this reason, several cities now require beekeepers to register their hives, and some offer free training courses before a permit is issued.

[E] Supporters of urban beekeeping argue that the hobby has educational value that is hard to measure. Schools that keep hives report that pupils become more interested in nature and in where their food comes from. Honey from rooftop hives has also become a popular local product, with some restaurants charging premium prices for dishes made with honey produced only a few metres away.

[F] Many ecologists now suggest a different approach. Rather than adding more hives, they argue, cities should concentrate on planting the right flowers. Native wildflowers, flowering trees and 'green roofs' covered with low-growing plants benefit honeybees and wild species alike. In this view, the best thing a city resident can do for bees is not to keep them, but to feed them.`,
      groups: [
        {
          id: 'sample_r_g1', type: 'matching', labelStyle: 'roman', reuse: false, title: 'List of Headings',
          instructions: 'Reading Passage 1 has six paragraphs, **A–F**.\n\nChoose the correct heading for paragraphs **B–F** from the list of headings below.\n\nDrag the correct heading into each box.',
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
            { id: 'sq1', text: 'Paragraph B', answer: 'iii' },
            { id: 'sq2', text: 'Paragraph C', answer: 'i' },
            { id: 'sq3', text: 'Paragraph D', answer: 'v' },
            { id: 'sq4', text: 'Paragraph E', answer: 'iv' },
            { id: 'sq5', text: 'Paragraph F', answer: 'vi' }
          ]
        },
        {
          id: 'sample_r_g2', type: 'tfng', instructions: QTYPES.tfng.instructions,
          questions: [
            { id: 'sq6', text: 'The number of urban beekeepers in London rose by more than 100% in five years.', answer: 'TRUE' },
            { id: 'sq7', text: 'Colony collapse disorder was first identified in Europe.', answer: 'NOT GIVEN' },
            { id: 'sq8', text: 'Cities generally use more agricultural pesticides than rural areas.', answer: 'FALSE' },
            { id: 'sq9', text: 'Most bee species live in hives.', answer: 'FALSE' }
          ]
        },
        {
          id: 'sample_r_g3', type: 'mcq', instructions: QTYPES.mcq.instructions,
          questions: [
            {
              id: 'sq10', text: 'According to paragraph C, the study in Paris showed that',
              options: [
                'honeybee colonies were smaller in the city centre.',
                'fewer wild pollinators visited flowers where hives were most concentrated.',
                'wild bees had started to attack honeybee hives.',
                'the number of flowers in Paris had fallen.'
              ],
              answer: 'B'
            }
          ]
        },
        {
          id: 'sample_r_g4', type: 'completion', title: 'Helping bees in the city',
          instructions: 'Complete the summary below.\n\nChoose **ONE WORD ONLY** from the passage for each answer.',
          content: 'Because illness can spread between colonies, several cities now ask beekeepers to [[register]] their hives, and some provide free training before a [[permit]] is given. Ecologists believe residents should focus on planting native wildflowers, flowering trees and green [[roofs]], because these help honeybees and [[wild]] species alike.'
        },
        {
          id: 'sample_r_g5', type: 'mcq_multi', instructions: QTYPES.mcq_multi.instructions,
          questions: [
            {
              id: 'sq15', text: 'Which **TWO** benefits of urban beekeeping are mentioned in paragraph E?',
              options: [
                'Pupils become more interested in the natural world.',
                'Beekeepers can earn a high income.',
                'Restaurants can sell expensive dishes made with local honey.',
                'Hives help to reduce air pollution.',
                'Bees make city gardens more attractive.'
              ],
              answer: ['A', 'C']
            }
          ]
        },
        {
          id: 'sample_r_g6', type: 'short',
          instructions: 'Answer the question below.\n\nChoose **NO MORE THAN THREE WORDS** from the passage for the answer.',
          questions: [
            { id: 'sq17', text: 'What name was given to the sudden loss of whole bee colonies?', answer: '(the) colony collapse disorder' }
          ]
        }
      ]
    }]
  };

  const writing = {
    id: 'sample_writing_1',
    title: 'Sample Writing — General Training',
    module: 'writing', variant: 'general', durationMinutes: 60,
    description: 'Task 1 letter and Task 2 essay with a live word counter.',
    parts: [
      {
        id: 'sample_w_p1', title: 'Task 1', minWords: 150,
        prompt: 'You should spend about 20 minutes on this task.\n\nYou recently bought a piece of kitchen equipment, but it did not work properly. You phoned the shop, but no action was taken.\n\nWrite a letter to the shop manager. In your letter\n\n- describe the problem with the equipment\n- explain what happened when you phoned the shop\n- say what you would like the manager to do\n\nWrite at least 150 words.\n\nYou do **NOT** need to write any addresses.\n\nBegin your letter as follows:\n\n*Dear Sir or Madam,*',
        modelAnswer: '', groups: []
      },
      {
        id: 'sample_w_p2', title: 'Task 2', minWords: 250,
        prompt: 'You should spend about 40 minutes on this task.\n\nWrite about the following topic:\n\n**Some people believe that children should start learning a foreign language at primary school rather than at secondary school.**\n\n**Do the advantages of this outweigh the disadvantages?**\n\nGive reasons for your answer and include any relevant examples from your own knowledge or experience.\n\nWrite at least 250 words.',
        modelAnswer: '', groups: []
      }
    ]
  };

  return [normalizeExam(reading), normalizeExam(writing)];
}

async function seedSamplesIfFirstRun() {
  if (localStorage.getItem('ielts-seeded')) return;
  const existing = await DB.getAll('exams');
  if (!existing.length) for (const ex of sampleExams()) await DB.saveExam(ex);
  localStorage.setItem('ielts-seeded', '1');
}
