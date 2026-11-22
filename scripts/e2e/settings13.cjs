// Phase 13 check: the Settings page (username + password), the login page's Username box, phone layout.
// Ends by removing the username. The new password lasts until the server restarts: the development password
// is hashed afresh on every start, which counts as a new server password and replaces the one set on the site.
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const NEW = 'my new longer password';
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const set = (sel, v) => `{ const i = document.querySelector('${sel}'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); }`;
const msgOf = form => `(document.querySelector('#${form} .settings-msg:not([hidden])')?.textContent ?? '(no message)')`;

module.exports = [
  {
    name: 'login page: no Username box yet', viewport: [1400, 900], eval: `
      ${wait(500)}
      return 'username box hidden: ' + document.getElementById('username-field').hidden;`
  },
  { name: 'log in', eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  {
    name: 'open Settings from the header', eval: `
      [...document.querySelectorAll('.header-actions a')].find(a => a.textContent.includes('Settings')).click(); ${wait(1000)}
      return 'url ' + location.hash + '\\n' + [...document.querySelectorAll('.settings-page .card')].map(c => c.querySelector('.card-title').textContent + ': ' + c.querySelector('.settings-now').textContent).join('\\n');`, shot: 'settings13-1-page'
  },
  {
    name: 'username: wrong password, bad name, then saved', eval: `
      ${set('#new-username', 'learner')} ${set('#username-current-password', 'wrong one')}
      document.getElementById('username-form').requestSubmit(); ${wait(1200)}
      const wrong = ${msgOf('username-form')};
      ${set('#new-username', 'two words')} ${set('#username-current-password', PASSWORD)}
      document.getElementById('username-form').requestSubmit(); ${wait(800)}
      const bad = ${msgOf('username-form')};
      ${set('#new-username', 'Learner')} ${set('#username-current-password', PASSWORD)}
      document.getElementById('username-form').requestSubmit(); ${wait(800)}
      return 'wrong password: ' + wrong + '\\nbad name: ' + bad + '\\nsaved: ' + ${msgOf('username-form')} + '\\nnow: ' + document.querySelector('.settings-now').textContent + ' | still on settings: ' + location.hash;`, shot: 'settings13-2-username'
  },
  {
    name: 'password: too short, different, then changed', eval: `
      ${set('#current-password', PASSWORD)} ${set('#new-password', 'short')} ${set('#repeat-password', 'short')}
      document.getElementById('password-form').requestSubmit(); ${wait(300)}
      const short = ${msgOf('password-form')};
      ${set('#new-password', NEW)} ${set('#repeat-password', 'something else here')}
      document.getElementById('password-form').requestSubmit(); ${wait(300)}
      const diff = ${msgOf('password-form')};
      ${set('#repeat-password', NEW)}
      document.getElementById('password-form').requestSubmit(); ${wait(1500)}
      const ok = ${msgOf('password-form')};
      const still = (await fetch('/api/dashboard')).status;
      return 'too short: ' + short + '\\ndifferent: ' + diff + '\\nchanged: ' + ok + '\\nthis device still logged in: ' + still + ' | fields emptied: ' + (document.getElementById('current-password').value === '');`, shot: 'settings13-3-password'
  },
  {
    name: 'phone layout', viewport: [390, 844], eval: `
      ${wait(400)}
      return 'width ' + document.documentElement.scrollWidth + '/' + innerWidth;`, shot: 'settings13-4-phone'
  },
  { name: 'log out', viewport: [1400, 900], eval: `[...document.querySelectorAll('.header-actions button')].find(b => b.textContent.includes('Log out')).click();`, wait: 2000 },
  {
    name: 'login page now asks for the username; the old password fails', eval: `
      ${wait(500)}
      const shown = !document.getElementById('username-field').hidden;
      ${set('#username', 'learner')} ${set('#password', PASSWORD)}
      document.getElementById('login-form').requestSubmit(); ${wait(1500)}
      const old = document.getElementById('login-error').textContent;
      ${set('#username', 'someone')} ${set('#password', NEW)}
      document.getElementById('login-form').requestSubmit(); ${wait(1500)}
      return 'username box shown: ' + shown + '\\nold password: ' + old + '\\nwrong username: ' + document.getElementById('login-error').textContent;`, shot: 'settings13-5-login'
  },
  { name: 'log in with the username (any case) and the new password', eval: `${'{'} const u = document.getElementById('username'); u.value = 'LEARNER'; ${'}'} document.getElementById('password').value = ${JSON.stringify(NEW)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  {
    name: 'logged in; put things back', eval: `
      const where = location.pathname + location.hash;
      const csrf = decodeURIComponent(document.cookie.match(/ielts_csrf=([^;]+)/)[1]);
      const post = (p, body) => fetch('/api' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) }).then(r => r.status);
      const a = await post('/account/username', { currentPassword: ${JSON.stringify(NEW)}, username: '' });
      return 'after login: ' + where + ' | username removed: ' + a;`
  }
];
