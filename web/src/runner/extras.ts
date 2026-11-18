/*
 * Phase 6 in the test runner:
 *  - Writing Task 2 "plan + introduction" drill with its own two timers
 *  - Speaking: recording (MediaRecorder, uploaded to the server), optional live transcript, Part 2 timers
 *  - Listening without a recording: the transcript read aloud by the browser (speech synthesis)
 */
import { RECORDING_MAX_BYTES, type Part, type QuestionGroup, type RecordingInfo, type SpeechLine, type SpeechResponse, listItems, partSpeech } from '@ielts/shared';
import { api, ApiError, uploadTo } from '../lib/api';
import { el, local } from '../lib/dom';
import { formatClock } from '../lib/format';
import { inlineMd, mdBlock } from '../lib/markup';
import { confirmDialog } from '../lib/ui';
import type { RenderCtx } from './render';

type TextAreaFn = (ctx: RenderCtx, value: string, minWords: number, label: string | null, onChange: (v: string) => void, rows?: number) => HTMLElement;
const onScreen = (node: HTMLElement) => node.isConnected && !node.closest<HTMLElement>('.cd-part')?.hidden;

/* ======================================================================
   Writing Task 2 drill: plan, then introduction, each with its own timer
   ====================================================================== */
interface DrillState { stage: 'plan' | 'intro' | 'done'; planSec: number; introSec: number }

export function drillBox(ctx: RenderCtx, g: Extract<QuestionGroup, { type: 'writing_task2' }>, textArea: TextAreaFn): HTMLElement {
  const cur = (ctx.answers[g.id] && typeof ctx.answers[g.id] === 'object' && !Array.isArray(ctx.answers[g.id]) ? ctx.answers[g.id] : {}) as { plan?: string; introduction?: string };
  const value = { plan: cur.plan ?? '', introduction: cur.introduction ?? '' };
  const save = () => ctx.setAnswer(g.id, { ...value });
  const key = `drill:${g.id}`;
  const st: DrillState = { stage: 'plan', planSec: 0, introSec: 0, ...((ctx.state[key] as Partial<DrillState> | undefined) ?? {}) };
  const limits = { plan: g.planTimeMin * 60, intro: g.introTimeMin * 60 };
  const exam = ctx.mode === 'exam';
  const persist = () => { if (!ctx.readonly) ctx.setState(key, { ...st }); };

  const planBox = textArea(ctx, value.plan, 0, null, v => { value.plan = v; save(); }, 8);
  const introBox = textArea(ctx, value.introduction, g.introMinWords, null, v => { value.introduction = v; save(); }, 8);
  const planClock = el('span', { class: 'drill-clock' });
  const introClock = el('span', { class: 'drill-clock' });
  const nextBtn = el('button', { class: 'btn-ex', onclick: () => go('intro') }, 'Next: write the introduction →');
  const doneBtn = el('button', { class: 'btn-ex', onclick: () => go('done') }, '✓ Finish the drill');
  const planStage = el('section', { class: 'drill-stage' }, el('div', { class: 'drill-head' }, el('b', null, `1 · Plan (${g.planTimeMin} min)`), planClock), planBox, nextBtn);
  const introStage = el('section', { class: 'drill-stage' }, el('div', { class: 'drill-head' }, el('b', null, `2 · Introduction (${g.introTimeMin} min)`), introClock), introBox, doneBtn);

  const clock = (sec: number, limit: number, active: boolean) => {
    if (!active) return sec ? `${formatClock(sec)} used` : '';
    const left = limit - sec;
    return left >= 0 ? `⏱ ${formatClock(left)} left` : `⏱ +${formatClock(-left)} over`;
  };
  function apply() {
    const planTa = planBox.querySelector('textarea')!, introTa = introBox.querySelector('textarea')!;
    planTa.disabled = ctx.readonly || (exam && st.stage !== 'plan');
    introTa.disabled = ctx.readonly || st.stage === 'plan' || (exam && st.stage === 'done');
    planTa.placeholder = 'Your plan: your position, two main ideas, an example for each';
    introTa.placeholder = st.stage === 'plan' ? 'Finish the plan first (Next ↑)' : 'Write your introduction here';
    nextBtn.hidden = ctx.readonly || st.stage !== 'plan';
    doneBtn.hidden = ctx.readonly || st.stage !== 'intro';
    planStage.classList.toggle('active', st.stage === 'plan' && !ctx.readonly);
    introStage.classList.toggle('active', st.stage === 'intro' && !ctx.readonly);
    planClock.textContent = clock(st.planSec, limits.plan, st.stage === 'plan' && !ctx.readonly);
    introClock.textContent = clock(st.introSec, limits.intro, st.stage === 'intro' && !ctx.readonly);
    planClock.classList.toggle('over', st.stage === 'plan' && st.planSec > limits.plan);
    introClock.classList.toggle('over', st.stage === 'intro' && st.introSec > limits.intro);
  }
  function go(stage: DrillState['stage']) {
    st.stage = stage;
    persist();
    apply();
    if (stage === 'intro') introBox.querySelector('textarea')!.focus();
  }

  const box = el('div', { class: 'w-drill', dataset: { group: g.id } },
    el('p', { class: 'drill-note' }, exam
      ? `Drill: ${g.planTimeMin} minutes to plan, then ${g.introTimeMin} minutes for the introduction. Each part closes when its time is up.`
      : `Drill: ${g.planTimeMin} minutes to plan, then ${g.introTimeMin} minutes for the introduction. The timers run while this task is on screen.`),
    planStage, introStage);
  let ticks = 0;
  ctx.everySecond(running => {
    if (ctx.readonly || st.stage === 'done' || !running || !onScreen(box)) return;
    if (st.stage === 'plan') {
      st.planSec++;
      if (st.planSec === limits.plan) { ctx.flash('Plan time is up — now write the introduction.'); if (exam) go('intro'); }
    } else {
      st.introSec++;
      if (st.introSec === limits.intro) { ctx.flash('Introduction time is up.'); if (exam) go('done'); }
    }
    if (++ticks % 5 === 0) persist();
    apply();
  });
  apply();
  return box;
}

