/* ===== Exam view: start screen, timer, navigation, audio, settings, submit, review ===== */

const ExamView = {
  S: null,

  /** the object the router uses to ask before leaving / clean up */
  makeHandle() {
    return {
      canLeave: async () => {
        const S = this.S;
        if (!S || !S.running || S.submitted) return true;
        const ok = await confirmDialog('Leave the test? Your answers, highlights and remaining time are saved — you can resume from the dashboard.', { ok: 'Leave test', cancel: 'Stay' });
        if (ok) this.saveProgress(S);
        return ok;
      },
      warnOnUnload: () => { const S = this.S; if (S && S.running && !S.submitted) { this.saveProgress(S); return true; } return false; },
      destroy: () => this.teardown()
    };
  },

  async mount(root, opts) {
    document.body.classList.add('theme-exam');
    const handle = this.makeHandle();

    if (opts.review) {
      const attempt = await DB.get('attempts', opts.attemptId);
      if (!attempt) throw new Error('This result no longer exists.');
      const exam = normalizeExam(attempt.examSnapshot);
      const S = this.makeState(exam, { review: true, attempt, answers: attempt.answers || {}, flags: attempt.flags || {} });
      this.build(root, S);
      if (attempt.passages) this.restorePassages(S, attempt.passages, attempt.sig);
      this.applyReview(S);
      this.showPart(S, 0);
      return handle;
    }

    const raw = await DB.get('exams', opts.examId);
    if (!raw) throw new Error('This test no longer exists.');
    const exam = normalizeExam(raw);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('ielts-progress-' + exam.id) || 'null'); } catch { saved = null; }
    if (saved && saved.runId) saved = null;   // that progress belongs to a full test; resume it from the full test screen
    this.startScreen(root, exam, saved);
    return handle;
  },

  makeState(exam, extra = {}) {
    const self = this;
    const S = {
      exam, num: numberExam(exam), answers: {}, flags: {}, part: 0, current: null,
      mode: 'exam', review: false, remaining: exam.durationMinutes * 60, timeUsed: 0, paused: false,
      root: null, numEls: {}, afterRender: [], picked: null, running: false, submitted: false,
      audio: null, tracks: [], trackIdx: 0, startedAt: Date.now(), warned: {},
      sig: exam.parts.map(p => (p.passage || '').length).join(','),
      setAnswer(qid, v) {
        if (S.review) return;
        S.answers[qid] = v;
        self.updateNav(S);
        self.saveSoon(S);
      },
      registerNum(n, node) { if (!S.numEls[n]) S.numEls[n] = node; },
      flash(msg, kind) { self.flash(S, msg, kind); },
      onToolsChange() { self.saveSoon(S); }
    };
    Object.assign(S, extra);
    this.S = S;
    return S;
  },

  teardown() {
    const S = this.S;
    if (!S) return;
    clearInterval(S.timer);
    if (S.audio) { S.audio.pause(); S.audio.src = ''; }
    if (S.running && !S.submitted) this.saveProgress(S);
    Tools.destroy();
    document.removeEventListener('keydown', S.onKey);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.S = null;
  },

  /* ---------- start screen ---------- */
  startScreen(root, exam, saved) {
    const m = MODULES[exam.module];
    const n = countQuestions(exam);
    let mode = saved?.mode || 'exam';
    const isW = exam.module === 'writing';
    const parts = exam.parts.length;
    const modeOpt = (value, title, desc) => el('label', { class: 'mode-opt' },
      el('input', { type: 'radio', name: 'mode', value, checked: mode === value, onchange: () => { mode = value; } }),
      el('div', null, el('b', null, title), el('small', null, desc)));

    const info = isW ? [
      `There are ${parts} task${parts === 1 ? '' : 's'} in this test.`,
      'Task 2 contributes twice as much as Task 1 to the Writing score.',
      'The word counter under your answer shows how many words you have written.'
    ] : [
      `There are ${n} questions in this test. Each question carries one mark.`,
      `There are ${parts} ${m.partName.toLowerCase()}s to the test.`,
      exam.module === 'listening' ? 'You will hear each recording ONCE only (exam mode).' : 'You can change your answers at any time during the test.',
      'The clock will show you when there are 10 minutes and 5 minutes left.'
    ];

    const box = el('div', { class: 'start-wrap' },
      el('div', { class: 'start-card' },
        el('div', { class: 'start-head' },
          el('span', { class: 'cd-logo' }, 'IELTS'),
          el('span', { class: 'badge badge-' + exam.module }, m.icon + ' ' + m.label)),
        el('h1', null, exam.title),
        el('div', { class: 'start-meta' },
          el('div', null, el('small', null, 'Time'), el('b', null, exam.durationMinutes + ' minutes')),
          el('div', null, el('small', null, isW ? 'Tasks' : 'Questions'), el('b', null, isW ? parts : n)),
          el('div', null, el('small', null, 'Module'), el('b', null, m.label + (exam.module !== 'listening' ? (exam.variant === 'general' ? ' · GT' : ' · Academic') : '')))),
        el('h4', null, 'INSTRUCTIONS TO CANDIDATES'),
        el('ul', null, el('li', null, 'Answer all the questions.'), el('li', null, 'You can move between questions and parts using the bar at the bottom of the screen.'),
          el('li', null, 'Select text and choose “Highlight” or “Add note”. Right-click for more options.')),
        el('h4', null, 'INFORMATION FOR CANDIDATES'),
        el('ul', null, info.map(t => el('li', null, t))),
        el('div', { class: 'modes' },
          modeOpt('exam', 'Exam mode', exam.module === 'listening' ? 'Real conditions: the clock cannot be paused and the audio plays once.' : 'Real conditions: the clock cannot be paused.'),
          modeOpt('practice', 'Practice mode', exam.module === 'listening' ? 'Pause the clock, replay and skip the audio, change its speed.' : 'Pause the clock and keep going after time is up.')),
        el('div', { class: 'start-actions' },
          el('a', { class: 'btn btn-ghost', href: '#/' }, '← Dashboard'),
          saved ? el('button', {
            class: 'btn', onclick: async () => {
              if (!await confirmDialog('Start again? Your saved answers and highlights for this test will be lost.', { ok: 'Start again', danger: true })) return;
              localStorage.removeItem('ielts-progress-' + exam.id);
              this.begin(root, exam, null, mode);
            }
          }, 'Start again') : null,
          el('button', { class: 'btn btn-primary btn-lg', onclick: () => this.begin(root, exam, saved, mode) },
            saved ? `▶ Resume (${formatClock(saved.remaining)} left)` : '▶ Start test'))
      ));
    root.appendChild(box);
  },

  async begin(root, exam, saved, mode, runId = null) {
    const S = this.makeState(exam, { mode, runId });
    if (saved) {
      Object.assign(S, {
        answers: saved.answers || {}, flags: saved.flags || {}, part: saved.part || 0, current: saved.current || null,
        remaining: saved.remaining ?? S.remaining, timeUsed: saved.timeUsed || 0, startedAt: saved.startedAt || Date.now()
      });
      if (S.remaining <= 600) S.warned[600] = true;
      if (S.remaining <= 300) S.warned[300] = true;
    }
    S.running = true;
    root.innerHTML = '';
    this.build(root, S);
    if (saved && saved.passages) this.restorePassages(S, saved.passages, saved.sig);
    this.showPart(S, Math.min(S.part, exam.parts.length - 1));
    if (exam.module === 'listening') await this.startAudio(S, saved && saved.audio);
    this.startTimer(S);
    this.saveProgress(S);
  },

  /* ---------- layout ---------- */
  build(root, S) {
    const ex = S.exam;
    const st = this.loadSettings();
    const cd = el('div', { class: `cd size-${st.size} contrast-${st.contrast} mod-${ex.module}` + (S.review ? ' reviewing' : '') });
    cd.style.setProperty('--left', (st.split || 50) + '%');
    S.root = cd;

    S.timerEl = el('button', { class: 'cd-timer', title: 'Click to hide / show the time', onclick: () => { S.timerHidden = !S.timerHidden; this.drawTimer(S); } });
    S.pauseBtn = S.mode === 'practice' && !S.review ? el('button', { class: 'cd-icon', title: 'Pause', onclick: () => this.setPaused(S, true) }, '⏸') : null;
    S.notesBtn = el('button', { class: 'cd-icon', title: 'Notes', onclick: () => this.openNotes(S) }, '📝', el('span', { class: 'cd-icon-label' }, 'Notes'));

    cd.appendChild(el('header', { class: 'cd-top no-hl' },
      el('div', { class: 'cd-left' },
        el('span', { class: 'cd-logo' }, 'IELTS'),
        el('div', { class: 'cd-cand' }, el('b', null, S.review ? 'Answer review' : S.runId ? `Full test · ${MODULES[ex.module].label}` : 'Practice candidate'), el('small', null, ex.title))),
      el('div', { class: 'cd-center' }, S.review ? el('span', { class: 'cd-review-tag' }, '✓ Showing correct answers') : S.timerEl, S.pauseBtn),
      el('div', { class: 'cd-right' },
        S.notesBtn,
        el('button', { class: 'cd-icon', title: 'Settings: text size and colours', onclick: () => this.openSettings(S) }, '⚙', el('span', { class: 'cd-icon-label' }, 'Settings')),
        el('button', { class: 'cd-icon', title: 'Help', onclick: () => this.openHelp(S) }, '?', el('span', { class: 'cd-icon-label' }, 'Help')),
        el('button', { class: 'cd-icon', title: 'Full screen', onclick: () => this.toggleFullscreen() }, '⛶'),
        S.review ? el('a', { class: 'btn btn-sm', href: '#/result/' + S.attempt.id }, '← Results') : null)
    ));

    if (ex.module === 'listening' && !S.review) { S.audioBar = el('div', { class: 'cd-audio no-hl' }); cd.appendChild(S.audioBar); }
    S.partBar = el('div', { class: 'cd-partbar no-hl' });
    cd.appendChild(S.partBar);
    S.banner = el('div', { class: 'cd-banner hidden' });
    cd.appendChild(S.banner);

    const parts = el('div', { class: 'cd-parts' });
    ex.parts.forEach((p, pi) => parts.appendChild(Render.part(S, p, pi)));
    cd.appendChild(parts);

    S.nav = el('footer', { class: 'cd-nav no-hl' });
    cd.appendChild(S.nav);
    root.appendChild(cd);
    S.afterRender.forEach(fn => fn());

    Tools.init(S);
    this.bindLayout(S);
    this.drawTimer(S);
  },

  bindLayout(S) {
    const cd = S.root;
    // current question follows focus / clicks
    const track = e => {
      const h = e.target.closest('[data-num]');
      if (!h || !/^\d+$/.test(h.dataset.num)) return;
      const n = Number(h.dataset.num);
      if (S.current !== n) { S.current = n; this.updateNav(S); }
    };
    cd.addEventListener('focusin', track);
    cd.addEventListener('click', track);

    // resizable split
    cd.addEventListener('pointerdown', e => {
      const d = e.target.closest('.divider');
      if (!d) return;
      e.preventDefault();
      const rect = d.parentElement.getBoundingClientRect();
      d.classList.add('dragging');
      const move = ev => {
        const pct = Math.max(20, Math.min(80, (ev.clientX - rect.left) / rect.width * 100));
        cd.style.setProperty('--left', pct + '%');
      };
      const up = () => {
        d.classList.remove('dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this.saveSettings({ split: parseFloat(cd.style.getPropertyValue('--left')) || 50 });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    cd.addEventListener('dblclick', e => { if (e.target.closest('.divider')) { cd.style.setProperty('--left', '50%'); this.saveSettings({ split: 50 }); } });

    S.onKey = e => {
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); this.step(S, 1); }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); this.step(S, -1); }
    };
    document.addEventListener('keydown', S.onKey);
  },

  /* ---------- parts & navigation ---------- */
  showPart(S, pi) {
    S.part = pi;
    $$('.cd-part', S.root).forEach(sec => { sec.hidden = Number(sec.dataset.part) !== pi; });
    const p = S.exam.parts[pi];
    S.partBar.innerHTML = '';
    S.partBar.append(el('b', null, p.title), el('span', null, Render.partInstruction(S, pi)));
    if (S.current == null || !this.numInPart(S, S.current, pi)) {
      const r = S.num.partRange[pi];
      S.current = r && r[1] >= r[0] ? r[0] : null;
    }
    this.updateNav(S);
    this.saveSoon(S);
  },

  numInPart(S, n, pi) { const r = S.num.partRange[pi]; return r && n >= r[0] && n <= r[1]; },

  goTo(S, n) {
    const slot = S.num.slots.find(s => s.num === n);
    if (!slot) return;
    if (slot.partIndex !== S.part) this.showPart(S, slot.partIndex);
    S.current = n;
    this.updateNav(S);
    const holder = S.numEls[n];
    if (!holder) return;
    holder.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const target = holder.querySelector('input:checked') || holder.querySelector('input:not([disabled]), .drop-zone[tabindex="0"]');
    if (target) target.focus({ preventScroll: true });
    holder.classList.remove('pulse'); void holder.offsetWidth; holder.classList.add('pulse');
  },

  step(S, dir) {
    if (S.exam.module === 'writing' || !S.num.slots.length) {
      const pi = S.part + dir;
      if (pi >= 0 && pi < S.exam.parts.length) this.showPart(S, pi);
      return;
    }
    const total = S.num.slots.length;
    const cur = S.current || S.num.partRange[S.part][0] || 1;
    const n = Math.max(1, Math.min(total, cur + dir));
    this.goTo(S, n);
  },

  updateNav(S) {
    const ex = S.exam, nav = S.nav;
    if (!nav) return;
    nav.innerHTML = '';
    const partsBox = el('div', { class: 'nav-parts' });
    ex.parts.forEach((p, pi) => {
      const active = pi === S.part;
      const box = el('div', { class: 'nav-part' + (active ? ' active' : '') });
      box.appendChild(el('button', { class: 'nav-part-label', onclick: () => this.showPart(S, pi) }, p.title));
      if (ex.module === 'writing') {
        box.appendChild(el('span', { class: 'nav-count' }, `${wordCount(S.answers[p.id])} words`));
      } else {
        const slots = S.num.slots.filter(s => s.partIndex === pi);
        if (active) {
          box.appendChild(el('div', { class: 'nav-qs' }, slots.map(s => {
            let cls = 'nav-q';
            if (isSlotAnswered(s, S.answers)) cls += ' answered';
            if (S.flags[s.num]) cls += ' flagged';
            if (S.current === s.num) cls += ' current';
            if (S.reviewMap) cls += S.reviewMap[s.num] ? ' rv-ok' : ' rv-bad';
            return el('button', { class: cls, title: 'Question ' + s.num, onclick: () => this.goTo(S, s.num) }, String(s.num));
          })));
        } else {
          const done = slots.filter(s => isSlotAnswered(s, S.answers)).length;
          box.appendChild(el('span', { class: 'nav-count' }, S.reviewMap
            ? `${slots.filter(s => S.reviewMap[s.num]).length} of ${slots.length} correct`
            : `${done} of ${slots.length}`));
        }
      }
      partsBox.appendChild(box);
    });

    const actions = el('div', { class: 'nav-actions' });
    if (ex.module !== 'writing' && !S.review && S.current) {
      actions.appendChild(el('label', { class: 'flag-toggle', title: 'Mark this question to come back to it' },
        el('input', { type: 'checkbox', checked: !!S.flags[S.current], onchange: e => { if (e.target.checked) S.flags[S.current] = true; else delete S.flags[S.current]; this.updateNav(S); this.saveSoon(S); } }),
        ` Review Q${S.current}`));
    }
    actions.append(
      el('button', { class: 'nav-arrow', title: 'Previous (Alt+←)', onclick: () => this.step(S, -1) }, '◀'),
      el('button', { class: 'nav-arrow', title: 'Next (Alt+→)', onclick: () => this.step(S, 1) }, '▶'));
    if (!S.review) actions.appendChild(el('button', { class: 'nav-submit', onclick: () => this.confirmSubmit(S) }, '✓ Submit'));
    nav.append(partsBox, actions);
  },

  /* ---------- timer ---------- */
  startTimer(S) {
    S.lastTick = Date.now();
    let sinceSave = 0;
    S.timer = setInterval(() => {
      const now = Date.now(), dt = (now - S.lastTick) / 1000;
      S.lastTick = now;
      if (S.paused || S.submitted) return;
      const before = S.remaining;
      S.remaining -= dt;
      S.timeUsed += dt;
      for (const t of [600, 300, 60]) {
        if (!S.warned[t] && before > t && S.remaining <= t) {
          S.warned[t] = true;
          this.flash(S, t === 60 ? '1 minute left' : `${t / 60} minutes left`, 'warn');
        }
      }
      this.drawTimer(S);
      sinceSave += dt;
      if (sinceSave > 5) { sinceSave = 0; this.saveProgress(S); }
      if (before > 0 && S.remaining <= 0) this.timeUp(S);
    }, 250);
  },

  drawTimer(S) {
    const t = S.timerEl;
    if (!t) return;
    const r = S.remaining;
    t.classList.toggle('low', r <= 600 && r > 300);
    t.classList.toggle('critical', r <= 300);
    t.classList.toggle('concealed', !!S.timerHidden);
    if (S.timerHidden) { t.textContent = '⏱ Show time'; return; }
    if (r < 0) { t.textContent = `⏱ +${formatClock(-r)} over time`; return; }
    t.textContent = r >= 120 ? `⏱ ${Math.ceil(r / 60)} minutes left` : `⏱ ${formatClock(r)} left`;
    t.title = formatClock(r) + ' — click to hide';
  },

  setPaused(S, on) {
    S.paused = on;
    if (S.audio) { if (on) { S.wasPlaying = !S.audio.paused; S.audio.pause(); } else if (S.wasPlaying) S.audio.play().catch(() => {}); }
    $('.pause-overlay', S.root)?.remove();
    if (on) S.root.appendChild(el('div', { class: 'pause-overlay no-hl' },
      el('div', null, el('h2', null, '⏸ Paused'), el('p', null, formatClock(Math.max(0, S.remaining)) + ' left'),
        el('button', { class: 'btn btn-primary btn-lg', onclick: () => this.setPaused(S, false) }, '▶ Resume'))));
    this.saveProgress(S);
  },

  timeUp(S) {
    if (S.mode === 'exam') {
      modal({
        title: 'Time is up', dismissable: false,
        body: el('p', null, S.runId ? 'This section has finished. Your answers will now be submitted and the next section will begin.' : 'The test has finished. Your answers will now be submitted.'),
        actions: [{ label: S.runId ? 'Continue' : 'See my results', kind: 'primary', onClick: () => this.finish(S) }]
      });
      setTimeout(() => { if (!S.submitted) this.finish(S); }, 8000);
    } else {
      modal({
        title: 'Time is up',
        body: el('p', null, 'Practice mode: you can submit now, or keep working (the clock will show how far over time you go).'),
        actions: [{ label: 'Keep going', kind: 'ghost' }, { label: 'Submit now', kind: 'primary', onClick: () => this.finish(S) }]
      });
    }
  },

  flash(S, msg, kind = 'info') {
    const b = S.banner;
    if (!b) return toast(msg);
    b.textContent = msg;
    b.className = 'cd-banner ' + kind;
    clearTimeout(S.bannerT);
    S.bannerT = setTimeout(() => b.classList.add('hidden'), 4000);
  },

  /* ---------- listening audio ---------- */
  async startAudio(S, savedAudio) {
    const bar = S.audioBar;
    S.tracks = [];
    for (const [pi, p] of S.exam.parts.entries()) {
      if (!p.audioId) continue;
      const url = await DB.fileURL(p.audioId);
      if (url) S.tracks.push({ pi, url, title: p.title });
    }
    if (!S.tracks.length) {
      bar.appendChild(el('span', null, '🔇 No audio uploaded for this test. Add audio in the editor to practise listening.'));
      return;
    }
    const a = new Audio();
    S.audio = a;
    a.preload = 'auto';
    let vol = 1;
    try { vol = Number(localStorage.getItem('ielts-volume') ?? 1); } catch { }
    a.volume = vol;
    const practice = S.mode === 'practice';

    const status = el('span', { class: 'aud-status' });
    const time = el('span', { class: 'aud-time' });
    const prog = el('input', { type: 'range', class: 'aud-seek', min: 0, max: 1000, value: 0, disabled: !practice });
    const playBtn = practice ? el('button', { class: 'cd-icon', title: 'Play / pause', onclick: () => a.paused ? a.play() : a.pause() }, '⏯') : null;
    const trackSel = practice && S.tracks.length > 1 ? el('select', { class: 'aud-select', onchange: e => load(Number(e.target.value), 0, true) },
      S.tracks.map((t, i) => el('option', { value: i }, t.title))) : null;
    const speed = practice ? el('select', { class: 'aud-select', title: 'Speed', onchange: e => { a.playbackRate = Number(e.target.value); } },
      ['0.75', '0.9', '1', '1.1', '1.25'].map(v => el('option', { value: v, selected: v === '1' }, v + '×'))) : null;
    const back = practice ? el('button', { class: 'cd-icon', title: 'Back 5 seconds', onclick: () => { a.currentTime = Math.max(0, a.currentTime - 5); } }, '↺5') : null;
    const volume = el('input', {
      type: 'range', class: 'aud-vol', min: 0, max: 1, step: 0.05, value: vol, title: 'Volume',
      oninput: e => { a.volume = Number(e.target.value); try { localStorage.setItem('ielts-volume', e.target.value); } catch { } }
    });
    appendChildren(bar, [el('span', { class: 'aud-icon' }, '🎧'), status, playBtn, back, trackSel, prog, time, speed, el('span', { title: 'Volume' }, '🔊'), volume]);

    const load = (i, at = 0, autoplay = true) => {
      S.trackIdx = i;
      a.src = S.tracks[i].url;
      if (trackSel) trackSel.value = i;
      a.addEventListener('loadedmetadata', () => { if (at) a.currentTime = Math.min(at, a.duration || at); }, { once: true });
      if (autoplay) a.play().catch(() => { status.textContent = 'Press ▶ to start the audio'; showStart(); });
    };
    const showStart = () => {
      if ($('.aud-start', bar)) return;
      bar.appendChild(el('button', { class: 'btn btn-sm btn-primary aud-start', onclick: e => { a.play(); e.target.remove(); } }, '▶ Play audio'));
    };
    a.addEventListener('play', () => { status.textContent = `${S.tracks[S.trackIdx].title} — audio playing`; });
    a.addEventListener('pause', () => { if (!a.ended && practice) status.textContent = `${S.tracks[S.trackIdx].title} — paused`; });
    a.addEventListener('timeupdate', () => {
      if (a.duration) {
        prog.value = Math.round(a.currentTime / a.duration * 1000);
        time.textContent = `${formatClock(a.currentTime)} / ${formatClock(a.duration)}`;
      }
    });
    prog.addEventListener('input', () => { if (a.duration) a.currentTime = prog.value / 1000 * a.duration; });
    a.addEventListener('ended', () => {
      if (S.trackIdx < S.tracks.length - 1) {
        const next = S.trackIdx + 1;
        if (S.tracks[next].pi !== S.part && !practice) this.showPart(S, S.tracks[next].pi);
        load(next);
      } else status.textContent = 'The recording has finished. Check your answers.';
    });

    const startIdx = savedAudio && savedAudio.track < S.tracks.length ? savedAudio.track : 0;
    load(startIdx, savedAudio ? savedAudio.time : 0, true);
  },

  /* ---------- saving progress ---------- */
  saveSoon(S) {
    clearTimeout(S.saveT);
    S.saveT = setTimeout(() => this.saveProgress(S), 400);
  },

  passageSnapshot(S) {
    const out = {};
    $$('.pane-left.passage', S.root).forEach(p => { out[p.dataset.part] = p.innerHTML; });
    return out;
  },

  restorePassages(S, passages, sig) {
    if (sig !== S.sig) return;
    for (const [pi, html] of Object.entries(passages)) {
      const pane = $(`.pane-left.passage[data-part="${pi}"]`, S.root);
      if (pane) pane.innerHTML = html;
    }
  },

  saveProgress(S) {
    if (!S || S.review || S.submitted || !S.running) return;
    const data = {
      v: 1, answers: S.answers, flags: S.flags, part: S.part, current: S.current, remaining: S.remaining,
      timeUsed: S.timeUsed, mode: S.mode, startedAt: S.startedAt, passages: this.passageSnapshot(S), sig: S.sig, runId: S.runId || null,
      audio: S.audio ? { track: S.trackIdx, time: S.audio.currentTime } : null, savedAt: Date.now()
    };
    try { localStorage.setItem('ielts-progress-' + S.exam.id, JSON.stringify(data)); } catch (e) { console.warn('Could not save progress', e); }
  },

  /* ---------- submit ---------- */
  confirmSubmit(S) {
    const ex = S.exam;
    let msg;
    if (ex.module === 'writing') {
      const short = ex.parts.filter(p => wordCount(S.answers[p.id]) < (p.minWords || 0));
      msg = short.length ? `${short.map(p => p.title).join(' and ')} ${short.length === 1 ? 'is' : 'are'} below the minimum word count.` : 'Both tasks meet the minimum word count.';
    } else {
      const un = S.num.slots.filter(s => !isSlotAnswered(s, S.answers)).map(s => s.num);
      const fl = Object.keys(S.flags).length;
      msg = (un.length ? `You have ${un.length} unanswered question${un.length === 1 ? '' : 's'}${un.length <= 12 ? ' (' + un.join(', ') + ')' : ''}.` : 'You have answered every question.') +
        (fl ? ` ${fl} question${fl === 1 ? ' is' : 's are'} marked for review.` : '');
    }
    modal({
      title: 'Submit your answers?',
      body: el('div', null, el('p', null, msg), el('p', { class: 'muted' }, 'You cannot change your answers after you submit.')),
      actions: [{ label: 'Go back', kind: 'ghost' }, { label: '✓ Submit', kind: 'primary', onClick: () => this.finish(S) }]
    });
  },

  async finish(S) {
    if (S.submitted) return;
    S.submitted = true;
    clearInterval(S.timer);
    if (S.audio) S.audio.pause();
    $$('.modal-overlay').forEach(m => m.remove());
    const ex = S.exam;
    let score = null, band = null;
    if (ex.module !== 'writing') { score = scoreAttempt(ex, S.answers); band = bandFor(ex, score.correct, score.total); }
    const attempt = {
      id: uid('att'), examId: ex.id, examTitle: ex.title, module: ex.module, variant: ex.variant, mode: S.mode,
      startedAt: S.startedAt, finishedAt: Date.now(), timeUsed: Math.round(S.timeUsed), timeLimit: ex.durationMinutes * 60,
      answers: S.answers, flags: S.flags,
      correct: score ? score.correct : null, total: score ? score.total : null,
      band: band ? band.band : null, scaled: band ? band.scaled : null, estimated: band ? band.estimated : false,
      perPart: score ? score.perPart : null,
      wordCounts: ex.module === 'writing' ? ex.parts.map(p => wordCount(S.answers[p.id])) : null,
      notes: Tools.notes().map(n => ({ note: n.note, quote: n.quote })),
      passages: this.passageSnapshot(S), sig: S.sig,
      runId: S.runId || null,
      examSnapshot: ex
    };
    await DB.put('attempts', attempt);
    localStorage.removeItem('ielts-progress-' + ex.id);
    if (S.runId) {
      // full test: record this section and go to the next one (results are shown at the end)
      const run = await DB.get('runs', S.runId);
      if (run) {
        const step = run.steps.find(s => s.examId === ex.id && !s.attemptId);
        if (step) step.attemptId = attempt.id;
        await DB.put('runs', run);
        App.go('#/run/' + run.id);
        return;
      }
    }
    App.go('#/result/' + attempt.id);
  },

  /* ---------- review mode ---------- */
  applyReview(S) {
    if (S.exam.module === 'writing') return;
    const score = scoreAttempt(S.exam, S.answers);
    S.reviewMap = {};
    const multi = {};
    score.items.forEach(it => {
      S.reviewMap[it.num] = it.ok;
      if (it.type === 'mcq_multi') { (multi[it.qid] = multi[it.qid] || []).push(it); return; }
      const holder = S.numEls[it.num];
      if (!holder) return;
      holder.classList.add(it.ok ? 'rv-ok' : 'rv-bad');
      const choices = $$('.choice', holder);
      if (choices.length) {
        choices.forEach(c => {
          if (normAnswer(c.dataset.value) === normAnswer(it.correct)) c.classList.add('rv-correct-opt');
          else if (normAnswer(c.dataset.value) === normAnswer(it.user)) c.classList.add('rv-wrong-opt');
        });
        if (!it.user) holder.appendChild(el('span', { class: 'rv-key no-hl' }, 'Not answered'));
      } else {
        holder.appendChild(el('span', { class: 'rv-key no-hl' }, (it.ok ? '✓ ' : '✗ Answer: ') + (it.correct || '—')));
      }
    });
    Object.values(multi).forEach(list => {
      const holder = S.numEls[list[0].num];
      if (!holder) return;
      const key = parseLetterList(list[0].correct);
      const user = String(list[0].user).split(', ').filter(Boolean);
      holder.classList.add(list.every(i => i.ok) ? 'rv-ok' : 'rv-bad');
      $$('.choice', holder).forEach(c => {
        if (key.includes(c.dataset.value)) c.classList.add('rv-correct-opt');
        else if (user.includes(c.dataset.value)) c.classList.add('rv-wrong-opt');
      });
      holder.appendChild(el('span', { class: 'rv-key no-hl' }, `${list.filter(i => i.ok).length} of ${list.length} correct · answer: ${key.join(', ')}`));
    });
  },

  /* ---------- panels ---------- */
  loadSettings() {
    try { return Object.assign({ size: 'm', contrast: 'default', split: 50 }, JSON.parse(localStorage.getItem('ielts-exam-settings') || '{}')); }
    catch { return { size: 'm', contrast: 'default', split: 50 }; }
  },
  saveSettings(patch) {
    const s = Object.assign(this.loadSettings(), patch);
    try { localStorage.setItem('ielts-exam-settings', JSON.stringify(s)); } catch { }
    return s;
  },

  openSettings(S) {
    const st = this.loadSettings();
    const apply = () => {
      const s = this.loadSettings();
      S.root.className = S.root.className.replace(/\bsize-\w+/, 'size-' + s.size).replace(/\bcontrast-\w+/, 'contrast-' + s.contrast);
    };
    const group = (name, label, opts) => el('fieldset', { class: 'set-group' }, el('legend', null, label),
      opts.map(([v, l, cls]) => el('label', { class: 'set-opt ' + (cls || '') },
        el('input', { type: 'radio', name, value: v, checked: st[name] === v, onchange: () => { this.saveSettings({ [name]: v }); apply(); } }),
        el('span', null, l))));
    modal({
      title: 'Settings',
      body: el('div', null,
        group('size', 'Text size', [['m', 'Standard'], ['l', 'Large'], ['xl', 'Extra large']]),
        group('contrast', 'Colours', [['default', 'Black on white', 'sw-bw'], ['wob', 'White on black', 'sw-wb'], ['yob', 'Yellow on black', 'sw-yb']])),
      actions: [{ label: 'Done', kind: 'primary' }]
    });
  },

  openNotes(S) {
    const notes = Tools.notes();
    const m = modal({
      title: `Notes (${notes.length})`,
      body: notes.length ? el('div', { class: 'notes-list' }, notes.map(n => el('div', {
        class: 'note-item', onclick: () => {
          m.close();
          const sec = n.el.closest('.cd-part');
          if (sec) this.showPart(S, Number(sec.dataset.part));
          n.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          n.el.classList.remove('pulse'); void n.el.offsetWidth; n.el.classList.add('pulse');
        }
      }, el('q', null, n.quote.length > 140 ? n.quote.slice(0, 140) + '…' : n.quote), el('p', null, n.note))))
        : el('p', { class: 'muted' }, 'No notes yet. Select some text and choose “Add note”.'),
      actions: [{ label: 'Close', kind: 'primary' }]
    });
  },

  openHelp(S) {
    modal({
      title: 'Help', wide: true,
      body: el('div', { class: 'help', html: `
        <ul>
          <li><b>Highlight:</b> select text in the passage or the questions, then click <b>Highlight</b>. Right-click for <i>Highlight, Notes, Clear, Clear all</i>. Click a highlight to remove it.</li>
          <li><b>Notes:</b> select text and choose <b>Add note</b>. Highlighted text with a note is underlined; hover to read it, or open <b>📝 Notes</b> at the top.</li>
          <li><b>Navigation:</b> use the question numbers at the bottom, or ◀ ▶ (Alt + ← / →). Answered questions are underlined.</li>
          <li><b>Review:</b> tick “Review” at the bottom to mark a question to come back to — it gets a marker in the bar.</li>
          <li><b>Matching:</b> drag an option into a box, or click an option then click a box. Click a filled box to empty it.</li>
          <li><b>Resize:</b> drag the bar between the passage and the questions; double-click it to reset.</li>
          <li><b>Clock:</b> click the time to hide or show it. Warnings appear at 10 and 5 minutes.</li>
          <li><b>Settings ⚙:</b> text size and colour scheme. <b>⛶</b> switches full screen.</li>
          <li>Your answers are saved automatically. If you close the page you can resume from the dashboard.</li>
        </ul>` }),
      actions: [{ label: 'Close', kind: 'primary' }]
    });
  },

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => toast('Full screen is not available here'));
  }
};
