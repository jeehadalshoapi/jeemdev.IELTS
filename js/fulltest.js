/* ===== Full test mode: Listening → Reading → Writing in one sitting, with an overall band ===== */

const FULL_ORDER = ['listening', 'reading', 'writing'];

/** IELTS overall: average of the section bands, rounded to the nearest half band (.25 → .5, .75 → next whole) */
function overallBand(bands) {
  const v = bands.filter(b => b != null);
  if (!v.length) return null;
  return Math.round(v.reduce((s, b) => s + b, 0) / v.length * 2) / 2;
}

const FullTest = {
  async openSetup() {
    const exams = await DB.listExams();
    const sel = {};
    const rows = FULL_ORDER.map(m => {
      const list = exams.filter(e => e.module === m);
      const s = el('select', { class: 'input', onchange: () => updateTotal() },
        list.map(e => el('option', { value: e.id }, `${e.title}  ·  ${countQuestions(e)} ${m === 'writing' ? 'tasks' : 'questions'} · ${e.durationMinutes} min`)),
        el('option', { value: '' }, `— Skip ${MODULES[m].label} —`));
      if (!list.length) s.value = '';
      sel[m] = s;
      return el('div', { class: 'field' },
        el('span', { class: 'field-label' }, `${MODULES[m].icon}  ${MODULES[m].label}`), s,
        !list.length ? el('small', { class: 'hint' }, `You have no ${MODULES[m].label} tests yet — add one from the dashboard.`) : null);
    });
    let mode = 'exam';
    const modeOpt = (value, title, desc) => el('label', { class: 'mode-opt' },
      el('input', { type: 'radio', name: 'run-mode', value, checked: mode === value, onchange: () => { mode = value; } }),
      el('div', null, el('b', null, title), el('small', null, desc)));
    const totalEl = el('p', { class: 'run-total' });
    const updateTotal = () => {
      const chosen = FULL_ORDER.map(m => exams.find(e => e.id === sel[m].value)).filter(Boolean);
      const mins = chosen.reduce((s, e) => s + Number(e.durationMinutes || 0), 0);
      totalEl.textContent = chosen.length ? `${chosen.length} section${chosen.length === 1 ? '' : 's'} · about ${Math.floor(mins / 60) ? Math.floor(mins / 60) + ' h ' : ''}${mins % 60} min in total` : 'Choose at least one section.';
    };
    updateTotal();

    modal({
      title: '🏁 Full test', wide: true,
      body: el('div', null,
        el('p', null, 'Take Listening, Reading and Writing one after another, in the same order as the real exam. You see your results only at the end, with an overall band.'),
        rows,
        el('div', { class: 'modes' },
          modeOpt('exam', 'Exam mode', 'Real conditions: no pausing, audio plays once.'),
          modeOpt('practice', 'Practice mode', 'Pause the clock and replay the audio.')),
        totalEl),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: '▶ Start full test', kind: 'primary', onClick: async () => {
            const steps = FULL_ORDER.filter(m => sel[m].value).map(m => {
              const ex = exams.find(e => e.id === sel[m].value);
              return { module: m, examId: ex.id, examTitle: ex.title, attemptId: null, skipped: false };
            });
            if (!steps.length) { toast('Choose at least one test', 'err'); return false; }
            const run = { id: uid('run'), mode, steps, status: 'running', createdAt: Date.now(), finishedAt: null };
            await DB.put('runs', run);
            App.go('#/run/' + run.id);
          }
        }
      ]
    });
  },

  async abandon(run) {
    if (!await confirmDialog('Stop this full test? Sections you already finished stay in your History.', { ok: 'Stop full test', danger: true })) return false;
    run.status = 'abandoned';
    run.finishedAt = Date.now();
    await DB.put('runs', run);
    for (const s of run.steps) {
      try {
        const p = JSON.parse(localStorage.getItem('ielts-progress-' + s.examId) || 'null');
        if (p && p.runId === run.id) localStorage.removeItem('ielts-progress-' + s.examId);
      } catch { }
    }
    return true;
  },

  nextStep(run) { return run.steps.findIndex(s => !s.attemptId && !s.skipped); }
};