/* ======================================================================
   Speaking: recorder (+ optional live transcript)
   ====================================================================== */
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
const SpeechRec = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
const TRANSCRIBE_KEY = 'ielts-transcribe';
export const canTranscribe = () => !!SpeechRec;
const transcribeOn = () => canTranscribe() && local.get(TRANSCRIBE_KEY) === '1';
const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export interface RecorderHandle { el: HTMLElement; start(): Promise<boolean>; stop(): void; isRecording(): boolean }

interface SilenceStats { pausesOver3s: number; longestPauseSec: number; speakingSec: number }

/**
 * Listens to the microphone while recording (ielts-site-spec.md item 10): silences between speech longer than 3 s,
 * the longest silence, and the time spent speaking. The level that counts as silence follows the room's noise.
 * Silence before the first word and after the last one is not counted.
 */
function silenceMeter(stream: MediaStream): { stop(): SilenceStats } | null {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  let ac: AudioContext;
  try { ac = new AC(); } catch { return null; }
  const analyser = ac.createAnalyser();
  analyser.fftSize = 2048;
  ac.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const STEP = 0.1;
  let noise = 0.02, spoke = false, silent = 0, pauses = 0, longest = 0, speaking = 0;
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    // the noise floor drops at once to a quieter level and rises only slowly
    noise = rms < noise ? rms : noise * 0.995 + rms * 0.005;
    if (rms > Math.max(0.012, noise * 2.5)) {
      if (spoke && silent > 0) { if (silent > 3) pauses++; longest = Math.max(longest, silent); }
      spoke = true; silent = 0; speaking += STEP;
    } else if (spoke) silent += STEP;
  }, STEP * 1000);
  return {
    stop() {
      clearInterval(timer);
      void ac.close().catch(() => {});
      return { pausesOver3s: pauses, longestPauseSec: Math.round(longest * 10) / 10, speakingSec: Math.round(speaking * 10) / 10 };
    }
  };
}

