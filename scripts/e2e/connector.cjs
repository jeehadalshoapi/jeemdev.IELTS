// Phase 5 check in a real browser: the Claude connector's approval page (login detour, Allow, redirect with a code),
// and the connector card on the Tests page. Uses a loopback callback, so nothing is sent to claude.ai.
const PASSWORD = process.env.E2E_PASSWORD || 'ielts-dev';
const wait = ms => `await new Promise(r => setTimeout(r, ${ms}));`;
const CALLBACK = 'http://localhost:33418/callback';
const startAuthorize = `
  const reg = await (await fetch('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['${CALLBACK}'] }) })).json();
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: '${CALLBACK}', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256', state: 'xyz', scope: 'ielts', resource: location.origin + '/mcp' });
  location.href = '/oauth/authorize?' + q;`;

module.exports = [
  { name: 'not logged in: start a connection', viewport: [1400, 900], eval: startAuthorize, wait: 1500 },
  { name: 'sent to the login page first', eval: `return location.pathname + ' next=' + new URLSearchParams(location.search).get('next')?.slice(0, 40);` },
  { name: 'log in', eval: `document.getElementById('password').value = ${JSON.stringify(PASSWORD)}; document.getElementById('login-form').requestSubmit();`, wait: 2500 },
  { name: 'back on the approval page', eval: `return location.pathname + ' | ' + document.querySelector('h1')?.textContent + ' | buttons: ' + [...document.querySelectorAll('button')].map(b => b.textContent).join(', ');`, shot: 'connector-1-approve' },
  { name: 'press Allow', eval: `[...document.querySelectorAll('button')].find(b => b.textContent === 'Allow').click();`, wait: 2000 },
  { name: 'redirected to the app with a code', eval: `const u = new URL(location.href); return u.origin + u.pathname + ' code: ' + (u.searchParams.get('code') ? 'yes' : 'NO') + ' state: ' + u.searchParams.get('state') + ' iss: ' + u.searchParams.get('iss');` },
  { name: 'open the site again', eval: `location.href = 'http://localhost:3000/#/tests';`, wait: 1800 },
  { name: 'connector card (code not exchanged yet: not connected)', eval: `return document.querySelector('.connector-card')?.innerText.replace(/\\n+/g, ' ¶ ');`, shot: 'connector-2-card' },
  { name: 'phone: approval page', viewport: [390, 844], eval: startAuthorize, wait: 1500 },
  { name: 'phone shot', eval: `return document.documentElement.scrollWidth + 'px wide';`, shot: 'connector-3-phone' }
];
