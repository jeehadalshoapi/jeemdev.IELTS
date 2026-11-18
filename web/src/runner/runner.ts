/*
 * The test runner (converted from the old js/exam.js), now backed by the server:
 * answers, flags, highlights and position autosave, and the clock comes from the server.
 */
import { listItems, sectionSkillOf, type AnswerValue, type AttemptView, type Part, type QuestionResult, type ResultView, type SaveResult, type SectionSkill, type Timing } from '@ielts/shared';
import { api, ApiError } from '../lib/api';
import { $, $$, el } from '../lib/dom';
import { formatClock, wordCount } from '../lib/format';
import { mdBlock } from '../lib/markup';
import { confirmDialog, modal, toast } from '../lib/ui';
import { applySettings, openHelp, openNotes, openSettings, saveSettings, startAudio, toggleFullscreen, type AudioHandle } from './panels';
import { rangeText, renderPart, showTab, type RenderCtx } from './render';
import { AttemptSync, type SyncStatus } from './sync';
import { Tools, type SavedHighlight } from './tools';

interface Slot { num: number; partIndex: number; qid: string; sub: number; type: string }

const isAnswered = (v: AnswerValue | undefined) =>
  v !== null && v !== undefined && (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) ? v.length > 0 : Object.values(v).some(x => typeof x === 'string' && x.trim()));

export interface RunnerHandle { destroy(): void; canLeave(): Promise<boolean> }

export async function mountRunner(root: HTMLElement, attemptId: string): Promise<RunnerHandle> {
  const view = await api<AttemptView>(`/attempts/${attemptId}`);
  if (view.attempt.status !== 'in_progress') {
    location.replace(`#/result/${attemptId}`);
    return { destroy() {}, canLeave: async () => true };
  }
  return new Runner(root, view).handle();
}

/** the submitted test, read-only, with every answer marked right or wrong and transcripts shown */
export async function mountReview(root: HTMLElement, attemptId: string): Promise<RunnerHandle> {
  const r = await api<ResultView>(`/attempts/${attemptId}/result`);
  const view: AttemptView = {
    attempt: { id: r.attempt.id, testId: r.attempt.testId, status: r.attempt.status, mode: r.attempt.mode, answers: r.attempt.answers, state: r.attempt.state, startedAt: r.attempt.startedAt, submittedAt: r.attempt.submittedAt, autoSubmitted: r.attempt.autoSubmitted },
    test: r.test,
    timing: { limitSec: null, remainingSec: null, deadline: null, serverNow: new Date().toISOString(), spentSec: r.attempt.timeSpentSec },
    recordings: r.recordings ?? {}
  };
  return new Runner(root, view, r).handle();
}

class Runner {
  private readonly test: AttemptView['test'];
  private readonly parts: Part[];
  private readonly sections: SectionSkill[];
  private readonly mode: AttemptView['attempt']['mode'];
  private readonly answers: Record<string, AnswerValue>;
  private readonly slots: Slot[] = [];
  private readonly numEls = new Map<number, HTMLElement>();
  private readonly flags = new Set<number>();
  private readonly sync: AttemptSync;
  private readonly cd: HTMLElement;
  private tools!: Tools;
  private audio: AudioHandle | null = null;
  private part = 0;
  private current: number | null = null;
  private timing: Timing;
  private serverOffset = 0;
  private paused = false;
  private finished = false;
  private timerHidden = false;
  private warned = new Set<number>();
  private practiceTimeUpShown = false;
  private intervals: Array<ReturnType<typeof setInterval>> = [];
  private bannerTimer: ReturnType<typeof setTimeout> | undefined;
  private els!: { timer: HTMLButtonElement; sync: HTMLElement; partBar: HTMLElement; banner: HTMLElement; nav: HTMLElement; audioBar: HTMLElement | null };
  private readonly listeners: Array<[EventTarget, string, EventListener]> = [];
  private readonly tickers: Array<(running: boolean) => void> = [];
  private readonly cleanups: Array<() => void> = [];
  private readonly state: Record<string, unknown>;

  private readonly results = new Map<number, QuestionResult>();