export function recorder(ctx: RenderCtx, itemId: string, o: { maxSec: number; onTranscript?: (text: string) => void; onStop?: () => void }): RecorderHandle {
  const status = el('span', { class: 'rec-status' });
  const interim = el('div', { class: 'rec-interim' });
  const player = el('div', { class: 'rec-player' });
  const startBtn = el('button', { class: 'btn-ex rec-start', onclick: () => void start() }, '● Record');
  const stopBtn = el('button', { class: 'btn-ex rec-stop', hidden: true, onclick: () => stop() }, '■ Stop');
  const retryBtn = el('button', { class: 'btn-ex', hidden: true, onclick: () => void upload() }, 'Try saving again');
  const box = el('div', { class: 'rec no-hl', dataset: { item: itemId } }, el('div', { class: 'rec-row' }, startBtn, stopBtn, retryBtn, status), interim, player);

  let mr: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let rec: SpeechRecognitionLike | null = null;
  let chunks: Blob[] = [];
  let blob: Blob | null = null;
  let t0 = 0, duration = 0;
  let meter: { stop(): SilenceStats } | null = null;
  let stats: SilenceStats | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;

  function drawPlayer() {
    const r: RecordingInfo | undefined = ctx.recordings[itemId];
    if (!r) { player.replaceChildren(ctx.readonly ? el('span', { class: 'muted' }, 'No recording.') : ''); return; }
    player.replaceChildren(
      el('audio', { controls: true, preload: 'none', src: r.url }),
      el('span', { class: 'muted' }, r.durationSec ? ` ${formatClock(r.durationSec)}` : ''),
      ctx.readonly ? '' : el('button', {
        class: 'icon-ex', title: 'Delete this recording', onclick: async () => {
          if (!await confirmDialog('Delete this recording?', { ok: 'Delete', danger: true })) return;
          try { await api(`/attempts/${ctx.attemptId}/recordings/${encodeURIComponent(itemId)}`, { method: 'DELETE' }); delete ctx.recordings[itemId]; drawPlayer(); startBtn.textContent = '● Record'; }
          catch (e) { status.textContent = (e as Error).message; }
        }
      }, '🗑'));
    startBtn.textContent = '● Record again';
  }

  function release() {
    clearInterval(timer);
    if (meter) { stats = meter.stop(); meter = null; }
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
    if (rec) { rec.onend = null; try { rec.abort(); } catch { /* already stopped */ } rec = null; }
    interim.textContent = '';
  }

  function startTranscript() {
    if (!transcribeOn() || !SpeechRec || !o.onTranscript) return;
    rec = new SpeechRec();
    rec.lang = 'en-GB';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!;
        if (r.isFinal) o.onTranscript!(r[0].transcript.trim());
        else partial += r[0].transcript;
      }
      interim.textContent = partial ? `… ${partial}` : '';
    };
    rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') interim.textContent = `Live transcript stopped (${e.error}). The recording goes on.`; };
    // Chrome ends recognition after a silence: start it again while recording
    rec.onend = () => { if (mr?.state === 'recording' && rec) { try { rec.start(); } catch { /* ignore */ } } };
    try { rec.start(); } catch { rec = null; }
  }

  async function start(): Promise<boolean> {
    if (ctx.readonly || mr?.state === 'recording') return false;
    if (!canRecord()) { status.textContent = 'This browser cannot record. Type what you said instead.'; return false; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      status.textContent = 'The microphone is blocked. Allow it in the browser (the icon in the address bar), or type what you said.';
      return false;
    }
    const mimeType = MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m));
    mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      duration = (Date.now() - t0) / 1000;
      blob = new Blob(chunks, { type: (mr?.mimeType || mimeType || 'audio/webm') });
      release();
      startBtn.hidden = false; stopBtn.hidden = true;
      box.classList.remove('recording');
      o.onStop?.();
      void upload();
    };
    mr.start(1000);
    t0 = Date.now();
    stats = null;
    meter = silenceMeter(stream);
    startBtn.hidden = true; stopBtn.hidden = false; retryBtn.hidden = true;
    box.classList.add('recording');
    const tick = () => {
      const s = (Date.now() - t0) / 1000;
      status.textContent = `● Recording ${formatClock(s)} / ${formatClock(o.maxSec)}`;
      if (s >= o.maxSec) stop();
    };
    tick();
    timer = setInterval(tick, 500);
    startTranscript();
    return true;
  }

  function stop() { if (mr?.state === 'recording') mr.stop(); }

  async function upload() {
    if (!blob) return;
    if (blob.size > RECORDING_MAX_BYTES) { status.textContent = 'The recording is too long to save.'; return; }
    retryBtn.hidden = true;
    status.textContent = 'Saving the recording…';
    try {
      const extra = stats ? `&pauses=${stats.pausesOver3s}&longestPause=${stats.longestPauseSec}&speaking=${stats.speakingSec}` : '';
      const r = await uploadTo<RecordingInfo>(`/api/attempts/${ctx.attemptId}/recordings?item=${encodeURIComponent(itemId)}&duration=${Math.round(duration)}${extra}`, blob, blob.type.split(';')[0] || 'audio/webm',
        p => { status.textContent = `Saving the recording… ${Math.round(p * 100)}%`; }).done;
      ctx.recordings[itemId] = r;
      blob = null;
      status.textContent = '✓ Recording saved';
      drawPlayer();
    } catch (e) {
      status.textContent = e instanceof ApiError ? e.message : 'Could not save the recording (offline?).';
      retryBtn.hidden = false;
    }
  }

  if (ctx.readonly) { startBtn.hidden = true; }
  drawPlayer();
  ctx.onDestroy(() => { if (mr?.state === 'recording') { mr.onstop = null; mr.stop(); } release(); });
  return { el: box, start, stop, isRecording: () => mr?.state === 'recording' };
}

