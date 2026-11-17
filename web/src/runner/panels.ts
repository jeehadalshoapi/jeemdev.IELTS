/* Settings, notes and help panels, and the listening audio player (converted from the old js/exam.js). */
import { el, local } from '../lib/dom';
import { formatClock } from '../lib/format';
import { modal, toast } from '../lib/ui';

/* ---------- display settings: a per-device preference, not test data ---------- */
export interface DisplaySettings { size: 'm' | 'l' | 'xl'; contrast: 'default' | 'wob' | 'yob'; split: number }
const SETTINGS_KEY = 'ielts-display';

export function loadSettings(): DisplaySettings {
  try { return { size: 'm', contrast: 'default', split: 50, ...JSON.parse(local.get(SETTINGS_KEY) ?? '{}') }; }
  catch { return { size: 'm', contrast: 'default', split: 50 }; }
}
export function saveSettings(patch: Partial<DisplaySettings>): DisplaySettings {
  const s = { ...loadSettings(), ...patch };
  local.set(SETTINGS_KEY, JSON.stringify(s));
  return s;
}

export function applySettings(root: HTMLElement): void {
  const s = loadSettings();
  root.className = root.className.replace(/\bsize-\w+/, '').replace(/\bcontrast-\w+/, '').trim() + ` size-${s.size} contrast-${s.contrast}`;
  root.style.setProperty('--left', `${s.split}%`);
}

export function openSettings(root: HTMLElement): void {
  const st = loadSettings();
  const group = (name: 'size' | 'contrast', label: string, opts: Array<[string, string, string?]>) => el('fieldset', { class: 'set-group' }, el('legend', null, label),
    opts.map(([v, l, cls]) => el('label', { class: `set-opt ${cls ?? ''}` },
      el('input', { type: 'radio', name, value: v, checked: st[name] === v, onchange: () => { saveSettings({ [name]: v } as Partial<DisplaySettings>); applySettings(root); } }),
      el('span', null, l))));
  modal({
    title: 'Settings',
    body: el('div', null,
      group('size', 'Text size', [['m', 'Standard'], ['l', 'Large'], ['xl', 'Extra large']]),
      group('contrast', 'Colours', [['default', 'Black on white', 'sw-bw'], ['wob', 'White on black', 'sw-wb'], ['yob', 'Yellow on black', 'sw-yb']])),
    actions: [{ label: 'Done', kind: 'primary' }]
  });
}

export function openNotes(notes: Array<{ note: string; quote: string; el: HTMLElement }>, goToMark: (m: HTMLElement) => void): void {
  const m = modal({
    title: `Notes (${notes.length})`,
    body: notes.length
      ? el('div', { class: 'notes-list' }, notes.map(n => el('div', { class: 'note-item', onclick: () => { m.close(); goToMark(n.el); } },
        el('q', null, n.quote.length > 140 ? `${n.quote.slice(0, 140)}…` : n.quote), el('p', null, n.note))))
      : el('p', { class: 'muted' }, 'No notes yet. Select some text and choose “Add note”.'),
    actions: [{ label: 'Close', kind: 'primary' }]
  });
}

export function openHelp(mode: 'exam' | 'practice'): void {
  modal({
    title: 'Help', wide: true,
    body: el('div', { class: 'help', html: `
      <ul>
        <li><b>Highlight:</b> select text in the passage or the questions, then choose <b>Highlight</b>. Right-click for <i>Highlight, Notes, Clear, Clear all</i>. Click a highlight to remove it.</li>
        <li><b>Notes:</b> select text and choose <b>Add note</b>. Open <b>📝 Notes</b> at the top to see them all.</li>
        <li><b>Navigation:</b> the question numbers at the bottom, or ◀ ▶ (Alt + ← / →). Answered questions are underlined.</li>
        <li><b>Review:</b> tick “Review” at the bottom to mark a question to come back to.</li>
        <li><b>Matching:</b> drag an option into a box, or click an option then a box. Click a filled box to empty it.</li>
        <li><b>Phone:</b> switch between the passage and the questions with the tabs at the top.</li>
        <li><b>Saving:</b> every answer is saved to the server within a second — the dot next to the clock shows it. You can close the page and carry on from any device.</li>
        <li>${mode === 'exam'
          ? '<b>Exam mode:</b> the clock keeps running even if you close the page, like the real test. When it reaches zero your answers are submitted.'
          : '<b>Practice mode:</b> ⏸ pauses the clock. Closing the page also pauses it — only the time you spend in the test counts.'}</li>
      </ul>` }),
    actions: [{ label: 'Close', kind: 'primary' }]
  });
}

