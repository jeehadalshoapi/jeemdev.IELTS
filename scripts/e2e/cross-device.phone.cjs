// Acceptance check (spec §10), part 1 of 2 — the PHONE: start the sample in exam mode, highlight, answer 5 questions, close.
// Then run cross-device.laptop.cjs (a different browser profile = a different device).
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (sel, text) => `{ const b = [...document.querySelectorAll('${sel}')].find(x => x.offsetParent !== null && ${text ? `x.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!b) return 'NOT FOUND: ${sel} ${text || ''}'; b.click(); }`;
const SAMPLE = '5a3f6c1e-0000-4000-8000-000000000001';
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';

module.exports = [
  { name: 'phone: not logged in', viewport: [390, 844], eval: `return location.pathname + ' — ' + document.title`, shot: 'phone-1-login', wait: 300 },
  { name: 'phone: log in', eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  { name: 'phone: dashboard', eval: `return location.pathname + ' | test cards: ' + document.querySelectorAll('.test-card').length;`, shot: 'phone-2-dashboard' },
  {
    name: 'phone: start in exam mode', eval: `
      location.hash = '#/test/${SAMPLE}'; ${wait(900)}
      document.querySelector('input[name=mode][value=exam]').click();
      ${click('.start-actions .btn-primary', 'Start')} ${wait(1500)}
      return document.querySelector('.cd-timer').textContent + ' | tabs visible: ' + (document.querySelector('.cd-part:not([hidden]) .cd-tabs').offsetParent !== null);`, shot: 'phone-3-passage'
  },
  {
    name: 'phone: highlight passage text', eval: `
      const p = document.querySelector('.cd-part:not([hidden]) .psg-body p');
      const r = document.createRange(); r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 31);
      getSelection().removeAllRanges(); getSelection().addRange(r);
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); ${wait(80)}
      ${click('.hl-menu button', 'Highlight')}
      return 'marks: ' + document.querySelectorAll('mark.hl').length;`, wait: 300
  },
  {
    name: 'phone: answer 5 questions', eval: `
      ${click('.cd-part:not([hidden]) .cd-tab', 'Questions')} ${wait(200)}
      document.querySelector('.chip-opt[data-label="iii"]').click(); document.querySelector('.drop-zone[data-num="1"]').click();
      document.querySelector('input[name="r_q6"][value="TRUE"]').click();
      document.querySelector('input[name="r_q10"][value="B"]').click();
      const t = (n, v) => { const i = document.querySelector('.gap-input[data-num="' + n + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
      t(11, 'register'); t(17, 'colony collapse disorder'); ${wait(2500)}
      return 'save indicator: ' + document.querySelector('.cd-sync').className + ' | answered in nav: ' + document.querySelectorAll('.nav-q.answered').length;`, shot: 'phone-4-questions'
  },
  {
    name: 'phone: what the server has (compare remainingSec with the laptop run)', eval: `
      const v = await (await fetch('/api/attempts/' + location.hash.split('/')[2])).json();
      return JSON.stringify({ answers: v.attempt.answers, stateKeys: Object.keys(v.attempt.state), remainingSec: v.timing.remainingSec, at: new Date().toISOString() });`
  }
];