/** the "write down what I say" switch (a setting of this device) */
export function transcribeSwitch(): HTMLElement | null {
  if (!canTranscribe()) return null;
  const input = el('input', { type: 'checkbox', checked: transcribeOn(), onchange: (e: Event) => local.set(TRANSCRIBE_KEY, (e.target as HTMLInputElement).checked ? '1' : '0') });
  return el('label', { class: 'transcribe-switch no-hl' }, input,
    el('span', null, el('b', null, 'Write down what I say'), ' while recording, so Claude can read it. ',
      el('small', null, 'Uses the browser\'s speech recognition (in Chrome and Edge the sound goes to Google or Microsoft). Check the text afterwards.')));
}

function answerBox(ctx: RenderCtx, id: string, label: string): { box: HTMLElement; append: (t: string) => void } {
  const v = ctx.answers[id];
  const ta = el('textarea', {
    class: 'w-text sp-notes', rows: 3, placeholder: 'What you said — type it, or let the transcript fill it in', value: typeof v === 'string' ? v : '', disabled: ctx.readonly,
    oninput: () => ctx.setAnswer(id, ta.value)
  });
  return {
    box: el('div', { class: 'sp-answer' }, el('div', { class: 'w-label' }, label), ta),
    append: t => { if (!t) return; ta.value = ta.value ? `${ta.value.replace(/\s+$/, '')} ${t}` : t; ctx.setAnswer(id, ta.value); }
  };
}

function questionItem(ctx: RenderCtx, id: string, text: string, maxSec: number): HTMLElement {
  const ans = answerBox(ctx, id, 'What you said');
  const r = recorder(ctx, id, { maxSec, onTranscript: ans.append });
  return el('div', { class: 'sp-item' }, el('div', { class: 'q-text', html: inlineMd(text) }), r.el, ans.box);
}

/* ======================================================================
   Speaking groups (Part 1, Part 2 long turn with timers, Part 3)
   ====================================================================== */
export function speakingGroup(ctx: RenderCtx, g: QuestionGroup): HTMLElement {
  const box = el('div', { class: 'q-group sp-group', dataset: { group: g.id } });
  const titles: Record<string, string> = { speaking_part1: 'Part 1 — Introduction and interview', speaking_part2: 'Part 2 — Long turn', speaking_part3: 'Part 3 — Discussion' };
  box.appendChild(el('h3', { class: 'q-range' }, titles[g.type] ?? g.type));
  if ('instructions' in g && g.instructions) box.appendChild(el('div', { class: 'q-instr', html: mdBlock(g.instructions) }));
  if (!ctx.readonly) { const sw = transcribeSwitch(); if (sw) box.appendChild(sw); }
  if (g.type === 'speaking_part1' || g.type === 'speaking_part3') {
    if (g.topic) box.appendChild(el('h4', { class: 'q-title' }, g.topic));
    g.questions.forEach(q => box.appendChild(questionItem(ctx, q.id, q.text, g.type === 'speaking_part1' ? 90 : 180)));
  } else if (g.type === 'speaking_part2') {
    box.appendChild(longTurn(ctx, g));
    if (g.followUps.length) box.appendChild(el('h4', { class: 'q-title' }, 'Rounding-off questions'));
    g.followUps.forEach(q => box.appendChild(questionItem(ctx, q.id, q.text, 90)));
  }
  return box;
}

