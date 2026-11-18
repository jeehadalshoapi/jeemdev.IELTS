// Phase 10 check: the dashboard's Today card (blocks, pending, ticking), the plan page, a listening map drawn from
// data, an uploaded SVG diagram, the read-aloud reading time with its silence and Skip (practice). Fresh DB needed.
const fs = require('fs');
const IDS = JSON.parse(fs.readFileSync('.data/e2e/ids.json', 'utf8'));
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (sel, text) => `{ const b = [...document.querySelectorAll('${sel}')].find(x => x.offsetParent !== null && ${text ? `x.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!b) return 'NOT FOUND: ${sel} ${text || ''}'; b.click(); }`;

module.exports = [
  { name: 'log in', viewport: [1400, 900], eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  {
    name: 'dashboard: Today card', eval: `
      ${wait(500)}
      const c = document.querySelector('.today-card');
      return 'head: ' + c.querySelector('.card-head').innerText.replace(/\\n+/g, ' | ') + '\\nblocks: ' + [...c.querySelectorAll(':scope > .plan-blocks .plan-block')].map(b => b.innerText.replace(/\\s*\\n\\s*/g, ' ')).join(' || ')
        + '\\npending: ' + [...c.querySelectorAll('.pending .plan-block')].map(b => b.innerText.replace(/\\s*\\n\\s*/g, ' ')).join(' || ');`, shot: 'plan10-1-today'
  },
  {
    name: 'tick a block', eval: `
      document.querySelector('.today-card > .plan-blocks .plan-block input').click(); ${wait(800)}
      return document.querySelector('.today-card .card-head').innerText.replace(/\\n+/g, ' | ');`
  },
  { name: 'plan page', eval: `${click('.today-card a', 'Whole plan')} ${wait(1200)} return [...document.querySelectorAll('.plan-day')].map(d => d.className.replace('card plan-day', '').trim() + ': ' + d.querySelector('.card-head').innerText.replace(/\\n+/g, ' ')).join(' || ');`, shot: 'plan10-2-plan' },
  {
    name: 'listening: map from data, SVG diagram, reading time', eval: `
      location.hash = '#/test/${IDS.map}'; ${wait(1000)} ${click('.start-actions .btn-primary', 'Start')} ${wait(1800)}
      const map = document.querySelector('.chart-maps svg');
      const img = document.querySelector('img.q-img');
      ${click('.tts .btn-ex-primary')} ${wait(1500)}
      const s1 = document.querySelector('.tts-status').innerText + ' | skip shown: ' + !document.querySelector('.tts-controls .btn-ex[title="Skip the silence"]').hidden;
      return 'map drawn: ' + !!map + ' (' + [...document.querySelectorAll('.chart-maps text')].map(t => t.textContent).join(', ') + ')\\nsvg image: ' + (img ? img.getAttribute('src') + ' loaded ' + (img.naturalWidth > 0) : 'none') + '\\nafter the intro: ' + s1;`, shot: 'plan10-3-map'
  },
  {
    name: 'skip the silence', eval: `
      ${click('.tts-controls .btn-ex', 'Skip')} ${wait(800)}
      return document.querySelector('.tts-status').innerText;`
  },
  {
    name: 'answer + submit ticks the plan block', eval: `
      document.querySelector('.chip-opt[data-label="A"]').click(); document.querySelector('.drop-zone[data-num="1"]').click(); ${wait(1200)}
      ${click('.nav-submit')} ${wait(300)} ${click('.modal-actions .btn-primary', 'Submit')} ${wait(2000)}
      location.hash = '#/'; ${wait(1500)}
      return document.querySelector('.today-card .card-head').innerText.replace(/\\n+/g, ' | ') + '\\n' + [...document.querySelectorAll('.today-card > .plan-blocks .plan-block')].map(b => b.className.replace('plan-block ', '') + ' ' + b.querySelector('b').innerText).join(' || ');`, shot: 'plan10-4-ticked'
  },
  { name: 'phone: today', viewport: [390, 844], eval: `location.reload(); ${wait(10)} return 'reload';`, wait: 2500 },
  { name: 'phone: shot', eval: `return 'width ' + document.documentElement.scrollWidth + '/' + innerWidth;`, shot: 'plan10-5-phone' }
];