/* ---------- the screen between sections ---------- */
const RunView = {
  async mount(root, runId) {
    document.body.classList.add('theme-exam');
    const run = await DB.get('runs', runId);
    if (!run) throw new Error('This full test no longer exists.');
    const idx = FullTest.nextStep(run);
    if (idx === -1 || run.status !== 'running') {
      if (run.status === 'running') { run.status = 'done'; run.finishedAt = Date.now(); await DB.put('runs', run); }
      location.replace('#/full/' + run.id);
      return {};
    }
    const step = run.steps[idx];
    const raw = await DB.get('exams', step.examId);
    if (!raw) {
      root.appendChild(el('div', { class: 'start-wrap' }, el('div', { class: 'start-card' },
        el('h1', null, 'Test not found'),
        el('p', null, `The ${MODULES[step.module].label} test “${step.examTitle}” was deleted.`),
        el('div', { class: 'start-actions' },
          el('a', { class: 'btn btn-ghost', href: '#/' }, '← Dashboard'),
          el('button', { class: 'btn btn-primary', onclick: async () => { step.skipped = true; await DB.put('runs', run); App.render(); } }, 'Skip this section')))));
      return {};
    }
    const exam = normalizeExam(raw);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('ielts-progress-' + exam.id) || 'null'); } catch { saved = null; }
    if (saved && saved.runId !== run.id) saved = null;
    this.interstitial(root, run, idx, exam, saved);
    return ExamView.makeHandle();
  },

  interstitial(root, run, idx, exam, saved) {
    const m = MODULES[exam.module];
    const prev = run.steps.slice(0, idx).filter(s => s.attemptId).pop();
    const isW = exam.module === 'writing';
    const message = !prev
      ? 'The full test is about to start. Make sure you have time for every section — in the real exam there is no break between Listening, Reading and Writing.'
      : `${MODULES[prev.module].label} is finished. In the real exam, ${m.label} starts straight away.`;

    root.appendChild(el('div', { class: 'start-wrap' },
      el('div', { class: 'start-card' },
        el('div', { class: 'start-head' },
          el('span', { class: 'cd-logo' }, 'IELTS'),
          el('span', { class: 'run-label' }, 'FULL TEST' + (run.mode === 'practice' ? ' · PRACTICE MODE' : ''))),
        el('div', { class: 'run-steps' }, run.steps.map((s, i) => el('div', {
          class: 'run-step' + (s.attemptId ? ' done' : '') + (s.skipped ? ' skipped' : '') + (i === idx ? ' current' : '')
        }, el('span', { class: 'run-dot' }, s.attemptId ? '✓' : s.skipped ? '–' : String(i + 1)), MODULES[s.module].label))),
        el('h1', null, `Section ${idx + 1} of ${run.steps.length}: ${m.label}`),
        el('p', { class: 'run-msg' }, message),
        el('div', { class: 'start-meta' },
          el('div', null, el('small', null, 'Test'), el('b', null, exam.title)),
          el('div', null, el('small', null, 'Time'), el('b', null, exam.durationMinutes + ' minutes')),
          el('div', null, el('small', null, isW ? 'Tasks' : 'Questions'), el('b', null, countQuestions(exam)))),
        exam.module === 'listening' ? el('p', { class: 'run-msg' }, '🎧 Put on your headphones. The recording starts as soon as you press Start' + (run.mode === 'exam' ? ' and you will hear it once only.' : '.')) : null,
        saved ? el('p', { class: 'run-msg' }, `You have saved progress in this section (${formatClock(saved.remaining)} left).`) : null,
        el('div', { class: 'start-actions' },
          el('button', { class: 'btn btn-ghost', onclick: async () => { if (await FullTest.abandon(run)) App.go('#/'); } }, 'Stop full test'),
          el('a', { class: 'btn', href: '#/' }, 'Continue later'),
          el('button', {
            class: 'btn btn-primary btn-lg', onclick: () => { root.innerHTML = ''; ExamView.begin(root, exam, saved, run.mode, run.id); }
          }, (saved ? '▶ Resume ' : '▶ Start ') + m.label))
      )));
  }
};

