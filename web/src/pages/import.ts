/* #/import — the import box (Phase 4): paste a test (JSON from Claude, or the text format), attach its audio / pictures,
   check it, then save it. Nothing is kept in the browser: the text lives in the page until it is saved. */
import {
  mimeFromName, UPLOAD_MAX_BYTES, uploadKindOf,
  type ImportCheckResponse, type ImportIssue, type ImportSaveResponse, type ImportSummary, type SectionSkill
} from '@ielts/shared';
import { api, ApiError, uploadFile } from '../lib/api';
import { el } from '../lib/dom';
import { confirmDialog, toast } from '../lib/ui';
import { appHeader, kindBadge, SKILL_LABEL, skillBadge, TYPE_LABEL } from './common';

const PLACEHOLDER = `Paste a test here. Two formats work:

1) JSON written by Claude: { "title": …, "skill": "reading", "parts": [ … ], "answerKey": { … } }

2) The text format (see HOW-TO-ADD-TESTS.md):

TITLE: Day 24 — TFNG drill
MODULE: Reading
KIND: Homework
TIME: 20

=== PASSAGE 1 ===
TEXT:
[A] The first paragraph of the passage…

--- TRUE FALSE NOT GIVEN ---
QUESTIONS:
1. The first glass was made in Egypt. | TRUE`;

interface Attached {
  file: File;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  url?: string;
  error?: string;
  abort?: () => void;
}