export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen().catch(() => toast('Full screen is not available here'));
}

/* ---------- listening audio ---------- */
export interface AudioTrack { partIndex: number; url: string; title: string }
export interface AudioHandle { audio: HTMLAudioElement; position(): { track: number; time: number }; stop(): void }

export function startAudio(bar: HTMLElement, tracks: AudioTrack[], o: {
  practice: boolean;
  resume?: { track: number; time: number } | undefined;
  onTrackChange?: (partIndex: number) => void;
}): AudioHandle | null {
  if (!tracks.length) return null;
  const a = new Audio();
  a.preload = 'auto';
  const vol = Number(local.get('ielts-volume') ?? 1);
  a.volume = Number.isFinite(vol) ? vol : 1;
  let idx = 0;

  const status = el('span', { class: 'aud-status' });
  const time = el('span', { class: 'aud-time' });
  const prog = el('input', { type: 'range', class: 'aud-seek', min: 0, max: 1000, value: 0, disabled: !o.practice, 'aria-label': 'Audio position' });
  const playBtn = o.practice ? el('button', { class: 'cd-icon', title: 'Play / pause', onclick: () => (a.paused ? a.play() : a.pause()) }, '⏯') : null;
  const trackSel = o.practice && tracks.length > 1
    ? el('select', { class: 'aud-select', onchange: (e: Event) => load(Number((e.target as HTMLSelectElement).value), 0) }, tracks.map((t, i) => el('option', { value: i }, t.title)))
    : null;
  const speed = o.practice
    ? el('select', { class: 'aud-select', title: 'Speed', onchange: (e: Event) => { a.playbackRate = Number((e.target as HTMLSelectElement).value); } },
      ['0.75', '0.9', '1', '1.1', '1.25'].map(v => el('option', { value: v, selected: v === '1' }, `${v}×`)))
    : null;
  const back = o.practice ? el('button', { class: 'cd-icon', title: 'Back 5 seconds', onclick: () => { a.currentTime = Math.max(0, a.currentTime - 5); } }, '↺5') : null;
  const volume = el('input', {
    type: 'range', class: 'aud-vol', min: 0, max: 1, step: 0.05, value: a.volume, title: 'Volume', 'aria-label': 'Volume',
    oninput: (e: Event) => { a.volume = Number((e.target as HTMLInputElement).value); local.set('ielts-volume', String(a.volume)); }
  });
  const startBtn = el('button', { class: 'btn btn-sm btn-primary aud-start hidden', onclick: () => { void a.play(); startBtn.classList.add('hidden'); } }, '▶ Play audio');
  bar.append(...[el('span', { class: 'aud-icon' }, '🎧'), status, playBtn, back, trackSel, prog, time, speed, el('span', { title: 'Volume' }, '🔊'), volume, startBtn].filter((x): x is HTMLElement => !!x));

  const load = (i: number, at: number) => {
    idx = i;
    a.src = tracks[i]!.url;
    if (trackSel) trackSel.value = String(i);
    a.addEventListener('loadedmetadata', () => { if (at) a.currentTime = Math.min(at, a.duration || at); }, { once: true });
    a.play().catch(() => { status.textContent = 'Press ▶ to start the audio'; startBtn.classList.remove('hidden'); });
  };
  a.addEventListener('play', () => { status.textContent = `${tracks[idx]!.title} — audio playing`; });
  a.addEventListener('pause', () => { if (!a.ended && o.practice) status.textContent = `${tracks[idx]!.title} — paused`; });
  a.addEventListener('timeupdate', () => {
    if (!a.duration) return;
    prog.value = String(Math.round((a.currentTime / a.duration) * 1000));
    time.textContent = `${formatClock(a.currentTime)} / ${formatClock(a.duration)}`;
  });
  prog.addEventListener('input', () => { if (a.duration) a.currentTime = (Number(prog.value) / 1000) * a.duration; });
  a.addEventListener('ended', () => {
    if (idx < tracks.length - 1) {
      const next = idx + 1;
      if (!o.practice) o.onTrackChange?.(tracks[next]!.partIndex);
      load(next, 0);
    } else status.textContent = 'The recording has finished. Check your answers.';
  });
  const r = o.resume && o.resume.track < tracks.length ? o.resume : { track: 0, time: 0 };
  load(r.track, r.time);
  return {
    audio: a,
    position: () => ({ track: idx, time: Math.round(a.currentTime) }),
    stop: () => { a.pause(); a.removeAttribute('src'); a.load(); }
  };
}
