// Acceptance check (spec §10), part 2 of 2 — the LAPTOP: log in, resume the phone's attempt, check answers + highlight + clock,
// answer offline and come back online, submit, see the result.
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (sel, text) => `{ const b = [...document.querySelectorAll('${sel}')].find(x => x.offsetParent !== null && ${text ? `x.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!b) return 'NOT FOUND: ${sel} ${text || ''}'; b.click(); }`;
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const attemptId = 'location.hash.split("/")[2]';

module.exports = [
  { name: 'laptop: log in', viewport: [1400, 900], eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  { name: 'laptop: dashboard', eval: `return [...document.querySelectorAll('.dash-section')].map(s => s.querySelector('.section-title').textContent + ': ' + s.querySelectorAll('.test-card, tbody tr').length).join(' | ');`, shot: 'laptop-1-dashboard' },
  {
    name: 'laptop: resume — same answers, highlight, clock still running', eval: `
      ${click('.dash-section .btn-primary', 'Resume')} ${wait(1800)}
      const v = await (await fetch('/api/attempts/' + ${attemptId})).json();
      return JSON.stringify({
        box1: document.querySelector('.drop-zone[data-num="1"]').textContent,
        q6: document.querySelector('input[name="r_q6"]:checked')?.value, q10: document.querySelector('input[name="r_q10"]:checked')?.value,
        q11: document.querySelector('.gap-input[data-num="11"]').value, q17: document.querySelector('.gap-input[data-num="17"]').value,
        highlight: document.querySelector('mark.hl')?.textContent, remainingSec: v.timing.remainingSec, at: new Date().toISOString()
      });`, shot: 'laptop-2-resumed'
  },
  { name: 'laptop: offline, answer Q7', offline: true, eval: `document.querySelector('input[name="r_q7"][value="NOT GIVEN"]').click(); ${wait(2500)} return 'indicator: ' + document.querySelector('.cd-sync').className + ' | buffered: ' + localStorage.getItem('ielts-buffer-' + ${attemptId});`, shot: 'laptop-3-offline' },
  { name: 'laptop: back online', offline: false, eval: `${wait(6500)} const v = await (await fetch('/api/attempts/' + ${attemptId})).json(); return 'indicator: ' + document.querySelector('.cd-sync').className + ' | server q7 = ' + v.attempt.answers.q7;` },
  { name: 'laptop: submit', eval: `${click('.nav-submit')} ${wait(300)} ${click('.modal-actions .btn-primary', 'Submit')} ${wait(1800)} return location.hash.split('/')[1] + ' | ' + document.querySelector('.hero')?.innerText.replace(/\\n+/g, ' · ');`, shot: 'laptop-4-result' }
];
