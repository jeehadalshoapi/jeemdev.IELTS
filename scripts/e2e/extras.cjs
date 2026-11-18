// Phase 6 check: Task 1 charts (every type, colour settings), the Task 2 plan + introduction drill timers,
// speaking recordings (fake microphone) with Part 2 timers, and listening read aloud.
// Needs the database from prepare-db.ts (reads .data/e2e/ids.json).
const fs = require('fs');
const IDS = JSON.parse(fs.readFileSync('.data/e2e/ids.json', 'utf8'));
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (sel, text) => `{ const b = [...document.querySelectorAll('${sel}')].find(x => x.offsetParent !== null && ${text ? `x.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!b) return 'NOT FOUND: ${sel} ${text || ''}'; b.click(); }`;
const start = (id, mode = 'practice') => `location.hash = '#/test/${id}'; ${wait(900)} document.querySelector('input[name="mode"][value="${mode}"]').click(); ${click('.start-actions .btn-primary', 'Start')} ${wait(1800)}`;
const showPart = n => `[...document.querySelectorAll('.nav-part-label')][${n}].click(); ${wait(500)}`;
const visible = sel => `[...document.querySelectorAll('.cd-part:not([hidden]) ${sel}')]`;

module.exports = [
  { name: 'log in', viewport: [1400, 900], eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  {
    name: 'charts: line', eval: `${start(IDS.gallery)}
      return 'svg: ' + ${visible('.chart-svg svg')}.length + ' | lines: ' + ${visible('path.line')}.length + ' | dots: ' + ${visible('circle.dot')}.length + ' | end labels: ' + ${visible('text.end-label')}.map(t => t.textContent).join(', ');`,
    shot: 'extras-1-line'
  },
  { name: 'charts: bars', eval: `${showPart(1)} return 'bars: ' + ${visible('path.bar')}.length + ' | legends: ' + ${visible('.chart-legend')}.length;`, shot: 'extras-2-bars' },
  { name: 'charts: pie', eval: `${showPart(2)} return 'slices: ' + ${visible('path.slice')}.length + ' | labels: ' + ${visible('text.slice-label')}.map(t => t.textContent).join(' ');`, shot: 'extras-3-pie' },
  { name: 'charts: process + table', eval: `${showPart(3)} return 'steps: ' + ${visible('.process-step')}.length + ' | table rows: ' + ${visible('.chart-table tr')}.length;`, shot: 'extras-4-process' },
  { name: 'charts: maps', eval: `${showPart(4)} return 'maps: ' + ${visible('.chart-map svg')}.length + ' | labels: ' + ${visible('text.m-label')}.length;`, shot: 'extras-5-maps' },
  {
    name: 'charts: yellow on black', eval: `${showPart(1)} ${click('.cd-icon', 'Settings')} ${wait(300)} document.querySelector('input[name="contrast"][value="yob"]').click(); ${wait(200)} ${click('.modal-actions .btn', 'Done')} ${wait(300)}
      return getComputedStyle(document.querySelector('.cd')).getPropertyValue('--series-1');`, shot: 'extras-6-contrast'
  },
  { name: 'back to black on white', eval: `${click('.cd-icon', 'Settings')} ${wait(300)} document.querySelector('input[name="contrast"][value="default"]').click(); ${click('.modal-actions .btn', 'Done')} return 'ok';` },
  {
    name: 'drill: plan timer runs, introduction opens after Next', eval: `${start(IDS.drill)}
      const clock = () => ${visible('.drill-clock')}.map(c => c.textContent).join(' | ');
      const before = clock(); ${wait(3200)} const after = clock();
      const introLocked = ${visible('.drill-stage')}[1].querySelector('textarea').disabled;
      ${click('.drill-stage .btn-ex', 'Next')} ${wait(400)}
      const introOpen = !${visible('.drill-stage')}[1].querySelector('textarea').disabled;
      return 'clock: ' + before + ' -> ' + after + ' | intro locked before: ' + introLocked + ' | open after Next: ' + introOpen + ' | now: ' + clock();`,
    shot: 'extras-7-drill'
  },
  {
    name: 'speaking Part 1: record, stop, saved', eval: `${start(IDS.speaking)}
      ${click('.rec-start', 'Record')} ${wait(2600)}
      const during = document.querySelector('.rec.recording .rec-status')?.textContent;
      ${click('.rec-stop', 'Stop')} ${wait(2500)}
      const saved = document.querySelector('.rec-player audio')?.getAttribute('src');
      return 'during: ' + during + ' | after: ' + document.querySelector('.rec-status').textContent + ' | player: ' + saved;`,
    shot: 'extras-8-speaking-p1'
  },
  {
    name: 'speaking Part 2: preparation, then the talk records itself', eval: `${showPart(1)}
      ${click('.lt-bar .btn-ex', 'preparation')} ${wait(2200)}
      const prep = document.querySelector('.cd-part:not([hidden]) .lt-clock').textContent;
      ${click('.lt-bar .btn-ex', 'start talking')} ${wait(2600)}
      const talk = document.querySelector('.cd-part:not([hidden]) .lt-clock').textContent + ' / ' + document.querySelector('.cd-part:not([hidden]) .long-turn .rec-status').textContent;
      ${click('.lt-bar .btn-ex', 'Stop talking')} ${wait(2500)}
      return 'prep: ' + prep + ' | talk: ' + talk + ' | after: ' + document.querySelector('.cd-part:not([hidden]) .lt-clock').textContent + ' | player: ' + !!document.querySelector('.cd-part:not([hidden]) .long-turn .rec-player audio');`,
    shot: 'extras-9-speaking-p2'
  },
  {
    name: 'speaking: submit, recordings on the results page', eval: `
      const ta = document.querySelector('.cd-part:not([hidden]) .long-turn .sp-notes'); ta.value = 'park notes'; ta.dispatchEvent(new Event('input', { bubbles: true })); ${wait(2000)}
      ${click('.nav-submit')} ${wait(300)} ${click('.modal-actions .btn-primary', 'Submit')} ${wait(2500)}
      return 'audio players: ' + document.querySelectorAll('.rec-result audio').length + ' | question shown: ' + !!document.querySelector('.sp-question');`,
    shot: 'extras-10-result'
  },
  {
    name: 'listening read aloud (exam mode)', eval: `${start(IDS.listening, 'exam')}
      const before = document.querySelector('.tts .tts-status').textContent;
      ${click('.tts .btn-ex', 'Start listening')} ${wait(1500)}
      const during = document.querySelector('.tts .tts-status').textContent;
      const shown = document.body.innerText.includes('Narrator:');
      return 'before: ' + before + ' | after Start: ' + during + ' | transcript visible on the page: ' + shown + ' | voices: ' + speechSynthesis.getVoices().length;`,
    shot: 'extras-11-listening'
  },
  { name: 'leave the exam (it asks first)', eval: `location.hash = '#/'; ${wait(500)} const asked = !!document.querySelector('.modal'); ${click('.modal-actions .btn', 'Leave')} ${wait(1000)} return 'asked: ' + asked + ' | now: ' + location.hash;` },
  { name: 'phone: speaking', viewport: [390, 844], eval: `${start(IDS.speaking)} return document.documentElement.scrollWidth + 'px wide';`, shot: 'extras-12-phone-speaking' },
  { name: 'phone: chart', viewport: [390, 844], eval: `location.hash = '#/test/${IDS.gallery}'; ${wait(900)} ${click('.start-actions .btn-primary', 'Resume')} ${wait(1800)} ${showPart(0)} [...document.querySelectorAll('.cd-tab')].find(t => t.offsetParent && t.textContent.includes('Task'))?.click(); ${wait(400)} return document.documentElement.scrollWidth + 'px wide';`, shot: 'extras-13-phone-chart' }
];
