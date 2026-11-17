/* ===== Small DOM + UI helpers shared by every screen ===== */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * el('div', {class: 'x', onclick: fn, dataset: {a: 1}}, child1, [child2, child3], 'text')
 */
function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'readOnly') node[k] = !!v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(node, c);
    else if (c instanceof Node) node.appendChild(c);
    else node.appendChild(document.createTextNode(String(c)));
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid(prefix = 'id') {
  return prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function debounce(fn, ms) {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.flush = (...args) => { clearTimeout(t); return fn(...args); };
  d.cancel = () => clearTimeout(t);
  return d;
}

function formatClock(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m} min ${s ? s + ' s' : ''}`.trim() : `${s} s`;
}

function wordCount(text) {
  const t = String(text || '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx'];
function makeLabel(style, i) {
  if (style === 'roman') return ROMAN[i] || String(i + 1);
  if (style === 'lower') return String.fromCharCode(97 + i);
  if (style === 'number') return String(i + 1);
  return String.fromCharCode(65 + i);
}

/* ---------- toasts ---------- */
function toast(msg, type = 'info', ms = 2600) {
  const box = $('#toasts');
  const t = el('div', { class: `toast toast-${type}` }, msg);
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

/* ---------- modal ---------- */
/**
 * modal({title, body, actions:[{label, kind:'primary'|'danger'|'ghost', onClick}], wide, dismissable})
 * onClick may return false to keep the modal open. Returns {close, root}.
 */
function modal({ title, body, actions = [], wide = false, dismissable = true, className = '' }) {
  const overlay = el('div', { class: 'modal-overlay ' + className });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape' && dismissable) close(); };
  const box = el('div', { class: 'modal' + (wide ? ' modal-wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    title ? el('div', { class: 'modal-head' },
      el('h3', null, title),
      dismissable ? el('button', { class: 'icon-btn modal-x', title: 'Close', onclick: close }, '✕') : null
    ) : null,
    el('div', { class: 'modal-body' }, typeof body === 'string' ? el('div', { html: body }) : body),
    actions.length ? el('div', { class: 'modal-actions' }, actions.map(a =>
      el('button', {
        class: 'btn ' + (a.kind ? 'btn-' + a.kind : ''),
        onclick: async () => { const r = a.onClick ? await a.onClick() : undefined; if (r !== false) close(); }
      }, a.label)
    )) : null
  );
  overlay.appendChild(box);
  if (dismissable) overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  const first = box.querySelector('textarea, input, .btn-primary');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, root: box };
}

function confirmDialog(message, { title = 'Please confirm', ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    let decided = false;
    const m = modal({
      title, body: el('p', null, message),
      actions: [
        { label: cancel, kind: 'ghost', onClick: () => { decided = true; resolve(false); } },
        { label: ok, kind: danger ? 'danger' : 'primary', onClick: () => { decided = true; resolve(true); } }
      ]
    });
    const obs = new MutationObserver(() => {
      if (!document.body.contains(m.root)) { obs.disconnect(); if (!decided) resolve(false); }
    });
    obs.observe(document.body, { childList: true });
  });
}

function promptDialog({ title, label, value = '', multiline = false, ok = 'Save', placeholder = '' }) {
  return new Promise(resolve => {
    let decided = false;
    const input = multiline
      ? el('textarea', { class: 'input', rows: 6, placeholder }, )
      : el('input', { class: 'input', type: 'text', placeholder });
    input.value = value;
    const m = modal({
      title,
      body: el('div', null, label ? el('label', { class: 'field-label' }, label) : null, input),
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => { decided = true; resolve(null); } },
        { label: ok, kind: 'primary', onClick: () => { decided = true; resolve(input.value); } }
      ]
    });
    if (!multiline) input.addEventListener('keydown', e => { if (e.key === 'Enter') { decided = true; resolve(input.value); m.close(); } });
    const obs = new MutationObserver(() => {
      if (!document.body.contains(m.root)) { obs.disconnect(); if (!decided) resolve(null); }
    });
    obs.observe(document.body, { childList: true });
  });
}

/* ---------- files ---------- */
function readFileAsText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
}
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
async function dataURLToBlob(url) { return (await fetch(url)).blob(); }

function downloadText(filename, text, type = 'application/json') {
  const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function pickFile(accept) {
  return new Promise(resolve => {
    const inp = el('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

function pickFiles(accept) {
  return new Promise(resolve => {
    const inp = el('input', { type: 'file', accept, multiple: true, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(Array.from(inp.files)); inp.remove(); });
    document.body.appendChild(inp);
    inp.click();
  });
}

function slugify(s) { return String(s || 'test').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'test'; }