function longTurn(ctx: RenderCtx, g: Extract<QuestionGroup, { type: 'speaking_part2' }>): HTMLElement {
  type Stage = 'ready' | 'prep' | 'talk' | 'done';
  let stage: Stage = ctx.recordings[g.id] || ctx.readonly ? 'done' : 'ready';
  let left = 0;
  const prepKey = `prep:${g.id}`;
  const notes = el('textarea', {
    class: 'w-text sp-notes', rows: 4, placeholder: 'Notes for your talk (you have one minute)', disabled: ctx.readonly,
    value: typeof ctx.state[prepKey] === 'string' ? ctx.state[prepKey] as string : '',
    oninput: () => ctx.setState(prepKey, notes.value.slice(0, 4000))
  });
  const ans = answerBox(ctx, g.id, 'What you said');
  const rec = recorder(ctx, g.id, { maxSec: g.talkTimeSec + 30, onTranscript: ans.append, onStop: () => { if (stage === 'talk') setStage('done'); } });
  const clock = el('div', { class: 'lt-clock' });
  const action = el('button', { class: 'btn-ex btn-ex-primary', onclick: () => next() });
  const card = el('div', { class: 'cue-card' },
    el('p', { class: 'cue-topic', html: inlineMd(g.cueCard.topic) }),
    el('p', null, 'You should say:'),
    el('ul', null, g.cueCard.bullets.map(b => el('li', { html: inlineMd(b) }))),
    g.cueCard.closing ? el('p', { html: inlineMd(g.cueCard.closing) }) : null);
  const box = el('div', { class: 'long-turn' }, card,
    el('div', { class: 'lt-bar no-hl' }, action, clock),
    el('div', { class: 'w-label' }, 'Your notes'), notes, rec.el, ans.box);

  function setStage(s: Stage) {
    stage = s;
    if (s === 'prep') left = g.prepTimeSec;
    if (s === 'talk') { left = g.talkTimeSec; void rec.start(); }
    if (s === 'done' && rec.isRecording()) rec.stop();
    draw();
  }
  function next() { setStage(stage === 'ready' ? 'prep' : stage === 'prep' ? 'talk' : stage === 'talk' ? 'done' : 'prep'); }
  function draw() {
    box.dataset.stage = stage;
    action.hidden = ctx.readonly;
    action.textContent = stage === 'ready' ? `▶ Start the ${Math.round(g.prepTimeSec / 60)}-minute preparation`
      : stage === 'prep' ? 'I\'m ready — start talking' : stage === 'talk' ? '■ Stop talking' : '↻ Do the long turn again';
    clock.textContent = stage === 'prep' ? `Preparation: ${formatClock(left)}` : stage === 'talk' ? `Talk: ${formatClock(left)} left` : stage === 'done' && !ctx.readonly ? 'Done. Listen to your recording, then go on.' : '';
    clock.classList.toggle('low', (stage === 'prep' || stage === 'talk') && left <= 10);
  }
  ctx.everySecond(running => {
    if (!running || (stage !== 'prep' && stage !== 'talk')) return;
    left--;
    if (left <= 0) {
      if (stage === 'prep') { ctx.flash('Preparation time is over — start talking now.'); setStage('talk'); }
      else { ctx.flash('Two minutes are up. Thank you.'); setStage('done'); }
      return;
    }
    draw();
  });
  draw();
  return box;
}

/* ======================================================================
   Listening without a recording: read the transcript aloud
   ====================================================================== */
const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
const VOICE_KEY = 'ielts-tts-voice';
const RATE_KEY = 'ielts-tts-rate';

