// Phase 9 check: "Test me" quiz (word -> meaning / opposite) logged in the set, the Task 2 plan box,
// sentence rewrite boxes and their results table, the study-block log. Needs the database from prepare-db.ts.
const fs = require('fs');
const IDS = JSON.parse(fs.readFileSync('.data/e2e/ids.json', 'utf8'));
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (sel, text) => `{ const b = [...document.querySelectorAll('${sel}')].find(x => x.offsetParent !== null && ${text ? `x.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!b) return 'NOT FOUND: ${sel} ${text || ''}'; b.click(); }`;
const submit = `${click('.nav-submit')} ${wait(300)} ${click('.modal-actions .btn-primary', 'Submit')} ${wait(2000)}`;
const typeTa = (sel, i, v) => `{ const t = [...document.querySelectorAll('${sel}')].filter(x => x.offsetParent !== null)[${i}]; t.value = ${JSON.stringify(v)}; t.dispatchEvent(new Event('input', { bubbles: true })); }`;

module.exports = [
  { name: 'log in', viewport: [1400, 900], eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  {
    name: 'Test me makes a quiz', eval: `
      location.hash = '#/vocab/set-3'; ${wait(1200)}
      ${click('.seg-btn', 'Test me')} ${wait(300)} ${click('.btn-primary', 'Make a quiz')} ${wait(1500)}
      const start = document.querySelector('.page').innerText.replace(/\\s*\\n\\s*/g, ' | ').slice(0, 200);
      ${click('.start-actions .btn-primary', 'Start')} ${wait(1800)}
      return 'start page: ' + start + '\\nquestions: ' + document.querySelectorAll('.drop-zone').length + ' | options: ' + [...document.querySelectorAll('.chip-opt')].map(c => c.innerText.replace(/\\n/g, ' ')).slice(0, 6).join(' / ');`, shot: 'format9-1-quiz'
  },
  {
    name: 'answer the meanings (all of them A), submit', eval: `
      const zones = [...document.querySelectorAll('.drop-zone')].filter(z => z.offsetParent !== null);
      for (const z of zones) { const bank = z.closest('.q-group'); const chip = bank.querySelector('.chip-opt'); chip.click(); z.click(); ${wait(80)} }
      ${wait(1500)} ${submit}
      return document.querySelector('.hero').innerText.replace(/\\n+/g, ' · ');`, shot: 'format9-2-quiz-result'
  },
  {
    name: 'the set shows the result', eval: `
      location.hash = '#/vocab/set-3'; ${wait(1200)}
      const legend = document.querySelector('.status-legend').innerText.replace(/\\n/g, ' ');
      ${click('.seg-btn', 'Test me')} ${wait(300)}
      return 'statuses: ' + legend + '\\nlog: ' + [...document.querySelectorAll('.vocab-body tbody tr')].map(r => r.innerText.replace(/\\s*\\n\\s*|\\t/g, ' | ')).join(' || ');`
  },
  {
    name: 'writing homework: plan box + essay', eval: `
      location.hash = '#/test/${IDS.writing9}'; ${wait(1000)} ${click('.start-actions .btn-primary', 'Start')} ${wait(1800)}
      const plan = document.querySelector('.plan-box');
      ${typeTa('.w-plan', 0, 'Position: parks. Body 1 health. Body 2 air.')}
      ${typeTa('.w-text:not(.w-plan)', 0, 'Nowadays many people think that parks are more important than roads.')}
      ${wait(400)}
      return 'plan box open: ' + plan.open + ' | summary: ' + plan.querySelector('summary').innerText;`, shot: 'format9-3-plan'
  },
  {
    name: 'sentence rewrite: one box per sentence', eval: `
      ${click('.nav-part-label', 'Repair')} ${wait(600)}
      const items = [...document.querySelectorAll('.rw-item')].filter(x => x.offsetParent !== null);
      ${typeTa('.rw-item textarea', 0, 'Many graduates cannot find a job because they lack experience.')}
      ${typeTa('.rw-item textarea', 1, 'The government should invest more in public transport.')}
      ${wait(1500)}
      return 'boxes: ' + items.length + ' | left list: ' + [...document.querySelectorAll('.rw-list li')].length;`, shot: 'format9-4-rewrite'
  },
  { name: 'stay a little (study block)', eval: `${wait(32000)} return 'ok';` },
  {
    name: 'submit; results: rewrite table, plan, study blocks', eval: `
      ${submit}
      const rows = [...document.querySelectorAll('.rewrite-table tbody tr')].map(r => r.innerText.replace(/\\s*\\n\\s*|\\t/g, ' | '));
      const plan = [...document.querySelectorAll('summary')].some(s => s.textContent === 'Your plan');
      return 'rewrite rows: ' + rows.join(' || ') + '\\nplan shown: ' + plan + '\\nblocks: ' + (document.querySelector('.blocks-card summary')?.innerText ?? 'none');`, shot: 'format9-5-results'
  },
  { name: 'phone: rewrite in the runner', viewport: [390, 844], eval: `location.hash = '#/test/${IDS.writing9}'; ${wait(1000)} ${click('.start-actions .btn-primary', 'Start')} ${wait(1800)} ${click('.nav-part-label', 'Repair')} ${wait(400)} ${click('.cd-tab', 'answer')} ${wait(300)} return 'width ' + document.documentElement.scrollWidth + '/' + innerWidth;`, shot: 'format9-6-phone-rewrite' }
];
