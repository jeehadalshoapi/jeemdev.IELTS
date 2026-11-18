// Phase 7 check: Claude's feedback on the results page (criteria, mistakes linked to answers, corrected essay)
// and the progress charts on History (tooltips, keyboard, filters, phone layout).
// Needs the database from prepare-db.ts (reads .data/e2e/ids.json).
const fs = require('fs');
const IDS = JSON.parse(fs.readFileSync('.data/e2e/ids.json', 'utf8'));
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const text = sel => `(document.querySelector('${sel}')?.innerText ?? 'MISSING ${sel}').replace(/\\s*\\n\\s*/g, ' | ')`;
// moves the pointer over a chart at a fraction of its width and returns the tooltip
const hover = (sel, fraction) => `(() => { const c = document.querySelector('${sel}'); const r = c.getBoundingClientRect();
  c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width * ${fraction}, clientY: r.top + 40, pointerType: 'mouse' }));
  const t = c.querySelector('.lc-tip'); return t.hidden ? 'tooltip hidden' : t.innerText.replace(/\\n+/g, ' / '); })()`;

module.exports = [
  { name: 'log in', viewport: [1400, 900], eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  {
    name: 'reading result: feedback card', eval: `
      location.hash = '#/result/${IDS.readingMarked}'; ${wait(1500)}
      const card = document.querySelector('.feedback-card.has-feedback');
      const order = [...document.querySelectorAll('.page > *')].map(x => x.className.split(' ')[0]).join(' > ');
      return 'order: ' + order + '\\nhead: ' + ${text('.feedback-card .card-head')} + '\\nmistakes: ' + [...card.querySelectorAll('.fb-mistake')].map(m => m.innerText.replace(/\\s*\\n\\s*/g, ' ')).join(' || ')
        + '\\nsteps: ' + card.querySelectorAll('.fb-steps li').length + ' | extras: ' + ${text('.fb-extras')}
        + '\\nrows with notes: ' + [...document.querySelectorAll('tr.has-note')].map(r => r.id).join(', ');`, shot: 'feedback-1-reading'
  },
  {
    name: 'jump from a mistake to its answer row', eval: `
      [...document.querySelectorAll('.fb-ref')].find(b => b.textContent === 'Q17').click(); ${wait(900)}
      const row = document.getElementById('ans-q17');
      const r = row.getBoundingClientRect();
      return 'flash: ' + row.classList.contains('flash') + ' | in view: ' + (r.top >= 0 && r.bottom <= innerHeight) + ' | note: ' + row.querySelector('.claude-note')?.innerText;`, shot: 'feedback-2-jump'
  },
  {
    name: 'writing result: criteria, corrected essay, notes', eval: `
      location.hash = '#/result/${IDS.writingMarked}'; ${wait(1500)}
      const crit = [...document.querySelectorAll('.crit-row')].map(r => r.innerText.replace(/\\s*\\n\\s*/g, ' ')).join(' / ');
      const dels = [...document.querySelectorAll('.cmp-yours del')].map(x => x.textContent).join(' ¦ ');
      const ins = [...document.querySelectorAll('.cmp-fixed ins')].map(x => x.textContent).join(' ¦ ');
      return 'hero: ' + ${text('.hero-band')} + '\\ncriteria: ' + crit + '\\nlegend: ' + ${text('.cmp-legend')} + '\\nremoved: ' + dels + '\\nadded: ' + ins
        + '\\nitem notes: ' + document.querySelectorAll('.item-card .item-notes .fb-mistake').length + ' | feedback card links: ' + ${text('.fb-item-link')}
        + '\\nhint hidden: ' + !document.body.innerText.includes('Claude marks writing and speaking');`, shot: 'feedback-3-writing'
  },
  { name: 'writing result: the essay comparison', eval: `document.querySelector('.compare').scrollIntoView({ block: 'center' }); ${wait(400)} return 'ok';`, shot: 'feedback-4-compare' },
  {
    name: 'unmarked result says how to get feedback', eval: `
      location.hash = '#/history'; ${wait(1200)}
      const row = [...document.querySelectorAll('.table tr.clickable')].find(r => !r.innerText.includes('Feedback') && r.innerText.includes('Hotel'));
      row.click(); ${wait(1300)}
      return ${text('.feedback-card')};`
  },
  {
    name: 'history: charts, tooltips, mistakes', eval: `
      location.hash = '#/history'; ${wait(1500)}
      const cards = [...document.querySelectorAll('.skill-card')].map(c => c.querySelector('.badge').innerText + ': ' + c.querySelectorAll('.lc-dot').length + ' dots, end ' + (c.querySelector('.lc-end')?.textContent ?? '-'));
      return 'skills: ' + cards.join(' / ')
        + '\\nreading tooltip (left): ' + ${hover('.skill-card.mod-reading .lc', 0.02)}
        + '\\nreading tooltip (right): ' + ${hover('.skill-card.mod-reading .lc', 0.98)}
        + '\\ntype cards: ' + [...document.querySelectorAll('.type-card .type-head')].map(t => t.innerText.replace(/\\n/g, ' ')).join(' / ')
        + '\\nreasons: ' + [...document.querySelectorAll('.mistakes-grid .card')].map(c => [...c.querySelectorAll('.rank-row')].map(r => r.innerText.replace(/\\s*\\n\\s*/g, ' ')).join(', ')).join(' || ');`, shot: 'feedback-5-history'
  },
  {
    name: 'history: keyboard on a chart', eval: `
      const c = document.querySelector('.skill-card.mod-writing .lc'); c.focus(); ${wait(100)}
      const a = c.querySelector('.lc-tip').innerText.replace(/\\n+/g, ' / ');
      c.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); ${wait(100)}
      const b = c.querySelector('.lc-tip').innerText.replace(/\\n+/g, ' / ');
      c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); ${wait(100)}
      return 'focus: ' + a + '\\n← : ' + b + '\\nHome: ' + c.querySelector('.lc-tip').innerText.replace(/\\n+/g, ' / ');`
  },
  {
    name: 'history: filters (skill, then period)', eval: `
      [...document.querySelectorAll('.filter .seg-btn')].find(b => b.textContent === 'Reading').click(); ${wait(1200)}
      const a = location.hash + ' | skills: ' + [...document.querySelectorAll('.skill-card .badge')].map(b => b.innerText).join(',') + ' | types: ' + document.querySelectorAll('.type-card').length + ' | attempts: ' + ${text('.dash-section:last-child .section-title')};
      [...document.querySelectorAll('.filter .seg-btn')].find(b => b.textContent === '7 days').click(); ${wait(1200)}
      const b = location.hash + ' | reading dots: ' + document.querySelectorAll('.skill-card .lc-dot').length + ' | attempts: ' + ${text('.dash-section:last-child .section-title')};
      return a + '\\n' + b;`, shot: 'feedback-6-filtered'
  },
  {
    name: 'history: filter kept after reload', eval: `location.reload(); ${wait(10)} return 'reloading';`, wait: 2000
  },
  { name: 'after reload', eval: `return location.hash + ' | on: ' + [...document.querySelectorAll('.seg-btn.on')].map(b => b.textContent).join(', ');` },
  { name: 'phone: history', viewport: [390, 844], eval: `location.hash = '#/history'; ${wait(300)} [...document.querySelectorAll('.filter .seg-btn')].find(b => b.textContent === 'All time').click(); [...document.querySelectorAll('.filter .seg-btn')].find(b => b.textContent === 'All').click(); ${wait(1500)} return 'page width ' + document.documentElement.scrollWidth + ' / ' + innerWidth;`, shot: 'feedback-7-phone-history' },
  { name: 'phone: history types', eval: `document.querySelector('.type-grid').scrollIntoView(); ${wait(400)} return 'ok';`, shot: 'feedback-8-phone-types' },
  { name: 'phone: writing result', eval: `location.hash = '#/result/${IDS.writingMarked}'; ${wait(1500)} return 'page width ' + document.documentElement.scrollWidth + ' / ' + innerWidth;`, shot: 'feedback-9-phone-writing' },
  { name: 'phone: corrected essay', eval: `document.querySelector('.compare').scrollIntoView(); ${wait(400)} return 'ok';`, shot: 'feedback-10-phone-compare' }
];
