// Phase 3 check: typical mistakes are scored with the right reasons; review mode; listening transcript after submission;
// writing result; history. Needs the database from prepare-db.ts (reads .data/e2e/ids.json).
const fs = require('fs');
const IDS = JSON.parse(fs.readFileSync('.data/e2e/ids.json', 'utf8'));
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (sel, text) => `{ const b = [...document.querySelectorAll('${sel}')].find(x => x.offsetParent !== null && ${text ? `x.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!b) return 'NOT FOUND: ${sel} ${text || ''}'; b.click(); }`;
const type = (n, v) => `{ const i = document.querySelector('.gap-input[data-num="${n}"]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); }`;
const startTest = id => `location.hash = '#/test/${id}'; ${wait(900)} ${click('.start-actions .btn-primary', 'Start')} ${wait(1500)}`;
const submit = `${click('.nav-submit')} ${wait(300)} ${click('.modal-actions .btn-primary', 'Submit')} ${wait(1800)}`;
const rowsText = `[...document.querySelectorAll('.table.answers tbody tr')].map(r => r.innerText.replace(/\\s*\\n\\s*|\\t/g, ' | '))`;

module.exports = [
  { name: 'log in', viewport: [1400, 900], eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  {
    name: 'reading with typical mistakes', eval: `
      ${startTest(IDS.sample)}
      document.querySelector('.chip-opt[data-label="iii"]').click(); document.querySelector('.drop-zone[data-num="1"]').click();
      document.querySelector('input[name="r_q6"][value="TRUE"]').click();
      document.querySelector('input[name="r_q7"][value="FALSE"]').click();
      document.querySelector('input[name="r_q10"][value="B"]').click();
      ${type(11, 'Register.')} ${type(12, 'permits')} ${type(17, 'the colony collapse disorder')}
      [...document.querySelectorAll('[data-qid="q15"] input')].filter(x => ['A', 'E'].includes(x.value)).forEach(x => x.click());
      ${wait(1500)} ${submit}
      return document.querySelector('.hero').innerText.replace(/\\n+/g, ' · ') + '\\n' + ${rowsText}.filter(x => /^(7|12|15|16|17) /.test(x)).join('\\n');`, shot: 'results-1-reading'
  },
  {
    name: 'review in the test', eval: `
      ${click('a.btn', 'Review in the test')} ${wait(1500)}
      return 'nav ok/bad: ' + document.querySelectorAll('.nav-q.rv-ok').length + '/' + document.querySelectorAll('.nav-q.rv-bad').length + ' | inputs disabled: ' + [...document.querySelectorAll('.gap-input')].every(i => i.disabled) + ' | q17: ' + document.querySelector('[data-qid="q17"] .rv-key')?.textContent;`, shot: 'results-2-review'
  },
  {
    name: 'listening: transcript only after submission', eval: `
      ${startTest(IDS.listening)}
      const before = document.body.innerText.includes('Narrator');
      ${type(1, 'Mitchel')} ${type(2, '07700 900123')} ${wait(1200)} ${submit}
      return 'transcript before: ' + before + ' | after: ' + !!document.querySelector('.transcript-card') + ' | ' + ${rowsText}[0];`, shot: 'results-3-listening'
  },
  {
    name: 'writing', eval: `
      ${startTest(IDS.writing)}
      const ta = document.querySelector('.cd-part:not([hidden]) .w-text');
      ta.value = 'The bar chart compares the average summer temperature in three cities in 1990 and 2020.'; ta.dispatchEvent(new Event('input', { bubbles: true }));
      ${wait(1200)} ${submit}
      return document.querySelector('.hero').innerText.replace(/\\n+/g, ' · ');`, shot: 'results-4-writing'
  },
  { name: 'history', eval: `location.hash = '#/history'; ${wait(1200)} return [...document.querySelectorAll('.skill-card')].map(c => c.innerText.replace(/\\n+/g, ' ')).join(' || ');`, shot: 'results-5-history' },
  { name: 'phone: history', viewport: [390, 844], eval: `return 'ok';`, shot: 'results-6-phone-history' }
];
