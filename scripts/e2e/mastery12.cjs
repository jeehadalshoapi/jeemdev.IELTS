// Phase 12 check: the dashboard keeps only what is to do (finished tests are on #/done), discarding an attempt,
// the Mastery card and page, plan sections, the dictation player (2 plays, words not on the page). Fresh DB needed.
const fs = require('fs');
const IDS = JSON.parse(fs.readFileSync('.data/e2e/ids.json', 'utf8'));
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (sel, text) => `{ const b = [...document.querySelectorAll('${sel}')].find(x => x.offsetParent !== null && ${text ? `x.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!b) return 'NOT FOUND: ${sel} ${text || ''}'; b.click(); }`;
const submit = `${click('.nav-submit')} ${wait(300)} ${click('.modal-actions .btn-primary', 'Submit')} ${wait(2000)}`;
const flat = s => `${s}.replace(/\\s*\\n\\s*/g, ' ')`;

module.exports = [
  { name: 'log in', viewport: [1400, 900], eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  {
    name: 'dashboard: to do only, mastery card', eval: `
      ${wait(600)}
      const sections = [...document.querySelectorAll('.dash-section')].map(s => s.querySelector('.section-title').textContent + ': ' + [...s.querySelectorAll('.test-card h3, li')].map(h => h.textContent.trim()).join(' / '));
      const rows = [...document.querySelectorAll('.mastery-card .m-row')].map(r => ${flat('r.innerText')});
      const stats = [...document.querySelectorAll('.stat')].map(s => ${flat('s.innerText')});
      const sampleOnDash = [...document.querySelectorAll('.dash-section .test-card')].some(c => c.dataset.testId === '${IDS.sample}');
      const w1 = document.querySelector('.test-card[data-test-id="${IDS.w1Drill}"] .badge-mastery');
      return 'stats: ' + stats.join(' | ') + '\\nmastery: ' + rows.join(' || ') + '\\n' + sections.join('\\n') + '\\nsample reading (finished) on dashboard: ' + sampleOnDash + '\\nW1 pill: ' + (w1 ? w1.textContent : 'none') + '\\nwidth ' + document.documentElement.scrollWidth + '/' + innerWidth;`, shot: 'mastery12-1-dashboard'
  },
  {
    name: 'discard the attempt started by mistake', eval: `
      ${click(`.test-card[data-attempt-id="${IDS.abandonedAttempt}"] .btn-discard`)} ${wait(400)}
      const msg = document.querySelector('.modal-body').innerText;
      ${click('.modal-actions .btn-danger', 'Discard')} ${wait(1200)}
      return 'dialog: ' + ${flat('msg')} + '\\ncard still there: ' + !!document.querySelector('.test-card[data-attempt-id="${IDS.abandonedAttempt}"]') + ' | toast: ' + (document.querySelector('.toast')?.textContent ?? '-')
        + '\\nthe test is back in To do: ' + !!document.querySelector('.test-card[data-test-id="${IDS.abandoned}"]') + ' | sections: ' + [...document.querySelectorAll('.dash-section .section-title')].map(x => x.textContent).join(', ');`, shot: 'mastery12-2-discarded'
  },
  { name: 'server agrees', eval: `const r = await fetch('/api/attempts/${IDS.abandonedAttempt}'); return 'GET discarded attempt: ' + r.status;` },
  {
    name: 'Done page: tests and results', eval: `
      ${click('.tabs a', 'Done')} ${wait(1200)}
      const tests = [...document.querySelectorAll('.test-card h3')].map(h => h.textContent);
      const last = document.querySelector('.test-card .test-last')?.innerText;
      return 'tab active: ' + document.querySelector('.tabs a.active')?.textContent + '\\nfilters: ' + ${flat("document.querySelector('.filter-row').innerText")} + '\\ntests: ' + tests.join(' / ') + '\\nfirst card: ' + last;`, shot: 'mastery12-3-done'
  },
  {
    name: 'Done page: results view, skill filter', eval: `
      ${click('.seg-btn', 'Results')} ${wait(300)}
      const all = document.querySelectorAll('tbody tr').length;
      ${click('.seg-btn', 'Writing')} ${wait(300)}
      return 'url ' + location.hash + ' | results: ' + all + ', writing only: ' + document.querySelectorAll('tbody tr').length;`, shot: 'mastery12-4-results'
  },
  {
    name: 'Mastery page', eval: `
      ${click('.tabs a', 'Mastery')} ${wait(1200)}
      return [...document.querySelectorAll('.card[data-ladder]')].map(c => c.querySelector('.card-head').innerText.replace(/\\n+/g, ' ') + ': ' + [...c.querySelectorAll('.m-step')].map(s => s.className.replace('m-step ', '') + ' ' + ${flat("s.querySelector('.m-step-head').innerText")} + (s.querySelector('.m-attempts') ? ' [' + s.querySelector('.m-attempts').innerText + ']' : '')).join(' | ')).join('\\n');`, shot: 'mastery12-5-mastery'
  },
  {
    name: 'plan page: sections', eval: `
      location.hash = '#/plan'; ${wait(1200)}
      const day = document.getElementById('day-26');
      return [...day.querySelectorAll('.plan-section')].map(s => ${flat('s.innerText')}).join(' || ');`, shot: 'mastery12-6-plan'
  },
  {
    name: 'dictation: play twice, then no plays left; the words are not on the page', eval: `
      location.hash = '#/test/${IDS.dictation}'; ${wait(1000)} ${click('.start-actions .btn-primary', 'Start')} ${wait(1800)}
      const before = document.querySelector('.q-dict .dict-left').textContent;
      ${click('.q-dict[data-qid="d1"] .dict-play')} ${wait(300)}
      const playing = document.querySelector('.q-dict[data-qid="d1"] .dict-play').textContent + ' / ' + document.querySelector('.q-dict[data-qid="d1"] .dict-left').textContent;
      ${wait(9000)}
      ${click('.q-dict[data-qid="d1"] .dict-play')} ${wait(9500)}
      const btn = document.querySelector('.q-dict[data-qid="d1"] .dict-play');
      const html = document.getElementById('app').innerHTML;
      return 'before: ' + before + ' | while playing: ' + playing + ' | after 2: ' + btn.textContent + ' disabled ' + btn.disabled + ' / ' + document.querySelector('.q-dict[data-qid="d1"] .dict-left').textContent
        + '\\nword on page: ' + /experience|environment|graduates/.test(html) + ' | speaking: ' + speechSynthesis.speaking;`, shot: 'mastery12-7-dictation', timeout: 40000
  },
  {
    name: 'dictation: type and submit; the step counts it', eval: `
      const put = (id, v) => { const i = document.querySelector('input[data-qid="' + id + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
      put('d1', 'experience'); put('d2', 'government'); put('d3', 'environment'); ${wait(1500)}
      ${submit}
      return location.hash + ' | ' + ${flat("(document.querySelector('.result-hero, .hero')?.innerText ?? '').slice(0, 120)")};`, shot: 'mastery12-8-result'
  },
  {
    name: 'mastery after the dictation', eval: `
      location.hash = '#/'; ${wait(1500)}
      return [...document.querySelectorAll('.mastery-card .m-row')].map(r => ${flat('r.innerText')}).join(' || ');`
  },
  {
    name: 'phone: dashboard and mastery page', viewport: [390, 844], eval: `
      location.hash = '#/'; ${wait(1200)}
      const w1 = document.documentElement.scrollWidth;
      location.hash = '#/mastery'; ${wait(1000)}
      return 'dashboard width ' + w1 + '/' + innerWidth + ' | mastery width ' + document.documentElement.scrollWidth + '/' + innerWidth;`, shot: 'mastery12-9-phone'
  },
  { name: 'phone: dashboard shot', eval: `location.hash = '#/'; ${wait(1200)} window.scrollTo(0, 0); return 'ok';`, shot: 'mastery12-10-phone-dash' }
];