function englishVoices(): SpeechSynthesisVoice[] {
  const order = ['en-GB', 'en-AU', 'en-IE', 'en-NZ', 'en-CA', 'en-US'];
  const rank = (v: SpeechSynthesisVoice) => { const i = order.findIndex(o => v.lang.replace('_', '-').startsWith(o)); return i < 0 ? order.length : i; };
  return (synth?.getVoices() ?? []).filter(v => /^en([-_]|$)/i.test(v.lang)).sort((a, b) => rank(a) - rank(b));
}
const voicesReady = () => new Promise<void>(resolve => {
  if (!synth || synth.getVoices().length) { resolve(); return; }
  const done = () => { synth.removeEventListener('voiceschanged', done); resolve(); };
  synth.addEventListener('voiceschanged', done);
  setTimeout(done, 1500);
});

export function speechPlayer(ctx: RenderCtx, part: Part): HTMLElement {
  const exam = ctx.mode === 'exam' && !ctx.readonly;
  const stateKey = `tts:${part.id}`;
  let lines: SpeechLine[] | null = null;
  let from = 0, total = 0, idx = 0;
  let playing = false, finished = false;
  const savedLine = (ctx.state[stateKey] as { line?: number } | undefined)?.line;

  const status = el('span', { class: 'tts-status' });
  const playBtn = el('button', { class: 'btn-ex btn-ex-primary', onclick: () => void play() });
  const pauseBtn = el('button', { class: 'btn-ex', hidden: true, onclick: () => pause() }, '⏸ Pause');
  // silences: the reading time before the part, and "[pause 30]" in the transcript
  let silenceLeft: number | null = null;
  let silenceTimer: ReturnType<typeof setInterval> | undefined;
  const stopSilence = () => { if (silenceTimer) clearInterval(silenceTimer); silenceTimer = undefined; silenceLeft = null; };
  const skipBtn = el('button', { class: 'btn-ex', hidden: true, title: 'Skip the silence', onclick: () => { stopSilence(); idx++; speak(); } }, '⏭ Skip');
  const backBtn = el('button', { class: 'btn-ex', title: 'Back one sentence', hidden: exam, onclick: () => { idx = Math.max(from, idx - 1); if (playing) speak(); else draw(); } }, '⏮');
  const restartBtn = el('button', { class: 'btn-ex', title: 'From the start', hidden: exam, onclick: () => { idx = from; finished = false; if (playing) speak(); else draw(); } }, '⟲');
  const rate = el('select', { class: 'aud-select', title: 'Speed', hidden: exam, onchange: () => local.set(RATE_KEY, rate.value) },
    ['0.8', '0.9', '1', '1.1', '1.2'].map(v => el('option', { value: v, selected: v === (local.get(RATE_KEY) ?? '1') }, `${v}×`)));
  const voiceSel = el('select', { class: 'aud-select', title: 'Voice', hidden: exam, onchange: () => local.set(VOICE_KEY, voiceSel.value) });
  const bar = el('div', { class: 'tts no-hl' },
    el('span', { class: 'aud-icon' }, '🔈'),
    el('div', { class: 'tts-text' }, el('b', null, 'Listening — read aloud by your browser'), status),
    el('div', { class: 'tts-controls' }, playBtn, pauseBtn, skipBtn, backBtn, restartBtn, rate, voiceSel));

  if (!synth) {
    status.textContent = 'This browser cannot read text aloud. Try Chrome, Edge or Safari.';
    playBtn.hidden = true;
    return bar;
  }
  void voicesReady().then(() => {
    const vs = englishVoices();
    voiceSel.replaceChildren(el('option', { value: '' }, 'Voices: one per speaker'), ...vs.map(v => el('option', { value: v.name, selected: v.name === local.get(VOICE_KEY) }, `${v.name} (${v.lang})`)));
  });

  function draw() {
    const heard = exam && savedLine !== undefined && lines === null && savedLine > 0;
    playBtn.hidden = playing || (exam && finished);
    playBtn.textContent = exam ? (heard ? '▶ Carry on listening' : '▶ Start listening') : finished ? '▶ Play again' : idx > from ? '▶ Resume' : '▶ Play';
    pauseBtn.hidden = !playing || exam;
    skipBtn.hidden = exam || silenceLeft === null;
    if (silenceLeft !== null) {
      status.textContent = idx - from <= 1 && lines?.[0]?.text.startsWith('You now have') ? `Look at the questions — ${silenceLeft} s` : `Pause — ${silenceLeft} s`;
      return;
    }
    status.textContent = finished ? (exam ? 'You have heard this part. In exam mode each part plays once.' : 'Finished.')
      : lines ? `${playing ? 'Playing' : 'Paused'} — sentence ${Math.min(idx + 1, total)} of ${total}`
      : exam ? (heard ? 'Stopped part-way — it carries on from where it stopped.' : 'In exam mode each part plays once, like the real test.')
      : 'Press play to hear the recording.';
  }

  async function load(): Promise<boolean> {
    if (lines) return true;
    try {
      if (ctx.readonly && part.transcript) { lines = partSpeech(part, listItems([part]).flatMap(i => i.numbers)); from = 0; total = lines.length; }
      else {
        const r = await api<SpeechResponse>(`/attempts/${ctx.attemptId}/speech/${encodeURIComponent(part.id)}`);
        lines = r.lines; from = r.from; total = r.total;
      }
      idx = from;
      if (from >= total) finished = true;
      return true;
    } catch (e) {
      status.textContent = (e as Error).message;
      return false;
    }
  }

  const speakers: string[] = [];
  function voiceFor(speaker: string | null): { voice: SpeechSynthesisVoice | null; pitch: number } {
    const vs = englishVoices();
    const chosen = vs.find(v => v.name === voiceSel.value);
    if (chosen || !vs.length) return { voice: chosen ?? null, pitch: 1 };
    const isNarrator = !speaker || /narrat|announc|presenter/i.test(speaker);
    if (isNarrator) return { voice: vs[0]!, pitch: 1 };
    if (!speakers.includes(speaker)) speakers.push(speaker);
    const k = speakers.indexOf(speaker) + 1;
    // when there are fewer voices than speakers, a different pitch keeps them apart
    return { voice: vs[k % vs.length]!, pitch: vs.length > k ? 1 : [1.12, 0.88, 1.2, 0.8][k % 4]! };
  }

  function speak() {
    if (!lines || !synth) return;
    synth.cancel();
    if (idx >= from + lines.length) {
      playing = false; finished = true;
      if (exam) ctx.setState(stateKey, { line: total });
      draw();
      return;
    }
    const line = lines[idx - from]!;
    if (line.pauseSec) {
      stopSilence();
      silenceLeft = line.pauseSec;
      if (exam) ctx.setState(stateKey, { line: idx });
      const mine = idx;
      silenceTimer = setInterval(() => {
        if (!playing || idx !== mine) { stopSilence(); draw(); return; }
        silenceLeft = (silenceLeft ?? 1) - 1;
        if (silenceLeft <= 0) { stopSilence(); idx++; speak(); } else draw();
      }, 1000);
      draw();
      return;
    }
    const u = new SpeechSynthesisUtterance(line.text);
    const v = voiceFor(line.speaker);
    if (v.voice) u.voice = v.voice;
    u.lang = v.voice?.lang ?? 'en-GB';
    u.pitch = v.pitch;
    u.rate = exam ? 1 : Number(rate.value) || 1;
    const mine = idx;
    u.onend = () => { if (playing && idx === mine) { idx++; speak(); } };
    u.onerror = e => { if (e.error !== 'interrupted' && e.error !== 'canceled' && playing && idx === mine) { idx++; speak(); } };
    if (exam) ctx.setState(stateKey, { line: idx });
    synth.speak(u);
    draw();
  }

  async function play() {
    if (!await load()) return;
    if (finished && !exam) { idx = from; finished = false; }
    if (finished) { draw(); return; }
    playing = true;
    speak();
  }
  function pause() { playing = false; stopSilence(); synth?.cancel(); draw(); }

  // the practice pause button stops the voice too
  ctx.everySecond(() => { if (playing && ctx.paused()) pause(); });
  ctx.onDestroy(() => { playing = false; stopSilence(); synth?.cancel(); });
  draw();
  return bar;
}
