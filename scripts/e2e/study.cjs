// Phase 8 check: Lessons (list, search, lesson page), Vocabulary (cards, table, flashcards), My Mistakes (tabs, banner,
// the 5-minute review with practice after a wrong answer), phone layout. Needs the database from prepare-db.ts.
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const flat = sel => `[...document.querySelectorAll('${sel}')].map(x => x.innerText.replace(/\\s*\\n\\s*/g, ' ')).join(' || ')`;
const typeInto = (sel, v) => `{ const i = document.querySelector('${sel}'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); }`;

module.exports = [
  { name: 'log in', viewport: [1400, 900], eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  {
    name: 'lessons list + search', eval: `
      location.hash = '#/lessons'; ${wait(1200)}
      const before = 'nav: ' + ${flat('.tabs a')} + '\\nsections: ' + ${flat('.section-title')} + '\\nitems: ' + document.querySelectorAll('.lesson-item').length;
      ${typeInto('.lesson-search', 'not given')} ${wait(200)}
      return before + '\\nsearch "not given": ' + ${flat('.lesson-item b')};`, shot: 'study-1-lessons'
  },
  {
    name: 'lesson page', eval: `
      location.hash = '#/lesson/day23-band-6-7-8'; ${wait(1200)}
      return 'title: ' + document.querySelector('h1').innerText + '\\nsections: ' + document.querySelectorAll('.lesson-section').length + ' | table rows: ' + document.querySelectorAll('.lesson-table tbody tr').length
        + ' | examples: ' + document.querySelectorAll('.lesson-example').length + ' | tip: ' + !!document.querySelector('.lesson-tip strong') + ' | bullets: ' + document.querySelectorAll('.lesson-md li').length
        + '\\nlinks: ' + ${flat('.lesson-links .btn')};`, shot: 'study-2-lesson'
  },
  {
    name: 'vocabulary sets', eval: `
      location.hash = '#/vocab'; ${wait(1200)}
      return ${flat('.set-card')} + '\\ntotal: ' + document.querySelector('.vocab-total .card-title').innerText;`, shot: 'study-3-vocab'
  },
  {
    name: 'set: table, change a status', eval: `
      location.hash = '#/vocab/set-3'; ${wait(1200)}
      const rows = ${flat('.vocab-table tbody tr')};
      const sel = document.querySelector('.status-select'); sel.value = 'learned'; sel.dispatchEvent(new Event('change')); ${wait(700)}
      return rows + '\\nlegend after: ' + document.querySelector('.status-legend').innerText.replace(/\\n/g, ' ');`, shot: 'study-4-table'
  },
  {
    name: 'set: flashcards', eval: `
      [...document.querySelectorAll('.seg-btn')].find(b => b.textContent === 'Flashcards').click(); ${wait(300)}
      const front = document.querySelector('.flashcard').innerText.replace(/\\n+/g, ' / ');
      document.querySelector('.flashcard').click(); ${wait(200)}
      const back = document.querySelector('.flashcard').innerText.replace(/\\n+/g, ' / ');
      [...document.querySelectorAll('.fc-actions .btn')].find(b => b.textContent.includes('Not yet')).click(); ${wait(700)}
      return 'front: ' + front + '\\nback: ' + back + '\\nafter "not yet": ' + document.querySelector('.fc-tools').innerText.replace(/\\n+/g, ' ');`, shot: 'study-5-flashcard'
  },
  {
    name: 'set: test me (log)', eval: `[...document.querySelectorAll('.seg-btn')].find(b => b.textContent === 'Test me').click(); ${wait(300)} return ${flat('.vocab-body .card-title')};`
  },
  {
    name: 'mistakes page', eval: `
      location.hash = '#/mistakes'; ${wait(1200)}
      const a = 'banner: ' + document.querySelector('.never-words')?.innerText.replace(/\\n/g, ' ') + '\\ntabs: ' + ${flat('.mistakes-tabs .seg-btn')} + '\\nrows: ' + document.querySelectorAll('.mistakes-table tbody tr').length;
      [...document.querySelectorAll('.mistakes-tabs .seg-btn')].find(b => b.textContent.startsWith('Spelling')).click(); ${wait(200)}
      return a + '\\nspelling rows: ' + ${flat('.mistakes-table tbody tr td:first-child')};`, shot: 'study-6-mistakes'
  },
  {
    name: 'review: right answer, then a wrong one', eval: `
      document.querySelector('.review-cta .btn-primary').click(); ${wait(400)}
      const q1 = document.querySelector('.rv-prompt').innerText.replace(/\\n/g, ' ');
      ${typeInto('.rv-input', 'experience')} document.querySelector('.rv-card').requestSubmit(); ${wait(700)}
      const v1 = document.querySelector('.rv-card').innerText.replace(/\\n+/g, ' / ');
      document.querySelector('.rv-card .btn-primary').click(); ${wait(300)}
      const q2 = document.querySelector('.rv-prompt').innerText.replace(/\\n/g, ' ');
      ${typeInto('.rv-input', 'goverment')} document.querySelector('.rv-card').requestSubmit(); ${wait(700)}
      return 'clock: ' + document.querySelector('.rv-clock').innerText + '\\nQ1: ' + q1 + ' -> ' + v1 + '\\nQ2: ' + q2 + ' -> ' + document.querySelector('.rv-card').innerText.replace(/\\n+/g, ' / ') + ' | next disabled: ' + document.querySelector('.rv-card .btn-primary').disabled;`, shot: 'study-7-review-wrong'
  },
  {
    name: 'review: 3 practice entries unlock Next; stop', eval: `
      const ins = [...document.querySelectorAll('.rv-practice input')];
      ins.forEach(i => { i.value = 'government'; i.dispatchEvent(new Event('input', { bubbles: true })); }); ${wait(100)}
      const enabled = !document.querySelector('.rv-card .btn-primary').disabled;
      [...document.querySelectorAll('.review-head .btn')].find(b => b.textContent === 'Stop').click(); ${wait(1200)}
      return 'next enabled after 3: ' + enabled + ' | back on the list, waiting: ' + document.querySelector('.review-cta .muted').innerText;`
  },
  { name: 'phone: lesson', viewport: [390, 844], eval: `location.hash = '#/lesson/day23-band-6-7-8'; ${wait(1300)} return 'width ' + document.documentElement.scrollWidth + '/' + innerWidth;`, shot: 'study-8-phone-lesson' },
  { name: 'phone: flashcards', eval: `location.hash = '#/vocab/set-3'; ${wait(1200)} [...document.querySelectorAll('.seg-btn')].find(b => b.textContent === 'Flashcards').click(); ${wait(300)} return 'width ' + document.documentElement.scrollWidth + '/' + innerWidth;`, shot: 'study-9-phone-flashcards' },
  { name: 'phone: mistakes', eval: `location.hash = '#/mistakes'; ${wait(1200)} return 'width ' + document.documentElement.scrollWidth + '/' + innerWidth;`, shot: 'study-10-phone-mistakes' }
];
