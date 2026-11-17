/* ===== Dashboard: test library, import / export, full tests, history ===== */

const Dashboard = {
  filter: 'all',
  search: '',

  async mount(root, tab) {
    document.body.classList.add('theme-app');
    const [exams, attempts, runs] = await Promise.all([DB.listExams(), DB.listAttempts(), DB.listRuns()]);

    const page = el('div', { class: 'page' });
    root.appendChild(el('header', { class: 'app-header' },
      el('div', { class: 'brand' }, el('span', { class: 'brand-mark' }, 'IE'), el('div', null, el('b', null, 'IELTS Practice Studio'), el('small', null, 'Build your tests · practise like the real exam'))),
      el('nav', { class: 'tabs' },
        el('a', { href: '#/', class: tab === 'tests' ? 'active' : '' }, 'Tests'),
        el('a', { href: '#/history', class: tab === 'history' ? 'active' : '' }, `History (${attempts.length})`)
      )
    ));
    root.appendChild(page);

    runs.filter(r => r.status === 'running').forEach(r => page.appendChild(this.runBanner(r)));
    page.appendChild(this.statsRow(exams, attempts));
    if (tab === 'history') page.appendChild(this.historyView(attempts, runs));
    else page.appendChild(this.testsView(exams, attempts));
    this.enableDrop(page);
    return {};
  },

  runBanner(run) {
    const idx = FullTest.nextStep(run);
    const next = idx >= 0 ? MODULES[run.steps[idx].module].label : null;
    return el('div', { class: 'run-banner' },
      el('span', null, '🏁 ', el('b', null, 'Full test in progress'), next ? ` — next section: ${next}` : ''),
      el('div', { class: 'run-banner-actions' },
        el('button', { class: 'btn btn-sm btn-ghost', onclick: async () => { if (await FullTest.abandon(run)) App.render(); } }, 'Stop'),
        el('a', { class: 'btn btn-sm btn-primary', href: '#/run/' + run.id }, '▶ Continue')));
  },

  statsRow(exams, attempts) {
    const best = mod => {
      const bands = attempts.filter(a => a.module === mod && a.band != null).map(a => a.band);
      return bands.length ? fmtBand(Math.max(...bands)) : '–';
    };
    const avg = mod => {
      const bands = attempts.filter(a => a.module === mod && a.band != null).slice(0, 5).map(a => a.band);
      return bands.length ? fmtBand(Math.round(bands.reduce((s, b) => s + b, 0) / bands.length * 2) / 2) : '–';
    };
    const tile = (label, value, sub) => el('div', { class: 'stat' }, el('div', { class: 'stat-label' }, label), el('div', { class: 'stat-value' }, value), sub ? el('div', { class: 'stat-sub' }, sub) : null);
    return el('section', { class: 'stats' },
      tile('Tests in library', String(exams.length), `${exams.filter(e => e.module === 'reading').length} reading · ${exams.filter(e => e.module === 'listening').length} listening · ${exams.filter(e => e.module === 'writing').length} writing`),
      tile('Practice attempts', String(attempts.length), attempts[0] ? 'Last: ' + fmtDate(attempts[0].finishedAt) : 'No attempts yet'),
      tile('Reading band', avg('reading'), 'Average of last 5 · best ' + best('reading')),
      tile('Listening band', avg('listening'), 'Average of last 5 · best ' + best('listening'))
    );
  },

  /* ---------- tests library ---------- */
  testsView(exams, attempts) {
    const wrap = el('section');
    const list = el('div', { class: 'card-grid' });

    const newMenu = el('div', { class: 'dropdown' });
    newMenu.append(
      el('button', { class: 'btn btn-primary', onclick: () => newMenu.classList.toggle('open') }, '＋ New test'),
      el('div', { class: 'dropdown-menu' },
        Object.entries(MODULES).map(([key, m]) => el('button', {
          onclick: async () => { const ex = newExam(key); await DB.saveExam(ex); App.go('#/edit/' + ex.id); }
        }, `${m.icon}  ${m.label} test`))));

    const toolbar = el('div', { class: 'toolbar' },
      el('div', { class: 'chips' }, ['all', 'reading', 'listening', 'writing'].map(f =>
        el('button', { class: 'chip' + (this.filter === f ? ' active' : ''), onclick: () => { this.filter = f; App.render(); } },
          f === 'all' ? 'All' : MODULES[f].label))),
      el('input', {
        class: 'input search', type: 'search', placeholder: 'Search tests…', value: this.search,
        oninput: e => { this.search = e.target.value; renderList(); }
      }),
      el('div', { class: 'toolbar-right' },
        el('button', { class: 'btn', onclick: () => this.showImportHelp() }, '❓ How to add tests'),
        el('button', { class: 'btn', title: 'Import .txt or .json test files (with their audio / pictures)', onclick: () => this.importFlow() }, '⭳ Import'),
        el('button', { class: 'btn', onclick: () => this.exportAll(exams), disabled: !exams.length }, '⭱ Export all'),
        el('button', { class: 'btn btn-full', onclick: () => FullTest.openSetup() }, '🏁 Full test'),
        newMenu
      )
    );

    const renderList = () => {
      list.innerHTML = '';
      const q = this.search.trim().toLowerCase();
      const shown = exams.filter(e => (this.filter === 'all' || e.module === this.filter) && (!q || e.title.toLowerCase().includes(q)));
      if (!shown.length) {
        list.appendChild(el('div', { class: 'empty' },
          el('h3', null, exams.length ? 'No tests match' : 'No tests yet'),
          el('p', null, exams.length ? 'Try another filter.' : 'Create a test with “New test”, or import a test file (see “How to add tests”).'),
          exams.length ? null : el('button', { class: 'btn', onclick: async () => { for (const ex of sampleExams()) await DB.saveExam(ex); App.render(); } }, 'Add the sample tests')
        ));
        return;
      }
      shown.forEach(ex => list.appendChild(this.examCard(ex, attempts.filter(a => a.examId === ex.id))));
    };
    renderList();
    wrap.append(toolbar, list, el('p', { class: 'drop-hint muted' }, 'Tip: drag test files (.txt / .json) and their audio or pictures onto this page to import them.'));
    return wrap;
  },

  examCard(ex, attempts) {
    const m = MODULES[ex.module];
    const qCount = countQuestions(ex);
    let progress = null;
    try { progress = JSON.parse(localStorage.getItem('ielts-progress-' + ex.id) || 'null'); } catch { }
    const hasProgress = progress && !progress.runId;
    const last = attempts[0];
    const more = el('div', { class: 'dropdown' });
    more.append(
      el('button', { class: 'icon-btn', title: 'More actions', onclick: () => more.classList.toggle('open') }, '⋯'),
      el('div', { class: 'dropdown-menu right' },
        el('button', { onclick: () => this.duplicate(ex) }, 'Duplicate'),
        el('button', { onclick: () => this.exportText(ex) }, 'Export as text (.txt)'),
        el('button', { onclick: () => this.exportOne(ex) }, 'Export as backup (.json)'),
        el('button', { class: 'danger', onclick: () => this.remove(ex) }, 'Delete')
      )
    );

    const meta = ex.module === 'writing'
      ? `${ex.parts.length} task${ex.parts.length === 1 ? '' : 's'}`
      : `${qCount} question${qCount === 1 ? '' : 's'} · ${ex.parts.length} ${m.partName.toLowerCase()}${ex.parts.length === 1 ? '' : 's'}`;

    return el('article', { class: 'test-card mod-' + ex.module },
      el('div', { class: 'test-card-top' },
        el('span', { class: 'badge badge-' + ex.module }, m.icon + ' ' + m.label + (ex.module !== 'listening' ? ' · ' + (ex.variant === 'general' ? 'GT' : 'Academic') : '')),
        more
      ),
      el('h3', null, ex.title),
      ex.description ? el('p', { class: 'muted clamp' }, ex.description) : null,
      el('div', { class: 'test-meta' }, `${meta} · ⏱ ${ex.durationMinutes} min`),
      el('div', { class: 'test-last' },
        last ? (last.band != null
          ? `Last: ${last.module === 'writing' ? '' : last.correct + '/' + last.total + ' · '}Band ${fmtBand(last.band)}`
          : `Last attempt ${fmtDate(last.finishedAt)}`) : 'Not attempted yet',
        hasProgress ? el('span', { class: 'pill-warn' }, 'In progress') : null
      ),
      el('div', { class: 'test-actions' },
        el('a', { class: 'btn btn-primary', href: '#/test/' + ex.id }, hasProgress ? '▶ Resume' : '▶ Start'),
        el('a', { class: 'btn', href: '#/edit/' + ex.id }, '✎ Edit')
      )
    );
  },

  async duplicate(ex) {
    const copy = clone(ex);
    copy.id = uid('exam');
    copy.title = ex.title + ' (copy)';
    copy.createdAt = Date.now();
    const copyFile = async id => { const f = await DB.get('files', id); return f ? DB.saveFile(f.blob, f.name) : null; };
    for (const p of copy.parts) {
      for (const key of ['audioId', 'imageId']) if (p[key]) p[key] = await copyFile(p[key]);
      for (const g of p.groups) if (g.imageId) g.imageId = await copyFile(g.imageId);
    }
    await DB.saveExam(copy);
    toast('Test duplicated', 'ok');
    App.render();
  },

  async exportOne(ex) {
    downloadText(slugify(ex.title) + '.ielts.json', await exportExams([ex]));
  },

  async exportText(ex) {
    downloadText(slugify(ex.title) + '.txt', await examToText(ex), 'text/plain;charset=utf-8');
    if (examFileIds(ex).length) toast('Audio and pictures are not inside the .txt — keep those files next to it.', 'info', 4500);
  },

  async exportAll(exams) {
    downloadText('ielts-tests-backup-' + new Date().toISOString().slice(0, 10) + '.json', await exportExams(exams));
  },

  async remove(ex) {
    if (!await confirmDialog(`Delete “${ex.title}”? Its uploaded audio and images are deleted too. Your past results stay in History.`, { ok: 'Delete', danger: true })) return;
    await DB.deleteExam(ex);
    localStorage.removeItem('ielts-progress-' + ex.id);
    toast('Test deleted');
    App.render();
  },

  /* ---------- import ---------- */
  async importFlow() {
    const files = await pickFiles('.txt,.json,text/plain,application/json,audio/*,image/*');
    if (files.length) this.importFiles(files);
  },

  enableDrop(page) {
    let depth = 0;
    page.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { depth++; page.classList.add('drop-active'); } });
    page.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; page.classList.remove('drop-active'); } });
    page.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    page.addEventListener('drop', e => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault(); depth = 0; page.classList.remove('drop-active');
      this.importFiles(e.dataTransfer.files);
    });
  },

  async importFiles(fileList) {
    const files = Array.from(fileList);
    const isTest = f => /\.(txt|json)$/i.test(f.name);
    const testFiles = files.filter(isTest);
    const attachments = files.filter(f => !isTest(f));
    if (!testFiles.length) {
      modal({
        title: 'No test file selected',
        body: el('p', null, 'Select a .txt or .json test file. You can select its audio and pictures at the same time (hold Ctrl and click each file).'),
        actions: [{ label: 'OK', kind: 'primary' }]
      });
      return;
    }
    const report = [];
    for (const f of testFiles) {
      try {
        const text = await readFileAsText(f);
        if (/\.json$/i.test(f.name) || /^\s*[[{]/.test(text)) {
          (await importExamsFromJSON(text)).forEach(ex => report.push({ file: f.name, exam: ex, warnings: [] }));
        } else {
          const parsed = parseTestText(text);
          const missing = await tfAttachFiles(parsed, attachments);
          await DB.saveExam(parsed.exam);
          report.push({ file: f.name, exam: parsed.exam, warnings: [...parsed.warnings, ...missing] });
        }
      } catch (e) {
        report.push({ file: f.name, error: e.message || String(e) });
      }
    }
    await App.render();
    const ok = report.filter(r => r.exam).length;
    modal({
      title: ok ? `Imported ${ok} test${ok === 1 ? '' : 's'}` : 'Import failed', wide: true,
      body: el('div', { class: 'import-report' }, report.map(r => el('div', { class: 'imp-item' + (r.error ? ' imp-err' : r.warnings.length ? ' imp-warn' : ' imp-ok') },
        el('div', { class: 'imp-head' },
          el('span', { class: 'imp-icon' }, r.error ? '✗' : r.warnings.length ? '⚠' : '✓'),
          el('div', null,
            el('b', null, r.exam ? r.exam.title : r.file),
            el('small', null, r.error ? r.file : `${r.file} · ${MODULES[r.exam.module].label} · ${countQuestions(r.exam)} ${r.exam.module === 'writing' ? 'tasks' : 'questions'} · ${r.exam.parts.length} ${MODULES[r.exam.module].partName.toLowerCase()}(s)`)),
          r.exam ? el('a', { class: 'btn btn-sm', href: '#/edit/' + r.exam.id, onclick: () => $$('.modal-overlay').forEach(m => m.remove()) }, '✎ Check in editor') : null),
        r.error ? el('p', { class: 'imp-msg' }, r.error) : null,
        r.warnings && r.warnings.length ? el('ul', { class: 'imp-msg' }, r.warnings.map(w => el('li', null, w))) : null
      ))),
      actions: [{ label: 'Done', kind: 'primary' }]
    });
  },

  showImportHelp() {
    modal({
      title: 'How to add tests', wide: true,
      body: el('div', { class: 'help' },
        el('div', { html: `
          <p>There are three ways. The <b>text file</b> way is the fastest for whole tests.</p>
          <h4>1. Import a text file (recommended)</h4>
          <ol>
            <li>Open the <b>templates</b> folder inside the app folder and copy <code>reading-template.txt</code>, <code>listening-template.txt</code> or <code>writing-template.txt</code>.</li>
            <li>Replace the example text with your test (passage, questions, answers). Save it.</li>
            <li>Click <b>⭳ Import</b> and choose the .txt file. For Listening, select the audio files <b>at the same time</b> (hold Ctrl). You can also drag the files onto this page.</li>
            <li>Check the import report, then click <b>Check in editor</b> to look over the result.</li>
          </ol>
          <p>The full description of the format, with every question type, is in <b>HOW-TO-ADD-TESTS.md</b> in the app folder.</p>
          <h4>2. Type it in the editor</h4>
          <p><b>＋ New test</b> → fill in the passage, then add question groups one by one. Use “📋 Paste many” to paste a list of questions with answers.</p>
          <h4>3. Backup files (.json)</h4>
          <p><b>Export all</b> makes one .json file with every test, including audio and pictures. Import it on another computer or browser.</p>` }),
        el('h4', null, 'A tiny example'),
        el('pre', null, `TITLE: My first test
MODULE: Reading
TIME: 20

=== PASSAGE 1 ===
TITLE: The History of Tea
TEXT:
[A] Tea was first drunk in China…

[B] It reached Europe in the 1600s…

--- TRUE FALSE NOT GIVEN ---
QUESTIONS:
1. Tea was first drunk in India. | FALSE
2. Tea reached Europe in the 1600s. | TRUE

--- SENTENCE COMPLETION ---
TEXT:
Tea was first drunk in [[China]].`),
        el('div', { class: 'row-actions' },
          el('button', { class: 'btn', onclick: async () => downloadText('example-reading.txt', await examToText(sampleExams()[0]), 'text/plain;charset=utf-8') }, '⭳ Download a full example (.txt)'))),
      actions: [{ label: 'Close', kind: 'primary' }]
    });
  },

  /* ---------- history ---------- */
  historyView(attempts, runs) {
    const wrap = el('div');
    const byId = Object.fromEntries(attempts.map(a => [a.id, a]));

    if (runs.length) {
      const bandOf = (run, mod) => { const s = run.steps.find(x => x.module === mod); const a = s && byId[s.attemptId]; return a && a.band != null ? fmtBand(a.band) : (s ? (a ? '…' : '–') : ''); };
      wrap.appendChild(el('section', { class: 'panel history-block' },
        el('h3', { class: 'panel-title' }, '🏁 Full tests'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
          el('thead', null, el('tr', null, ['Date', 'Listening', 'Reading', 'Writing', 'Overall', 'Status', ''].map(h => el('th', null, h)))),
          el('tbody', null, runs.map(r => {
            const overall = overallBand(r.steps.map(s => byId[s.attemptId] ? byId[s.attemptId].band : null));
            return el('tr', { class: 'clickable', onclick: e => { if (!e.target.closest('button')) App.go(r.status === 'running' ? '#/run/' + r.id : '#/full/' + r.id); } },
              el('td', null, fmtDate(r.createdAt)),
              el('td', null, bandOf(r, 'listening')),
              el('td', null, bandOf(r, 'reading')),
              el('td', null, bandOf(r, 'writing')),
              el('td', null, overall == null ? '–' : el('b', null, fmtBand(overall))),
              el('td', null, r.status === 'done' ? 'Finished' : r.status === 'running' ? el('span', { class: 'pill-warn' }, 'In progress') : 'Stopped'),
              el('td', null, el('button', {
                class: 'icon-btn', title: 'Delete full test record',
                onclick: async () => {
                  if (!await confirmDialog('Delete this full test record? The single-section results stay in the list below.', { ok: 'Delete', danger: true })) return;
                  await DB.delete('runs', r.id); App.render();
                }
              }, '🗑')));
          }))))));
    }

    const panel = el('section', { class: 'panel history-block' }, el('h3', { class: 'panel-title' }, 'All attempts'));
    wrap.appendChild(panel);
    if (!attempts.length) {
      panel.appendChild(el('div', { class: 'empty' }, el('h3', null, 'No attempts yet'), el('p', null, 'Finish a test and your results will appear here.')));
      return wrap;
    }
    panel.appendChild(el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('thead', null, el('tr', null, ['Date', 'Test', 'Module', 'Score', 'Band', 'Time used', 'Mode', ''].map(h => el('th', null, h)))),
      el('tbody', null, attempts.map(a => el('tr', { class: 'clickable', onclick: e => { if (!e.target.closest('button')) App.go('#/result/' + a.id); } },
        el('td', null, fmtDate(a.finishedAt)),
        el('td', null, el('b', null, a.examTitle), a.runId ? el('span', { class: 'muted' }, ' · full test') : null),
        el('td', null, el('span', { class: 'badge badge-' + a.module }, MODULES[a.module]?.label || a.module)),
        el('td', null, a.module === 'writing' ? (a.wordCounts || []).map(w => w + ' words').join(' / ') : `${a.correct} / ${a.total}`),
        el('td', null, a.band != null ? el('b', null, fmtBand(a.band)) : '–'),
        el('td', null, fmtDuration(a.timeUsed)),
        el('td', null, a.mode === 'practice' ? 'Practice' : 'Exam'),
        el('td', null, el('button', {
          class: 'icon-btn', title: 'Delete attempt',
          onclick: async () => {
            if (!await confirmDialog('Delete this attempt from your history?', { ok: 'Delete', danger: true })) return;
            await DB.delete('attempts', a.id); App.render();
          }
        }, '🗑'))
      ))))));
    return wrap;
  }
};
