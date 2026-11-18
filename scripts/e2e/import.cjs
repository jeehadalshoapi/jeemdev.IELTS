// Phase 4 check: the import box (text with mistakes, the listening template with dropped files, JSON from Claude),
// the Tests page (archive / restore) and the phone layout. Needs the database from prepare-db.ts.
const fs = require('fs');
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const LISTENING = fs.readFileSync('templates/listening-template.txt', 'utf8').replace('TITLE: Cambridge 18 — Test 1 Listening', 'TITLE: Imported listening (e2e)');
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const click = (sel, text) => `{ const b = [...document.querySelectorAll('${sel}')].find(x => x.offsetParent !== null && ${text ? `x.textContent.includes(${JSON.stringify(text)})` : 'true'}); if (!b) return 'NOT FOUND: ${sel} ${text || ''}'; b.click(); }`;
const paste = text => `{ const ta = document.querySelector('.import-text'); ta.value = ${JSON.stringify(text)}; ta.dispatchEvent(new Event('input', { bubbles: true })); }`;
const check = `${click('.import-actions .btn', 'Check')} ${wait(1200)}`;
const resultText = `document.querySelector('.import-result').innerText.replace(/\\n+/g, ' ¶ ').slice(0, 900)`;

const BROKEN = [
  'TITLE: Broken drill', 'MODULE: Reading', '',
  '=== PASSAGE 1 ===', 'TEXT:', '[A] Bees like flowers.', '',
  '--- SENTENCE COMPLETION ---', 'INSTRUCTIONS:', 'Write NO MORE THAN TWO WORDS for each answer.', 'TEXT:', 'Bees live near the [[old railway station]].', '',
  '--- MATCHING HEADINGS ---', 'OPTIONS:', 'i. Food', 'ii. Homes', 'QUESTIONS:', '2. Paragraph A | iv'
].join('\n');