/* ---------- combined results ---------- */
const FullResults = {
  async mount(root, runId) {
    document.body.classList.add('theme-app');
    const run = await DB.get('runs', runId);
    if (!run) throw new Error('This full test no longer exists.');
    const attempts = await Promise.all(run.steps.map(s => s.attemptId ? DB.get('attempts', s.attemptId) : null));
    const bands = attempts.map(a => a ? a.band : null);
    const writingPending = run.steps.some((s, i) => s.module === 'writing' && attempts[i] && attempts[i].band == null);
    const overall = overallBand(bands);
    const totalTime = attempts.reduce((s, a) => s + (a ? a.timeUsed || 0 : 0), 0);

    root.appendChild(el('header', { class: 'app-header' },
      el('div', { class: 'brand' },
        el('a', { class: 'icon-btn back', href: '#/', title: 'Back to dashboard' }, '←'),
        el('div', null, el('b', null, 'Full test results'), el('small', null, fmtDate(run.createdAt)))),
      el('div', { class: 'header-actions' },
        run.status === 'running' ? el('a', { class: 'btn btn-primary', href: '#/run/' + run.id }, '▶ Continue full test') : null)));
    const page = el('div', { class: 'page results' });
    root.appendChild(page);

    const overallLabel = run.status === 'abandoned' ? 'Overall (test not finished)'
      : writingPending ? 'Overall so far — score your Writing' : 'Overall band (without Speaking)';
    page.appendChild(el('section', { class: 'card hero' },
      el('div', { class: 'hero-band' }, el('div', { class: 'band-num' }, overall == null ? '–' : fmtBand(overall)), el('div', { class: 'band-label' }, overallLabel)),
      el('div', { class: 'hero-info' },
        el('h2', null, 'Full test · ' + run.steps.map(s => MODULES[s.module].label).join(' + ')),
        el('div', { class: 'hero-rows' },
          el('div', null, el('small', null, 'Mode'), el('b', null, run.mode === 'practice' ? 'Practice' : 'Exam')),
          el('div', null, el('small', null, 'Total time'), el('b', null, fmtDuration(totalTime))),
          el('div', null, el('small', null, 'Status'), el('b', null, run.status === 'done' ? 'Finished' : run.status === 'abandoned' ? 'Stopped early' : 'In progress'))),
        el('p', { class: 'muted' }, 'The overall band is the average of the section bands, rounded to the nearest half band as in the real test. Speaking is not included.'))));

    page.appendChild(el('div', { class: 'section-cards' }, run.steps.map((s, i) => {
      const a = attempts[i];
      const m = MODULES[s.module];
      let body;
      if (!a) body = el('div', { class: 'sec-band muted' }, s.skipped ? 'Skipped' : 'Not taken');
      else if (s.module === 'writing') {
        body = el('div', null,
          el('div', { class: 'sec-band' }, a.band == null ? '–' : fmtBand(a.band)),
          el('div', { class: 'sec-sub' }, (a.wordCounts || []).map((w, k) => `Task ${k + 1}: ${w} words`).join(' · ')),
          el('a', { class: 'btn btn-sm ' + (a.band == null ? 'btn-primary' : ''), href: '#/result/' + a.id }, a.band == null ? '✎ Score your writing' : 'Details →'));
      } else {
        body = el('div', null,
          el('div', { class: 'sec-band' }, fmtBand(a.band)),
          el('div', { class: 'sec-sub' }, `${a.correct} / ${a.total} correct · ${fmtDuration(a.timeUsed)}`),
          el('a', { class: 'btn btn-sm', href: '#/result/' + a.id }, 'Details →'));
      }
      return el('section', { class: 'card sec-card mod-' + s.module },
        el('div', { class: 'sec-head' }, el('span', { class: 'badge badge-' + s.module }, m.icon + ' ' + m.label)),
        el('div', { class: 'sec-title' }, s.examTitle),
        body);
    })));
    return {};
  }
};
