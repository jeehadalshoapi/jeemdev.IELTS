/* ===== Test editor (core): details, passages / parts / tasks, autosave ===== */

const Editor = {
  exam: null,
  main: null,
  status: null,

  async mount(root, id) {
    document.body.classList.add('theme-app');
    const raw = await DB.get('exams', id);
    if (!raw) {
      root.appendChild(el('div', { class: 'page' }, el('div', { class: 'empty' }, el('h2', null, 'Test not found'), el('a', { class: 'btn btn-primary', href: '#/' }, 'Back to dashboard'))));
      return {};
    }
    this.exam = normalizeExam(raw);
    this.save = debounce(async () => {
      try { await DB.saveExam(this.exam); this.setStatus('Saved ✓', 'ok'); }
      catch (e) { this.setStatus('Could not save: ' + e.message, 'err'); }
    }, 600);

    this.status = el('span', { class: 'save-status' }, 'All changes saved');
    this.countEl = el('span', { class: 'q-count' });
    this.issuesBtn = el('button', { class: 'btn btn-sm btn-warn hidden', onclick: () => this.showIssues() });

    root.appendChild(el('header', { class: 'app-header' },
      el('div', { class: 'brand' },
        el('a', { class: 'icon-btn back', href: '#/', title: 'Back to dashboard' }, '←'),
        el('div', null, el('b', null, 'Test editor'), el('small', null, this.status))),
      el('div', { class: 'header-actions' },
        this.countEl, this.issuesBtn,
        el('button', { class: 'btn', onclick: () => this.showHelp() }, '? Formatting help'),
        el('button', { class: 'btn', onclick: async () => { await this.save.flush(); Dashboard.exportOne(this.exam); } }, '⭱ Export'),
        el('button', { class: 'btn btn-primary', onclick: async () => { await this.save.flush(); App.go('#/test/' + this.exam.id); } }, '▶ Try this test')
      )
    ));
    this.main = el('div', { class: 'page editor' });
    root.appendChild(this.main);
    this.render();

    return {
      canLeave: async () => { await this.save.flush(); return true; },
      destroy: () => { this.save.flush(); }
    };
  },

  setStatus(text, kind) {
    if (!this.status) return;
    this.status.textContent = text;
    this.status.className = 'save-status ' + (kind || '');
  },

  /** call after any edit */
  touch(structural = false) {
    this.setStatus('Saving…');
    this.save();
    if (structural) this.render(); else this.refreshNumbers();
  },

  render() {
    const y = window.scrollY;
    this.main.innerHTML = '';
    this.main.appendChild(this.detailsCard());
    this.exam.parts.forEach((p, i) => this.main.appendChild(this.partCard(p, i)));
    const m = MODULES[this.exam.module];
    this.main.appendChild(el('button', {
      class: 'btn btn-dashed add-part',
      onclick: () => { this.exam.parts.push(newPart(this.exam.module, this.exam.parts.length)); this.touch(true); }
    }, `＋ Add ${m.partName.toLowerCase()}`));
    this.refreshNumbers();
    window.scrollTo(0, y);
  },

  /* ---------- live numbering + issues ---------- */
  refreshNumbers() {
    const ex = this.exam;
    const { groupRange, itemStart, slots } = numberExam(ex);
    $$('[data-range]', this.main).forEach(n => { n.textContent = rangeText(groupRange[n.dataset.range]) || 'No questions yet'; });
    $$('[data-qnum]', this.main).forEach(n => {
      const start = itemStart[n.dataset.qnum];
      const s = slots.find(x => x.qid === n.dataset.qnum);
      n.textContent = start == null ? '?' : (s && s.count > 1 ? `${start}–${start + s.count - 1}` : String(start));
    });
    $$('[data-gaps]', this.main).forEach(n => this.renderGapList(n));
    if (ex.module === 'writing') this.countEl.textContent = `${ex.parts.length} task${ex.parts.length === 1 ? '' : 's'}`;
    else this.countEl.textContent = `${slots.length} question${slots.length === 1 ? '' : 's'}${slots.length !== 40 ? ' (full test = 40)' : ' ✓'}`;
    const issues = this.findIssues();
    this.issuesBtn.classList.toggle('hidden', !issues.length);
    this.issuesBtn.textContent = `⚠ ${issues.length} issue${issues.length === 1 ? '' : 's'}`;
  },

  findIssues() {
    const ex = this.exam, out = [];
    if (ex.module === 'writing') {
      ex.parts.forEach(p => { if (!p.prompt.trim()) out.push(`${p.title}: the task has no question text.`); });
      return out;
    }
    const { slots } = numberExam(ex);
    const seen = new Set();
    ex.parts.forEach((p, pi) => {
      if (ex.module === 'reading' && !p.passage.trim()) out.push(`${p.title}: the passage is empty.`);
      if (ex.module === 'listening' && !p.audioId) out.push(`${p.title}: no audio uploaded (you can still practise without it).`);
      if (!p.groups.length) out.push(`${p.title}: no questions yet.`);
    });
    for (const s of slots) {
      if (seen.has(s.qid)) continue;
      seen.add(s.qid);
      const ans = s.item.answer;
      const label = s.count > 1 ? `Questions ${s.num}–${s.num + s.count - 1}` : `Question ${s.num}`;
      if (s.type === 'mcq_multi') {
        if (!(ans || []).length) out.push(`${label}: tick the correct options.`);
      } else if (!String(ans || '').trim()) out.push(`${label}: no correct answer set.`);
      if ((s.type === 'mcq' || s.type === 'mcq_multi') && (s.item.options || []).some(o => !String(o).trim())) out.push(`${label}: an option is empty.`);
      if (s.type === 'matching' || (s.type === 'completion' && s.group.options.length)) {
        const labels = s.group.options.map(o => String(o.label).toLowerCase());
        if (ans && !String(ans).split('/').some(a => labels.includes(a.trim().toLowerCase()))) out.push(`${label}: answer “${ans}” is not one of the option labels.`);
      }
    }
    return out;
  },

  showIssues() {
    const issues = this.findIssues();
    modal({
      title: 'Things to check',
      body: issues.length ? el('ul', { class: 'issues' }, issues.map(i => el('li', null, i))) : el('p', null, 'Everything looks good.'),
      actions: [{ label: 'OK', kind: 'primary' }]
    });
  },

  /* ---------- small field helpers ---------- */
  field(label, input, hint) {
    return el('div', { class: 'field' }, el('span', { class: 'field-label' }, label), input, hint ? el('small', { class: 'hint', html: hint }) : null);
  },
  input(obj, key, attrs = {}, structural = false) {
    const numeric = attrs.type === 'number';
    if (numeric) attrs = Object.assign({}, attrs, { type: 'text', inputmode: 'numeric', min: null, max: null });
    const toNum = v => Number(String(v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[^\d.]/g, '')) || 0;
    return el('input', Object.assign({ class: 'input', type: 'text', value: obj[key] ?? '' }, attrs, {
      oninput: e => { obj[key] = numeric ? toNum(e.target.value) : e.target.value; this.touch(); },
      onchange: structural ? () => this.render() : null
    }));
  },
  area(obj, key, rows = 4, attrs = {}) {
    return el('textarea', Object.assign({ class: 'input', rows, value: obj[key] ?? '', spellcheck: 'true' }, attrs, {
      oninput: e => { obj[key] = e.target.value; this.touch(); }
    }));
  },
  select(obj, key, options, onChange) {
    const s = el('select', { class: 'input', onchange: e => { obj[key] = e.target.value; onChange ? onChange(e.target.value) : this.touch(); } },
      options.map(([v, l]) => el('option', { value: v, selected: String(obj[key]) === String(v) }, l)));
    return s;
  },
  moveBtns(arr, i) {
    return [
      el('button', { class: 'icon-btn', title: 'Move up', disabled: i === 0, onclick: () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; this.touch(true); } }, '↑'),
      el('button', { class: 'icon-btn', title: 'Move down', disabled: i === arr.length - 1, onclick: () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; this.touch(true); } }, '↓')
    ];
  },

  /** upload / preview / remove an audio or image file stored in IndexedDB */
  fileField(obj, key, kind) {
    const box = el('div', { class: 'file-field' });
    const draw = async () => {
      box.innerHTML = '';
      const id = obj[key];
      const info = id ? await DB.fileInfo(id) : null;
      if (info) {
        const url = await DB.fileURL(id);
        box.appendChild(kind === 'audio'
          ? el('audio', { controls: true, src: url, preload: 'metadata', class: 'audio-preview' })
          : el('img', { src: url, class: 'img-preview', alt: '' }));
        box.appendChild(el('div', { class: 'file-row' },
          el('span', { class: 'muted' }, `${info.name} · ${(info.size / 1048576).toFixed(1)} MB`),
          el('button', { class: 'btn btn-sm', onclick: upload }, 'Replace'),
          el('button', { class: 'btn btn-sm btn-ghost danger', onclick: async () => { await DB.deleteFile(id); obj[key] = null; this.touch(); draw(); } }, 'Remove')));
      } else {
        box.appendChild(el('button', { class: 'btn btn-dashed', onclick: upload }, kind === 'audio' ? '🎵 Upload audio (mp3, m4a, wav…)' : '🖼 Upload image (chart, map, diagram)'));
      }
    };
    const upload = async () => {
      const file = await pickFile(kind === 'audio' ? 'audio/*' : 'image/*');
      if (!file) return;
      this.setStatus('Uploading…');
      const old = obj[key];
      obj[key] = await DB.saveFile(file, file.name);
      if (old) await DB.deleteFile(old);
      this.touch();
      draw();
    };
    draw();
    return box;
  },

  /* ---------- test details ---------- */
  detailsCard() {
    const ex = this.exam;
    return el('section', { class: 'card' },
      el('h2', { class: 'card-title' }, 'Test details'),
      el('div', { class: 'grid-2' },
        this.field('Test title', this.input(ex, 'title', { placeholder: 'e.g. Cambridge 18 — Test 1 Reading' })),
        el('div', { class: 'grid-3' },
          this.field('Module', this.select(ex, 'module', Object.entries(MODULES).map(([k, m]) => [k, m.label]), v => {
            ex.parts.forEach((p, i) => { if (/^(Passage|Part|Task) \d+$/.test(p.title)) p.title = `${MODULES[v].partName} ${i + 1}`; });
            this.touch(true);
          })),
          ex.module !== 'listening'
            ? this.field('Type', this.select(ex, 'variant', [['academic', 'Academic'], ['general', 'General Training']]))
            : el('div'),
          this.field('Time (minutes)', this.input(ex, 'durationMinutes', { type: 'number', min: 1, max: 240 }))
        )
      ),
      this.field('Description (optional)', this.area(ex, 'description', 2, { placeholder: 'Source, notes, difficulty…' }))
    );
  },

  /* ---------- part / passage / task ---------- */
  partCard(p, i) {
    const ex = this.exam;
    const card = el('section', { class: 'card part-card' });
    card.appendChild(el('div', { class: 'card-head' },
      el('input', { class: 'input title-input', value: p.title, oninput: e => { p.title = e.target.value; this.touch(); } }),
      el('div', { class: 'head-actions' },
        this.moveBtns(ex.parts, i),
        el('button', {
          class: 'icon-btn danger', title: 'Delete', onclick: async () => {
            if (!await confirmDialog(`Delete “${p.title}” and all its questions?`, { ok: 'Delete', danger: true })) return;
            for (const fid of examFileIds({ parts: [p] })) await DB.deleteFile(fid);
            ex.parts.splice(i, 1); this.touch(true);
          }
        }, '🗑'))
    ));

    if (ex.module === 'reading') {
      const preview = el('div', { class: 'passage-preview hidden' });
      card.append(
        this.field('Passage title', this.input(p, 'passageTitle', { placeholder: 'e.g. The Return of the Urban Beekeeper' })),
        this.field('Passage text', this.area(p, 'passage', 14, { placeholder: 'Paste the reading passage here…' }),
          'Blank line = new paragraph · start a paragraph with <code>[A]</code> to label it · <code>## Sub-heading</code> · <code>**bold**</code> · <code>*italic*</code>'),
        el('button', {
          class: 'btn btn-sm', onclick: e => {
            preview.classList.toggle('hidden');
            preview.innerHTML = `<h3>${esc(p.passageTitle)}</h3>` + renderPassageHTML(p.passage);
            e.target.textContent = preview.classList.contains('hidden') ? 'Preview passage' : 'Hide preview';
          }
        }, 'Preview passage'),
        preview
      );
    } else if (ex.module === 'listening') {
      card.append(
        this.field('Audio for this part', this.fileField(p, 'audioId', 'audio'), 'Tip: if you have one audio file for the whole test, upload it on Part 1 only.'),
        el('details', { class: 'details' }, el('summary', null, 'Transcript (optional — shown after you finish)'), this.area(p, 'transcript', 6))
      );
    } else {
      card.append(
        this.field('Task question', this.area(p, 'prompt', 10, { placeholder: 'Paste the task instructions and question…' }), 'Blank line = new paragraph · <code>**bold**</code> · <code>*italic*</code>'),
        el('div', { class: 'grid-2' },
          this.field('Chart / diagram / picture (optional)', this.fileField(p, 'imageId', 'image')),
          this.field('Minimum words', this.input(p, 'minWords', { type: 'number', min: 0 }))),
        this.field('Model answer (optional — shown after you finish)', this.area(p, 'modelAnswer', 6))
      );
      return card;
    }

    // question groups
    const groupsBox = el('div', { class: 'groups' });
    p.groups.forEach((g, gi) => groupsBox.appendChild(GroupEditor.card(this, p, g, gi)));
    const typeSel = el('select', { class: 'input' }, Object.entries(QTYPES).map(([k, t]) => el('option', { value: k }, t.label)));
    card.append(
      el('h3', { class: 'sub-title' }, 'Questions'),
      groupsBox,
      el('div', { class: 'add-group' },
        typeSel,
        el('button', {
          class: 'btn btn-primary', onclick: () => {
            const g = newGroup(typeSel.value);
            if (ex.module === 'listening') {
              const listenInstr = {
                completion: 'Complete the notes below.\n\nWrite **ONE WORD AND/OR A NUMBER** for each answer.',
                short: 'Answer the questions below.\n\nWrite **NO MORE THAN TWO WORDS AND/OR A NUMBER** for each answer.',
                matching: 'What does the speaker say about each of the following?\n\nChoose the correct letter for each question.'
              };
              if (listenInstr[g.type]) g.instructions = listenInstr[g.type];
              if (g.type === 'matching') { g.labelStyle = 'upper'; g.options.forEach((o, i) => { o.label = makeLabel('upper', i); }); }
            }
            p.groups.push(g); this.touch(true);
          }
        }, '＋ Add question group'))
    );
    return card;
  },

  renderGapList(node) {
    const g = this.findGroup(node.dataset.gaps);
    if (!g) return;
    const { itemStart } = numberExam(this.exam);
    const items = groupItems(g);
    node.innerHTML = '';
    if (!items.length) { node.appendChild(el('span', { class: 'muted' }, 'No gaps yet — put each answer in [[double brackets]].')); return; }
    items.forEach(it => node.appendChild(el('span', { class: 'gap-chip' }, el('b', null, itemStart[it.id]), ' ', it.answer || '(empty)')));
  },

  findGroup(id) {
    for (const p of this.exam.parts) for (const g of p.groups) if (g.id === id) return g;
    return null;
  },

  showHelp() {
    modal({
      title: 'How to write tests', wide: true,
      body: el('div', { class: 'help', html: `
        <h4>Passages</h4>
        <p>Leave a blank line between paragraphs. Start a paragraph with <code>[A]</code>, <code>[B]</code>… to show a paragraph letter. <code>## Heading</code> makes a sub-heading. <code>**bold**</code> and <code>*italic*</code> work everywhere.</p>
        <h4>Answers</h4>
        <ul>
          <li>Several accepted answers: separate them with <code>/</code> → <code>lamp / light</code></li>
          <li>Optional words go in brackets → <code>(the) river</code> accepts “the river” and “river”</li>
          <li>Marking ignores capital letters, extra spaces and a final full stop.</li>
        </ul>
        <h4>Completion questions (sentence, summary, notes, table, flow-chart)</h4>
        <p>Type the text and put each answer in double brackets — each one becomes a numbered gap:</p>
        <pre>The bridge was opened in [[1932]] by the [[(local) mayor]].</pre>
        <p>Inside the completion text you can also use:</p>
        <pre># A heading
- a bullet line with a [[gap]]
Column 1 | Column 2 | Column 3
Row text | [[answer]] | more text
> first step of a flow-chart
> second step with a [[gap]]</pre>
        <p>A line with <code>|</code> becomes a table row (the first row is the header). Lines starting with <code>&gt; </code> become flow-chart boxes.</p>
        <p><b>Word bank</b> (summary with a list of words A–I): tick “Use a word bank”, add the words, and put the letter in the gap: <code>[[C]]</code>.</p>
        <h4>Diagram / map labelling</h4>
        <p>Use a completion group, upload the image to the group, and write one line per label: <code>Entrance to the park: [[gate]]</code>.</p>
        <h4>Full tests</h4>
        <p>A real Reading or Listening test has 40 questions; the band score is estimated from your score scaled to 40.</p>` }),
      actions: [{ label: 'Got it', kind: 'primary' }]
    });
  }
};