module.exports = [
  { name: 'log in', viewport: [1400, 900], eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  { name: 'open the import box', eval: `location.hash = '#/import'; ${wait(800)} return document.querySelector('.tabs a.active')?.textContent + ' | save disabled: ' + document.querySelector('.import-actions .btn-primary').disabled;`, shot: 'import-1-empty' },
  { name: 'text with mistakes', eval: `${paste(BROKEN)} ${check} return ${resultText} + ' | save disabled: ' + document.querySelector('.import-actions .btn-primary').disabled;`, shot: 'import-2-problems' },
  {
    name: 'listening template + dropped files', eval: `
      ${paste(LISTENING)} ${check}
      const missing = document.querySelectorAll('.imp-err .import-issues li').length;
      const png = await new Promise(r => { const c = document.createElement('canvas'); c.width = 120; c.height = 80; const x = c.getContext('2d'); x.fillStyle = '#4a8'; x.fillRect(0, 0, 120, 80); c.toBlob(r, 'image/png'); });
      const dt = new DataTransfer();
      for (const n of ['part1.mp3', 'part2.mp3', 'part3.mp3', 'part4.mp3']) dt.items.add(new File([new Uint8Array([0xff, 0xfb, 0x90, 0x44, 0, 0, 0, 0])], n, { type: 'audio/mpeg' }));
      dt.items.add(new File([png], 'map.png', { type: 'image/png' }));
      document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      ${wait(2000)}
      const files = [...document.querySelectorAll('.import-file')].map(f => f.innerText.replace(/\\s+/g, ' ')).join(' / ');
      ${check}
      return 'missing before: ' + missing + ' | files: ' + files + ' | ' + ${resultText};`, shot: 'import-3-ready'
  },
  { name: 'save', eval: `${click('.import-actions .btn-primary', 'Save')} ${wait(1200)} return ${resultText};`, shot: 'import-4-saved' },
  {
    name: 'start the imported test', eval: `
      ${click('.import-saved-actions a', 'Open the test')} ${wait(900)}
      ${click('.start-actions .btn-primary', 'Start')} ${wait(2000)}
      const img = document.querySelector('img[src^="/files/"]');
      return 'audio bar: ' + !!document.querySelector('.cd-audio') + ' | map image loaded: ' + (img ? img.naturalWidth + 'x' + img.naturalHeight : 'none');`, shot: 'import-5-runner'
  },
  {
    name: 'JSON from Claude, inside a fence', eval: `
      location.hash = '#/import'; ${wait(800)}
      const doc = { title: 'Claude drill (e2e)', skill: 'reading', kind: 'homework', dueDate: '2026-12-24', timeLimitMin: 15,
        parts: [{ id: 'p1', title: 'Passage 1', passage: { title: 'Heat', paragraphs: [{ label: 'A', text: 'Dark roofs absorb heat.' }] },
          questionGroups: [{ id: 'g1', type: 'tfng', questions: [{ id: 'q1', number: 1, text: 'Dark roofs absorb heat.' }] }] }],
        answerKey: { q1: { accept: ['TRUE'] } } };
      const ta = document.querySelector('.import-text'); ta.value = 'Here you go:\\n\`\`\`json\\n' + JSON.stringify(doc, null, 2) + '\\n\`\`\`'; ta.dispatchEvent(new Event('input', { bubbles: true }));
      ${check} ${click('.import-actions .btn-primary', 'Save')} ${wait(1000)}
      return ${resultText};`
  },
  {
    name: 'leaving with unsaved text asks first', eval: `
      ${click('.import-saved-actions .btn', 'Import another')} ${wait(300)}
      ${paste('TITLE: half written')} location.hash = '#/'; ${wait(500)}
      const asked = document.querySelector('.modal')?.innerText.replace(/\\n+/g, ' ');
      ${click('.modal-actions .btn', 'Leave')} ${wait(1000)}
      return 'asked: ' + asked + ' | now on: ' + location.hash;`
  },
  {
    name: 'tests page: archive', eval: `
      location.hash = '#/tests'; ${wait(900)}
      const before = document.querySelectorAll('.tests-table tbody tr').length;
      const row = [...document.querySelectorAll('.tests-table tbody tr')].find(r => r.innerText.includes('Claude drill (e2e)'));
      row.querySelector('.test-action .btn').click(); ${wait(800)}
      const after = document.querySelectorAll('.tests-table tbody tr').length;
      location.hash = '#/'; ${wait(900)}
      const onDash = [...document.querySelectorAll('.test-card h3')].some(h => h.textContent.includes('Claude drill (e2e)'));
      return 'rows ' + before + ' -> ' + after + ' | on dashboard after archive: ' + onDash;`
  },
  {
    name: 'tests page: show archived and restore', eval: `
      location.hash = '#/tests'; ${wait(900)}
      document.getElementById('show-archived').click(); ${wait(300)}
      const row = [...document.querySelectorAll('.tests-table tbody tr')].find(r => r.innerText.includes('Claude drill (e2e)'));
      const state = row.className + ' / ' + row.querySelector('.test-action .btn').textContent;
      return state;`, shot: 'import-6-tests'
  },
  {
    name: 'restore', eval: `
      ${click('.tests-table tr.archived .test-action .btn', 'Restore')} ${wait(800)}
      location.hash = '#/'; ${wait(900)}
      return 'on dashboard after restore: ' + [...document.querySelectorAll('.test-card h3')].some(h => h.textContent.includes('Claude drill (e2e)'));`, shot: 'import-7-dashboard'
  },
  { name: 'phone: import box', viewport: [390, 844], eval: `location.hash = '#/import'; ${wait(700)} ${paste(BROKEN)} ${check} return document.documentElement.scrollWidth + 'px wide';`, shot: 'import-8-phone' },
  { name: 'phone: tests page', viewport: [390, 844], eval: `location.hash = '#/tests'; ${wait(300)} ${click('.modal-actions .btn', 'Leave')} ${wait(900)} return document.documentElement.scrollWidth + 'px wide';`, shot: 'import-9-phone-tests' }
];