const SECTION_ICON: Record<SectionSkill, string> = { reading: '📖', listening: '🎧', writing: '✍️', vocabulary: '🔤', speaking: '🗣' };
const mb = (bytes: number) => (bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`);

function numbersText(nums: number[]): string {
  if (!nums.length) return '';
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `Q${lo}` : `Q${lo}–${hi}`;
}

export function mountImport(root: HTMLElement): { canLeave(): Promise<boolean>; destroy(): void } {
  const attached = new Map<string, Attached>();
  let lastCheck: { key: string; result: ImportCheckResponse } | null = null;
  let saved = false;
  let busy = false;

  const textarea = el('textarea', { class: 'input mono import-text', rows: 22, spellcheck: 'false', placeholder: PLACEHOLDER, 'aria-label': 'Test to import' });
  const fileInput = el('input', { type: 'file', multiple: true, accept: 'audio/*,image/*', hidden: true });
  const fileList = el('div', { class: 'import-files' });
  const checkBtn = el('button', { class: 'btn', title: 'Ctrl+Enter' }, 'Check');
  const saveBtn = el('button', { class: 'btn btn-primary', disabled: true }, 'Save test');
  const result = el('div', { class: 'import-result' });

  const filesMap = () => Object.fromEntries([...attached.values()].filter(a => a.url).map(a => [a.file.name, a.url!]));
  const keyNow = () => JSON.stringify([textarea.value, filesMap()]);
  const uploading = () => [...attached.values()].some(a => a.status === 'uploading');
  const isCurrent = () => !!lastCheck && lastCheck.key === keyNow();

  function refreshButtons() {
    checkBtn.disabled = busy || !textarea.value.trim() || uploading();
    saveBtn.disabled = busy || uploading() || !isCurrent() || !lastCheck?.result.ok;
    saveBtn.title = !lastCheck ? 'Check the test first' : !isCurrent() ? 'The text or files changed — check again' : lastCheck.result.ok ? '' : 'Fix the problems first';
  }

  /* ---------- files ---------- */
  function drawFiles() {
    fileList.replaceChildren(...[...attached.entries()].map(([key, a]) => el('div', { class: `import-file is-${a.status}` },
      el('span', { class: 'import-file-icon' }, a.file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.file.name) ? '🖼' : '🎵'),
      el('span', { class: 'import-file-name' }, a.file.name),
      el('span', { class: 'muted' }, mb(a.file.size)),
      a.status === 'uploading' ? el('span', { class: 'import-file-bar' }, el('span', { style: { width: `${Math.round(a.progress * 100)}%` } })) : null,
      el('span', { class: a.status === 'error' ? 'danger' : a.status === 'done' ? 'ok-text' : 'muted' },
        a.status === 'uploading' ? `${Math.round(a.progress * 100)}%` : a.status === 'done' ? '✓ uploaded' : a.error ?? 'failed'),
      el('button', {
        class: 'icon-btn', title: a.status === 'uploading' ? 'Cancel upload' : 'Remove', 'aria-label': `Remove ${a.file.name}`,
        onclick: () => { a.abort?.(); attached.delete(key); drawFiles(); refreshButtons(); }
      }, '✕'))));
  }

  function addFiles(list: FileList | File[]) {
    for (const file of Array.from(list)) {
      const key = file.name.toLowerCase();
      attached.get(key)?.abort?.();
      const mime = uploadKindOf(file.type) ? file.type : mimeFromName(file.name);
      const kind = uploadKindOf(mime);
      const a: Attached = { file, status: 'uploading', progress: 0 };
      attached.set(key, a);
      if (!kind) { a.status = 'error'; a.error = 'not an audio file or picture'; continue; }
      if (file.size > UPLOAD_MAX_BYTES[kind]) { a.status = 'error'; a.error = `larger than ${mb(UPLOAD_MAX_BYTES[kind])}`; continue; }
      const up = uploadFile(file, mime, p => { a.progress = p; drawFiles(); });
      a.abort = up.abort;
      up.done.then(r => { a.status = 'done'; a.url = r.url; delete a.abort; })
        .catch((e: Error) => { a.status = 'error'; a.error = e.message; delete a.abort; })
        .finally(() => { if (attached.get(key) === a) { drawFiles(); refreshButtons(); } });
    }
    drawFiles();
    refreshButtons();
  }
  fileInput.addEventListener('change', () => { if (fileInput.files) addFiles(fileInput.files); fileInput.value = ''; });

  /* ---------- check and save ---------- */
  async function check() {
    if (checkBtn.disabled) return;
    busy = true;
    refreshButtons();
    const key = keyNow();
    try {
      const r = await api<ImportCheckResponse>('/import/check', { method: 'POST', body: { source: textarea.value, files: filesMap() } });
      lastCheck = { key, result: r };
      drawResult(r);
    } catch (e) {
      lastCheck = null;
      drawProblem(e as Error);
    } finally {
      busy = false;
      refreshButtons();
    }
  }

  async function save() {
    if (saveBtn.disabled) return;
    busy = true;
    refreshButtons();
    try {
      const r = await api<ImportSaveResponse>('/import', { method: 'POST', body: { source: textarea.value, files: filesMap() } });
      saved = true;
      drawSaved(r);
    } catch (e) {
      drawProblem(e as Error);
    } finally {
      busy = false;
      refreshButtons();
    }
  }

  checkBtn.addEventListener('click', check);
  saveBtn.addEventListener('click', save);
  textarea.addEventListener('input', () => { saved = false; refreshButtons(); });
  textarea.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void check(); }
  });

  /* ---------- result panel ---------- */
  const issueList = (issues: ImportIssue[]) => el('ul', { class: 'import-issues' }, issues.map(i => el('li', null,
    i.where ? el('b', null, i.where) : null,
    i.path && !i.path.startsWith('(') ? el('code', null, i.path) : null,
    el('span', null, i.message))));

  const issuesAsText = (issues: ImportIssue[]) => issues.map(i => `- ${i.where ? `[${i.where}] ` : ''}${i.path}: ${i.message}`).join('\n');

  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied`, 'ok'); } catch { toast('Copying is blocked in this browser', 'err'); }
  }

  function drawResult(r: ImportCheckResponse) {
    const parts: Array<Node | null> = [];
    if (!r.ok) {
      parts.push(el('div', { class: 'imp-item imp-err' },
        el('div', { class: 'imp-head' }, el('span', { class: 'imp-icon' }, '✗'),
          el('div', null, el('b', null, `${r.errors.length} problem${r.errors.length === 1 ? '' : 's'} to fix`), el('small', null, `Read as ${r.format === 'json' ? 'JSON' : 'the text format'}. Fix ${r.errors.length === 1 ? 'it' : 'them'} and press Check again.`)),
          el('button', { class: 'btn btn-sm btn-ghost', title: 'Copy the list, e.g. to paste it to Claude', onclick: () => copy(`The import box found these problems:\n${issuesAsText(r.errors)}`, 'Problems') }, 'Copy list')),
        issueList(r.errors)));
    } else if (r.summary) {
      parts.push(el('div', { class: 'imp-item imp-ok' },
        el('div', { class: 'imp-head' }, el('span', { class: 'imp-icon' }, '✓'),
          el('div', null, el('b', null, 'Ready to save'), el('small', null, `Read as ${r.format === 'json' ? 'JSON' : 'the text format'}. Check the summary below, then press Save test.`)))));
      parts.push(summaryCard(r.summary));
    }
    if (r.warnings.length) {
      parts.push(el('div', { class: 'imp-item imp-warn' },
        el('div', { class: 'imp-head' }, el('span', { class: 'imp-icon' }, '!'),
          el('div', null, el('b', null, `${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}`), el('small', null, 'These do not stop the test from being saved.'))),
        issueList(r.warnings)));
    }
    if (r.format === 'text' && r.json) {
      const text = JSON.stringify(r.json, null, 2);
      parts.push(el('details', { class: 'card details import-json' },
        el('summary', null, 'The test as JSON'),
        el('p', { class: 'hint' }, 'This is what the text turns into. It includes the answers.'),
        el('button', { class: 'btn btn-sm', onclick: () => copy(text, 'JSON') }, 'Copy JSON'),
        el('pre', null, text)));
    }
    result.replaceChildren(...parts.filter((p): p is Node => !!p));
  }

  function summaryCard(s: ImportSummary): HTMLElement {
    const facts = [
      s.marks ? `${s.marks} question${s.marks === 1 ? '' : 's'}` : `${s.parts.length} task${s.parts.length === 1 ? '' : 's'}`,
      s.timeLimitMin ? `⏱ ${s.timeLimitMin} min` : 'no time limit',
      s.dueDate ? `due ${s.dueDate}` : null,
      s.variant === 'general_training' ? 'General Training' : null
    ].filter(Boolean).join(' · ');
    return el('div', { class: 'card import-summary' },
      el('div', { class: 'badges' }, skillBadge(s.skill), kindBadge(s.kind)),
      el('h3', null, s.title),
      el('div', { class: 'test-meta' }, facts),
      s.marks && s.answers < s.marks ? el('p', { class: 'danger' }, `Only ${s.answers} of ${s.marks} questions have an answer.`) : null,
      el('table', { class: 'table compact' }, el('tbody', null, s.parts.map(p => el('tr', null,
        el('td', null, el('b', null, p.title), el('div', { class: 'muted' },
          p.section ? `${SECTION_ICON[p.section]} ${SKILL_LABEL[p.section]}` : '',
          p.timeLimitMin ? ` · ${p.timeLimitMin} min` : '',
          p.section === 'listening' ? (p.audio ? ' · 🎵 recording' : p.hasTranscript ? ' · transcript only' : ' · recording from an earlier part') : '')),
        el('td', null, el('ul', { class: 'plain-list' }, p.groups.map(g => el('li', null,
          el('span', { class: 'nowrap' }, numbersText(g.numbers)), g.numbers.length ? ' ' : '', TYPE_LABEL[g.type], g.title ? el('span', { class: 'muted' }, ` — ${g.title}`) : null)))))))));
  }

  function drawProblem(e: Error) {
    const issues = (e instanceof ApiError ? e.issues : undefined) ?? [];
    result.replaceChildren(el('div', { class: 'imp-item imp-err' },
      el('div', { class: 'imp-head' }, el('span', { class: 'imp-icon' }, '✗'),
        el('div', null, el('b', null, e instanceof TypeError ? 'Cannot reach the server' : e.message), el('small', null, e instanceof TypeError ? 'Check your connection and try again.' : ''))),
      issues.length ? issueList(issues) : null));
  }

  function drawSaved(r: ImportSaveResponse) {
    result.replaceChildren(el('div', { class: 'imp-item imp-ok' },
      el('div', { class: 'imp-head' }, el('span', { class: 'imp-icon' }, '✓'),
        el('div', null, el('b', null, `Saved “${r.title}”`), el('small', null, 'It is on the dashboard now.'))),
      el('div', { class: 'import-saved-actions' },
        el('a', { class: 'btn btn-primary', href: `#/test/${r.id}` }, '▶ Open the test'),
        el('button', { class: 'btn', onclick: reset }, 'Import another'),
        el('a', { class: 'btn btn-ghost', href: '#/tests' }, 'All tests'))));
  }

  function reset() {
    for (const a of attached.values()) a.abort?.();
    attached.clear();
    textarea.value = '';
    lastCheck = null;
    saved = false;
    drawFiles();
    drawIdle();
    refreshButtons();
    textarea.focus();
  }

  function drawIdle() {
    result.replaceChildren(el('div', { class: 'import-idle' },
      el('h3', null, 'How it works'),
      el('ol', { class: 'plain-list' },
        el('li', null, 'Paste the test on the left: JSON that Claude wrote, or the text format.'),
        el('li', null, 'If the test names audio or pictures (', el('code', null, 'AUDIO: part1.mp3'), '), attach those files.'),
        el('li', null, el('b', null, 'Check'), ' (Ctrl+Enter) lists every problem at once, with where it is.'),
        el('li', null, el('b', null, 'Save test'), ' puts it on the dashboard.')),
      el('p', { class: 'hint' }, 'The text format is described in HOW-TO-ADD-TESTS.md. The templates folder has a ready example for Reading, Listening and Writing.')));
  }

  root.append(appHeader('Paste a test, check it, save it'), el('div', { class: 'page' },
    el('div', { class: 'import-grid' },
      el('section', { class: 'panel import-editor' },
        el('label', { class: 'field-label', for: 'import-text' }, 'Test (JSON or text format)'),
        textarea,
        el('div', { class: 'import-attach' },
          el('button', { class: 'btn btn-sm', onclick: () => fileInput.click() }, '📎 Attach audio / pictures'),
          el('span', { class: 'hint' }, `Only when the test names files. Up to ${mb(UPLOAD_MAX_BYTES.audio)} per recording, ${mb(UPLOAD_MAX_BYTES.image)} per picture.`),
          fileInput),
        fileList,
        el('div', { class: 'import-actions' }, checkBtn, saveBtn,
          el('button', { class: 'btn btn-ghost', onclick: async () => { if (!textarea.value.trim() || await confirmDialog('Clear the text and the attached files?', { ok: 'Clear' })) reset(); } }, 'Clear'))),
      el('section', { class: 'import-side' }, result))));
  textarea.id = 'import-text';
  drawIdle();
  refreshButtons();

  // dropping files anywhere on the page attaches them
  const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const txt = files.find(f => /\.(txt|json)$/i.test(f.name));
    if (txt && !textarea.value.trim()) void txt.text().then(t => { textarea.value = t; refreshButtons(); });
    const media = files.filter(f => !/\.(txt|json)$/i.test(f.name));
    if (media.length) addFiles(media);
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => { if (dirty()) e.preventDefault(); };
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);
  window.addEventListener('beforeunload', onBeforeUnload);
  const dirty = () => !saved && (!!textarea.value.trim() || attached.size > 0);

  return {
    canLeave: async () => !dirty() || confirmDialog('The test is not saved. Leave this page and lose the text?', { ok: 'Leave', danger: true }),
    destroy() {
      for (const a of attached.values()) a.abort?.();
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
      window.removeEventListener('beforeunload', onBeforeUnload);
    }
  };
}
