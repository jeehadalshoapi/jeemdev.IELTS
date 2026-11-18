import './styles/app.css';
import { api, ApiError } from './lib/api';

const form = document.getElementById('login-form') as HTMLFormElement;
const input = document.getElementById('password') as HTMLInputElement;
const error = document.getElementById('login-error') as HTMLParagraphElement;
const button = document.getElementById('login-btn') as HTMLButtonElement;

form.addEventListener('submit', async e => {
  e.preventDefault();
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Logging in…';
  try {
    await api('/auth/login', { method: 'POST', body: { password: input.value }, redirectOn401: false });
    // after logging in, go back to the Claude connector's approval page if that is where we came from
    const next = new URLSearchParams(location.search).get('next');
    location.href = next && next.startsWith('/oauth/authorize?') && !next.includes('\\') ? next : '/';
  } catch (err) {
    error.textContent = err instanceof ApiError ? err.message : 'Cannot reach the server. Check your connection.';
    error.hidden = false;
    input.select();
  } finally {
    button.disabled = false;
    button.textContent = 'Log in';
  }
});