  constructor(private readonly root: HTMLElement, private readonly view: AttemptView, private readonly review: ResultView | null = null) {
    if (review) for (const q of review.autoScore.questions) this.results.set(q.number, q);
    this.test = view.test;
    this.parts = view.test.content.parts;
    this.sections = this.parts.map(p => sectionSkillOf(p, view.test.skill) ?? 'reading');
    this.mode = view.attempt.mode;
    this.answers = { ...view.attempt.answers };
    this.timing = view.timing;
    this.serverOffset = Date.parse(view.timing.serverNow) - Date.now();
    for (const item of listItems(this.parts)) {
      const pi = this.parts.findIndex(p => p.id === item.partId);
      item.numbers.forEach((num, sub) => this.slots.push({ num, partIndex: pi, qid: item.id, sub, type: item.type }));
    }
    this.slots.sort((a, b) => a.num - b.num);
    const st = view.attempt.state;
    this.state = { ...st };
    if (Array.isArray(st.flags)) for (const n of st.flags) if (typeof n === 'number') this.flags.add(n);

    this.sync = new AttemptSync(view.attempt.id, {
      onSaved: r => this.onSaved(r),
      onStatus: s => this.drawSync(s),
      onClosed: code => this.closedByServer(code)
    });
    // changes made on this device while offline that never reached the server
    const buffered = review ? null : this.sync.takeBuffer();
    if (buffered) Object.assign(this.answers, buffered.answers);

    this.cd = this.build();
    root.appendChild(this.cd);
    for (const [k, v] of Object.entries(st)) {
      if (!k.startsWith('hl:')) continue;
      const zone = $(`[data-zone="${CSS.escape(k.slice(3))}"]`, this.cd);
      if (zone) this.tools.restore(zone, v as SavedHighlight[]);
    }
    const pos = st.pos as { partId?: string; number?: number } | undefined;
    const startPart = Math.max(0, this.parts.findIndex(p => p.id === pos?.partId));
    this.showPart(startPart);
    if (pos?.number && this.numEls.has(pos.number)) setTimeout(() => this.goTo(pos.number!, false), 50);
    if (buffered) void this.sync.flush();

    const tracks = this.parts.map((p, i) => ({ partIndex: i, url: p.audioUrl ?? '', title: p.title })).filter(t => t.url);
    if (this.els.audioBar && tracks.length) {
      this.audio = startAudio(this.els.audioBar, tracks, {
        // in review the recording can be replayed and scrubbed freely
        practice: this.mode === 'practice' || !!review,
        resume: review ? undefined : (st.audio as { track: number; time: number } | undefined),
        onTrackChange: pi => this.showPart(pi)
      });
      if (review) this.audio?.audio.pause();
    }
    this.on(document, 'keydown', e => {
      const k = e as KeyboardEvent;
      if (k.altKey && k.key === 'ArrowRight') { k.preventDefault(); this.step(1); }
      if (k.altKey && k.key === 'ArrowLeft') { k.preventDefault(); this.step(-1); }
    });
    if (review) {
      this.finished = true;
      this.applyReview();
      return;
    }
    this.intervals.push(setInterval(() => this.tick(), 1000));
    this.intervals.push(setInterval(() => {
      if (this.audio) this.sync.setState('audio', this.audio.position());
      void this.sync.flush();
    }, 10_000));
    this.on(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden') void this.sync.flush({ keepalive: true }); });
    this.on(window, 'pagehide', () => { void this.sync.flush({ keepalive: true }); });
    this.drawTimer();
  }

  /** review mode: colour every question and show the correct answer */
  private applyReview(): void {
    const done = new Set<string>();
    for (const q of this.results.values()) {
      const holder = this.numEls.get(q.number);
      if (!holder) continue;
      if (q.type === 'mcq_multi') {
        if (done.has(q.questionId)) continue;
        done.add(q.questionId);
        const all = [...this.results.values()].filter(x => x.questionId === q.questionId);
        const key = new Set(q.correctAnswers.map(a => a.toUpperCase()));
        const chosen = new Set(all.map(x => x.answer).filter((x): x is string => !!x));
        holder.classList.add(all.every(x => x.correct) ? 'rv-ok' : 'rv-bad');
        $$('.choice', holder).forEach(c => {
          const v = c.dataset.value ?? '';
          if (key.has(v)) c.classList.add('rv-correct-opt'); else if (chosen.has(v)) c.classList.add('rv-wrong-opt');
        });
        holder.appendChild(el('span', { class: 'rv-key no-hl' }, `${all.filter(x => x.correct).length} of ${all.length} correct · answer: ${q.correctAnswers.join(', ')}`));
        continue;
      }
      holder.classList.add(q.correct ? 'rv-ok' : 'rv-bad');
      const choices = $$('.choice', holder);
      if (choices.length) {
        choices.forEach(c => {
          const v = (c.dataset.value ?? '').toLowerCase();
          if (q.correctAnswers.some(a => a.toLowerCase() === v)) c.classList.add('rv-correct-opt');
          else if (q.answer && q.answer.toLowerCase() === v) c.classList.add('rv-wrong-opt');
        });
        if (!q.answer) holder.appendChild(el('span', { class: 'rv-key no-hl' }, 'Not answered'));
      } else {
        const why = q.correct ? '✓' : q.reason === 'over_word_limit' ? '✗ over the word limit ·' : q.reason === 'likely_spelling' ? '✗ spelling ·' : q.reason === 'blank' ? '✗ not answered ·' : '✗';
        holder.appendChild(el('span', { class: 'rv-key no-hl', title: q.note ?? '' }, `${why} ${q.correctAnswers.join(' / ')}`));
      }
    }
    this.updateNav();
  }

  private on(target: EventTarget, type: string, fn: EventListener): void {
    target.addEventListener(type, fn);
    this.listeners.push([target, type, fn]);
  }

  handle(): RunnerHandle {
    return {
      destroy: () => this.destroy(),
      canLeave: async () => {
        if (this.finished) return true;
        if (this.mode === 'exam' && this.timing.limitSec !== null) {
          const ok = await confirmDialog('In exam mode the clock keeps running while you are away, like the real test. Your answers are saved. Leave the test?', { ok: 'Leave', cancel: 'Stay' });
          if (!ok) return false;
        }
        await this.sync.flush();
        return true;
      }
    };
  }

  private destroy(): void {
    this.intervals.forEach(clearInterval);
    for (const fn of this.cleanups) { try { fn(); } catch { /* ignore */ } }
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    if (!this.finished) void this.sync.flush({ keepalive: true });
    this.sync.stop();
    this.audio?.stop();
    this.tools?.destroy();
    $$('.modal-overlay').forEach(m => m.remove());
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }

  /* ---------- layout ---------- */
  private ctx(): RenderCtx {
    const self = this;
    return {
      attemptId: this.view.attempt.id,
      mode: this.mode,
      answers: this.answers,
      state: this.state,
      setState: (key, value) => { self.state[key] = value; if (!self.review) self.sync.setState(key, value); },
      recordings: { ...(this.view.recordings ?? {}) },
      everySecond: fn => { self.tickers.push(fn); },
      paused: () => self.paused,
      onDestroy: fn => { self.cleanups.push(fn); },
      readonly: !!this.review,
      picked: null,
      afterRender: [],
      setAnswer: (qid, v) => self.setAnswer(qid, v),
      registerNum: (n, h) => { if (!self.numEls.has(n)) self.numEls.set(n, h); },
      flash: msg => self.flash(msg),
      root: () => self.cd
    };
  }

  private build(): HTMLElement {
    const t = this.test;
    const cd = el('div', { class: `cd mod-${t.skill}` });
    applySettings(cd);
    const timer = el('button', { class: 'cd-timer', title: 'Click to hide / show the time', onclick: () => { this.timerHidden = !this.timerHidden; this.drawTimer(); } });
    const sync = el('span', { class: 'cd-sync saved', title: 'Saved' });
    const pause = this.mode === 'practice' ? el('button', { class: 'cd-icon', title: 'Pause', onclick: () => this.setPaused(true) }, '⏸') : null;
    cd.appendChild(el('header', { class: 'cd-top no-hl' },
      el('div', { class: 'cd-left' },
        el('a', { class: 'cd-logo', href: '#/', title: 'Dashboard' }, 'IELTS'),
        el('div', { class: 'cd-cand' }, el('b', null, this.review ? 'Answer review' : this.mode === 'exam' ? 'Exam mode' : 'Practice mode'), el('small', null, t.title))),
      el('div', { class: 'cd-center' }, ...(this.review ? [el('span', { class: 'cd-review-tag' }, `✓ ${this.review.autoScore.total ? `${this.review.autoScore.raw} / ${this.review.autoScore.total} correct` : 'Answer review'}`)] : [timer, sync, pause])),
      el('div', { class: 'cd-right' },
        el('button', { class: 'cd-icon', title: 'Notes', onclick: () => openNotes(this.tools.notes(), m => this.goToMark(m)) }, '📝', el('span', { class: 'cd-icon-label' }, 'Notes')),
        el('button', { class: 'cd-icon', title: 'Settings: text size and colours', onclick: () => openSettings(cd) }, '⚙', el('span', { class: 'cd-icon-label' }, 'Settings')),
        el('button', { class: 'cd-icon', title: 'Help', onclick: () => openHelp(this.mode) }, '?', el('span', { class: 'cd-icon-label' }, 'Help')),
        el('button', { class: 'cd-icon', title: 'Full screen', onclick: toggleFullscreen }, '⛶'),
        this.review ? el('a', { class: 'btn btn-sm', href: `#/result/${this.view.attempt.id}` }, '← Results') : null)));
    const audioBar = this.sections.includes('listening') && this.parts.some(p => p.audioUrl) ? el('div', { class: 'cd-audio no-hl' }) : null;
    if (audioBar) cd.appendChild(audioBar);
    const partBar = el('div', { class: 'cd-partbar no-hl' });
    const banner = el('div', { class: 'cd-banner hidden', role: 'status' });
    cd.append(partBar, banner);

    const ctx = this.ctx();
    const partsBox = el('div', { class: 'cd-parts' });
    this.parts.forEach((p, pi) => {
      const earlierRecording = this.parts.slice(0, pi).some((q, qi) => this.sections[qi] === 'listening' && !!q.audioUrl);
      partsBox.appendChild(renderPart(ctx, p, pi, this.sections[pi]!, earlierRecording));
    });
    cd.appendChild(partsBox);
    const nav = el('footer', { class: 'cd-nav no-hl' });
    cd.appendChild(nav);
    this.els = { timer, sync, partBar, banner, nav, audioBar };

    // after the DOM exists
    queueMicrotask(() => ctx.afterRender.forEach(fn => fn()));
    this.tools = new Tools(cd, zone => { if (!this.review) this.sync.setState(`hl:${zone.dataset.zone}`, this.tools.serialize(zone)); });
    this.bindLayout(cd);
    return cd;
  }

  private bindLayout(cd: HTMLElement): void {
    const track = (e: Event) => {
      const h = (e.target as Element).closest<HTMLElement>('[data-num]');
      if (!h || !/^\d+$/.test(h.dataset.num ?? '')) return;
      const n = Number(h.dataset.num);
      if (this.current !== n) { this.current = n; this.updateNav(); this.savePos(); }
    };
    cd.addEventListener('focusin', track);
    cd.addEventListener('click', track);
    cd.addEventListener('pointerdown', e => {
      const d = (e.target as Element).closest<HTMLElement>('.divider');
      if (!d) return;
      e.preventDefault();
      const rect = d.parentElement!.getBoundingClientRect();
      d.classList.add('dragging');
      const move = (ev: PointerEvent) => cd.style.setProperty('--left', `${Math.max(20, Math.min(80, ((ev.clientX - rect.left) / rect.width) * 100))}%`);
      const up = () => {
        d.classList.remove('dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        saveSettings({ split: parseFloat(cd.style.getPropertyValue('--left')) || 50 });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    cd.addEventListener('dblclick', e => { if ((e.target as Element).closest('.divider')) { cd.style.setProperty('--left', '50%'); saveSettings({ split: 50 }); } });
  }

  /* ---------- answers ---------- */
  private setAnswer(qid: string, v: AnswerValue): void {
    this.answers[qid] = v;
    this.sync.setAnswer(qid, v);
    this.updateNav();
  }

  private savePos(): void {
    if (this.review) return;
    this.sync.setState('pos', { partId: this.parts[this.part]?.id, ...(this.current ? { number: this.current } : {}) });
  }

  /* ---------- navigation ---------- */
  private partRange(pi: number): number[] { return this.slots.filter(s => s.partIndex === pi).map(s => s.num); }

  private showPart(pi: number): void {
    this.part = pi;
    $$('.cd-part', this.cd).forEach(sec => { sec.hidden = Number(sec.dataset.part) !== pi; });
    const p = this.parts[pi]!;
    const nums = this.partRange(pi);
    const section = this.sections[pi]!;
    const instruction = p.instructions
      ?? (section === 'writing' ? 'Write your answer in the box.'
        : section === 'speaking' ? 'Answer each question aloud and record it. The text box keeps what you said (typed, or written down while you speak).'
        : nums.length ? `${section === 'listening' ? 'Listen and answer' : 'Read the text and answer'} ${rangeText(nums).replace(/^Q/, 'q')}.` : '');
    this.els.partBar.replaceChildren(el('b', null, p.title), el('span', { html: mdBlock(instruction).replace(/^<p>|<\/p>$/g, '') }));
    if (this.current === null || !nums.includes(this.current)) this.current = nums[0] ?? null;
    this.updateNav();
    this.savePos();
  }

  private goTo(n: number, smooth = true): void {
    const slot = this.slots.find(s => s.num === n);
    if (!slot) return;
    if (slot.partIndex !== this.part) this.showPart(slot.partIndex);
    this.current = n;
    this.updateNav();
    this.savePos();
    const holder = this.numEls.get(n);
    if (!holder) return;
    const sec = holder.closest<HTMLElement>('.cd-part');
    if (sec && holder.closest('.pane-right')) showTab(sec, 'right');
    holder.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    const target = holder.querySelector<HTMLElement>('input:checked') ?? holder.querySelector<HTMLElement>('input:not([disabled]), .drop-zone[tabindex="0"]');
    target?.focus({ preventScroll: true });
    holder.classList.remove('pulse'); void holder.offsetWidth; holder.classList.add('pulse');
  }

  private goToMark(m: HTMLElement): void {
    const sec = m.closest<HTMLElement>('.cd-part');
    if (sec) {
      this.showPart(Number(sec.dataset.part));
      showTab(sec, m.closest('.pane-right') ? 'right' : 'left');
    }
    m.scrollIntoView({ block: 'center', behavior: 'smooth' });
    m.classList.remove('pulse'); void m.offsetWidth; m.classList.add('pulse');
  }

  private step(dir: number): void {
    if (!this.slots.length || !this.partRange(this.part).length) {
      const pi = this.part + dir;
      if (pi >= 0 && pi < this.parts.length) this.showPart(pi);
      return;
    }
    const idx = this.slots.findIndex(s => s.num === this.current);
    const next = this.slots[Math.max(0, Math.min(this.slots.length - 1, (idx < 0 ? 0 : idx) + dir))];
    if (next) this.goTo(next.num);
  }

  private slotAnswered(s: Slot): boolean {
    const v = this.answers[s.qid];
    return s.type === 'mcq_multi' ? Array.isArray(v) && v.length > s.sub : isAnswered(v);
  }

  private updateNav(): void {
    const nav = this.els.nav;
    const partsBox = el('div', { class: 'nav-parts' });
    this.parts.forEach((p, pi) => {
      const active = pi === this.part;
      const box = el('div', { class: `nav-part${active ? ' active' : ''}` },
        el('button', { class: 'nav-part-label', onclick: () => this.showPart(pi) }, p.title));
      const slots = this.slots.filter(s => s.partIndex === pi);
      if (!slots.length) {
        const ids = listItems([p]).map(i => i.id);
        const words = ids.reduce((s, id) => {
          const v = this.answers[id];
          return s + (typeof v === 'string' ? wordCount(v) : v && typeof v === 'object' && !Array.isArray(v) ? wordCount(Object.values(v).join(' ')) : 0);
        }, 0);
        box.appendChild(el('span', { class: 'nav-count' }, `${words} words`));
      } else if (active) {
        box.appendChild(el('div', { class: 'nav-qs' }, slots.map(s => el('button', {
          class: `nav-q${this.slotAnswered(s) ? ' answered' : ''}${this.flags.has(s.num) ? ' flagged' : ''}${this.current === s.num ? ' current' : ''}${this.results.has(s.num) ? (this.results.get(s.num)!.correct ? ' rv-ok' : ' rv-bad') : ''}`,
          title: `Question ${s.num}`, onclick: () => this.goTo(s.num)
        }, String(s.num)))));
      } else {
        box.appendChild(el('span', { class: 'nav-count' }, `${slots.filter(s => this.slotAnswered(s)).length} of ${slots.length}`));
      }
      partsBox.appendChild(box);
    });
    const actions = el('div', { class: 'nav-actions' });
    if (!this.review && this.current !== null && this.partRange(this.part).length) {
      const n = this.current;
      actions.appendChild(el('label', { class: 'flag-toggle', title: 'Mark this question to come back to it' },
        el('input', {
          type: 'checkbox', checked: this.flags.has(n), onchange: (e: Event) => {
            if ((e.target as HTMLInputElement).checked) this.flags.add(n); else this.flags.delete(n);
            this.sync.setState('flags', [...this.flags].sort((a, b) => a - b));
            this.updateNav();
          }
        }), ` Review Q${n}`));
    }
    actions.append(
      el('button', { class: 'nav-arrow', title: 'Previous (Alt+←)', onclick: () => this.step(-1) }, '◀'),
      el('button', { class: 'nav-arrow', title: 'Next (Alt+→)', onclick: () => this.step(1) }, '▶'),
      this.review
        ? el('a', { class: 'nav-submit', href: `#/result/${this.view.attempt.id}` }, '← Results')
        : el('button', { class: 'nav-submit', onclick: () => this.confirmSubmit() }, '✓ Submit'));
    nav.replaceChildren(partsBox, actions);
  }

  /* ---------- clock ---------- */
  private remaining(): number | null {
    const t = this.timing;
    if (t.limitSec === null) return null;
    if (this.mode === 'exam' && t.deadline) return (Date.parse(t.deadline) - (Date.now() + this.serverOffset)) / 1000;
    return t.limitSec - ((t.spentSec.total ?? 0) + this.sync.unconfirmedActive);
  }

  private tick(): void {
    if (this.finished) return;
    const running = !this.paused && document.visibilityState === 'visible';
    if (running) this.sync.addActive(this.parts[this.part]!.id, 1);
    for (const fn of this.tickers) { try { fn(running); } catch (e) { console.error(e); } }
    const r = this.remaining();
    if (r !== null) {
      for (const t of [600, 300, 60]) {
        if (!this.warned.has(t) && r <= t && r > t - 5) { this.warned.add(t); this.flash(t === 60 ? '1 minute left' : `${t / 60} minutes left`, 'warn'); }
      }
      if (r <= 0) this.timeUp();
    }
    this.drawTimer();
  }

  private drawTimer(): void {
    const t = this.els.timer;
    const r = this.remaining();
    t.classList.toggle('low', r !== null && r <= 600 && r > 300);
    t.classList.toggle('critical', r !== null && r <= 300);
    t.classList.toggle('concealed', this.timerHidden);
    if (this.timerHidden) { t.textContent = '⏱ Show time'; return; }
    if (r === null) { t.textContent = `⏱ ${formatClock((this.timing.spentSec.total ?? 0) + this.sync.unconfirmedActive)} (no time limit)`; return; }
    if (r < 0) { t.textContent = `⏱ +${formatClock(-r)} over time`; return; }
    t.textContent = r >= 120 ? `⏱ ${Math.ceil(r / 60)} minutes left` : `⏱ ${formatClock(r)} left`;
  }

  private onSaved(r: SaveResult): void {
    this.timing = r.timing;
    this.serverOffset = Date.parse(r.timing.serverNow) - Date.now();
    this.drawTimer();
  }

  private drawSync(s: SyncStatus): void {
    const labels: Record<SyncStatus, string> = { saved: 'Saved', saving: 'Saving…', offline: 'Offline — answers are kept on this device and will sync', error: 'Could not save' };
    this.els.sync.className = `cd-sync ${s}`;
    this.els.sync.title = labels[s];
    this.els.sync.setAttribute('aria-label', labels[s]);
    if (s === 'offline') this.flash('You are offline. Your answers are kept on this device and will be saved when the connection is back.', 'warn');
  }

  private setPaused(on: boolean): void {
    this.paused = on;
    if (this.audio) { if (on) this.audio.audio.pause(); }
    $('.pause-overlay', this.cd)?.remove();
    if (on) {
      this.cd.appendChild(el('div', { class: 'pause-overlay no-hl' }, el('div', null,
        el('h2', null, '⏸ Paused'),
        el('p', null, 'Your answers are saved. You can also close the page and continue later, on any device.'),
        el('button', { class: 'btn btn-primary btn-lg', onclick: () => this.setPaused(false) }, '▶ Resume'))));
      void this.sync.flush();
    }
  }

  private timeUp(): void {
    if (this.mode === 'exam') {
      if (this.finished) return;
      void this.finish(true);
      return;
    }
    if (this.practiceTimeUpShown) return;
    this.practiceTimeUpShown = true;
    modal({
      title: 'Time is up',
      body: el('p', null, 'Practice mode: submit now, or keep working — the clock shows how far over time you go.'),
      actions: [{ label: 'Keep going', kind: 'ghost' }, { label: 'Submit now', kind: 'primary', onClick: () => this.finish(false) }]
    });
  }

  private flash(msg: string, kind: 'info' | 'warn' = 'info'): void {
    const b = this.els.banner;
    b.textContent = msg;
    b.className = `cd-banner ${kind}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add('hidden'), 4500);
  }

  /* ---------- submit ---------- */
  private confirmSubmit(): void {
    const un = this.slots.filter(s => !this.slotAnswered(s)).map(s => s.num);
    const openItems = listItems(this.parts).filter(i => i.kind !== 'objective');
    const emptyOpen = openItems.filter(i => !isAnswered(this.answers[i.id])).length;
    const parts: string[] = [];
    if (this.slots.length) parts.push(un.length ? `You have ${un.length} unanswered question${un.length === 1 ? '' : 's'}${un.length <= 12 ? ` (${un.join(', ')})` : ''}.` : 'You have answered every question.');
    if (openItems.length) parts.push(emptyOpen ? `${emptyOpen} writing/speaking answer${emptyOpen === 1 ? ' is' : 's are'} empty.` : 'Every writing/speaking box has an answer.');
    if (this.flags.size) parts.push(`${this.flags.size} question${this.flags.size === 1 ? ' is' : 's are'} marked for review.`);
    modal({
      title: 'Submit your answers?',
      body: el('div', null, el('p', null, parts.join(' ')), el('p', { class: 'muted' }, 'You cannot change your answers after you submit.')),
      actions: [{ label: 'Go back', kind: 'ghost' }, { label: '✓ Submit', kind: 'primary', onClick: () => this.finish(false) }]
    });
  }

  private async finish(timeUp: boolean): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.audio?.stop();
    if (this.audio) this.sync.setState('audio', this.audio.position());
    try {
      await this.sync.submit();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) {
        this.finished = false;
        toast(e instanceof ApiError ? e.message : 'Could not submit — you seem to be offline. Your answers are kept on this device; try again in a moment.', 'err', 6000);
        return;
      }
    }
    $$('.modal-overlay').forEach(m => m.remove());
    location.hash = `#/result/${this.view.attempt.id}`;
  }

  private closedByServer(code: string): void {
    if (this.finished) return;
    this.finished = true;
    this.audio?.stop();
    location.hash = `#/result/${this.view.attempt.id}`;
  }
}
