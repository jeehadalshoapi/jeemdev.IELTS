/*
 * #/settings — change the username and the password (Phase 13).
 * Both need the current password. A new password logs out every other device and disconnects Claude.
 */
import { MIN_PASSWORD_LENGTH, type AccountResponse } from '@ielts/shared';
import { api, ApiError } from '../lib/api';
import { el } from '../lib/dom';
import { fmtDate } from '../lib/format';
import { appHeader } from './common';

const errorText = (e: unknown) => e instanceof ApiError
  ? (e.issues?.length ? e.issues.map(i => i.message).join(' ') : e.message)
  : 'Cannot reach the server. Check your connection.';

function passwordInput(id: string, autocomplete: string): HTMLInputElement {
  return el('input', { class: 'input', type: 'password', id, name: id, autocomplete, required: true, maxlength: '200' });
}

function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), input, hint ? el('span', { class: 'hint' }, hint) : '');
}

/** a form whose submit shows a message under the button instead of reloading the page */
function settingsForm(id: string, fields: HTMLElement[], button: string, run: () => Promise<string>): HTMLFormElement {
  const msg = el('p', { class: 'settings-msg', role: 'status', hidden: true });
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, button);
  const form = el('form', { id, novalidate: true }, ...fields, el('div', { class: 'settings-actions' }, btn), msg);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    btn.disabled = true;
    msg.hidden = true;
    try {
      msg.textContent = await run();
      msg.className = 'settings-msg ok';
    } catch (err) {
      msg.textContent = errorText(err);
      msg.className = 'settings-msg bad';
    } finally {
      msg.hidden = false;
      btn.disabled = false;
    }
  });
  return form;
}

export async function mountSettings(root: HTMLElement): Promise<void> {
  let acc = await api<AccountResponse>('/account');

  const nameNow = el('p', { class: 'settings-now' });
  const passNow = el('p', { class: 'settings-now' });
  function drawNow() {
    nameNow.replaceChildren(acc.username
      ? el('span', null, 'You log in as ', el('b', null, acc.username), '.')
      : el('span', null, 'No username yet: you log in with the password only.'));
    passNow.replaceChildren(acc.passwordSetOnSite && acc.passwordChangedAt
      ? `Last changed here on ${fmtDate(acc.passwordChangedAt)}.`
      : 'Still the first password, set on the server.');
  }
  drawNow();

  // username
  const username = el('input', { class: 'input', type: 'text', id: 'new-username', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '40', value: acc.username ?? '' });
  const userPw = passwordInput('username-current-password', 'current-password');
  const userForm = settingsForm('username-form', [
    field('Username', username, '3–40 letters, digits or . _ @ - (no spaces). Leave it empty to log in with the password only.'),
    field('Current password', userPw)
  ], 'Save username', async () => {
    acc = await api<AccountResponse>('/account/username', { method: 'POST', body: { currentPassword: userPw.value, username: username.value } });
    userPw.value = '';
    username.value = acc.username ?? '';
    drawNow();
    return acc.username ? `Saved. From now on, log in as "${acc.username}".` : 'Saved. You log in with the password only.';
  });

  // password
  const curPw = passwordInput('current-password', 'current-password');
  const newPw = passwordInput('new-password', 'new-password');
  const newPw2 = passwordInput('repeat-password', 'new-password');
  const passForm = settingsForm('password-form', [
    // a hidden username lets password managers save the new password for the right account
    el('input', { type: 'text', name: 'username', autocomplete: 'username', value: acc.username ?? '', hidden: true, tabindex: '-1', 'aria-hidden': 'true' }),
    field('Current password', curPw),
    field('New password', newPw, `At least ${MIN_PASSWORD_LENGTH} characters. A short sentence is easy to remember.`),
    field('Repeat the new password', newPw2)
  ], 'Change password', async () => {
    if (newPw.value.length < MIN_PASSWORD_LENGTH) throw new ApiError(400, 'too_short', `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (newPw.value !== newPw2.value) throw new ApiError(400, 'mismatch', 'The two new passwords are different.');
    const r = await api<AccountResponse & { loggedOut: number }>('/account/password', { method: 'POST', body: { currentPassword: curPw.value, newPassword: newPw.value } });
    acc = r;
    curPw.value = newPw.value = newPw2.value = '';
    drawNow();
    return `Password changed. ${r.loggedOut ? `${r.loggedOut} other device${r.loggedOut === 1 ? ' was' : 's were'} logged out. ` : ''}Claude is disconnected: reconnect it in claude.ai (Settings → Connectors).`;
  });

  root.append(appHeader('Settings'), el('div', { class: 'page settings-page' },
    el('div', { class: 'grid-2' },
      el('section', { class: 'card' }, el('h2', { class: 'card-title' }, '👤 Username'), nameNow, userForm),
      el('section', { class: 'card' }, el('h2', { class: 'card-title' }, '🔑 Password'), passNow,
        el('p', { class: 'settings-warn' }, 'Changing it logs out your other devices and disconnects Claude. This device stays logged in.'),
        passForm)),
    el('p', { class: 'hint' }, 'Forgot your password? Claude Code can set a new one on the server (change-password.sh).')));
}
