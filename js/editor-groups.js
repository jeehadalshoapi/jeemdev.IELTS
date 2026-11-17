/* ===== Test editor: question-group editors (one per question type) ===== */

const GroupEditor = {
  card(E, part, g, gi) {
    const card = el('div', { class: 'group-card type-' + g.type });
    const typeSel = el('select', {
      class: 'input type-select',
      onchange: e => { this.convert(g, e.target.value); E.touch(true); }
    }, Object.entries(QTYPES).map(([k, t]) => el('option', { value: k, selected: k === g.type }, t.label)));

    card.appendChild(el('div', { class: 'group-head' },
      el('span', { class: 'range', dataset: { range: g.id } }),
      typeSel,
      el('div', { class: 'head-actions' },
        E.moveBtns(part.groups, gi),
        el('button', {
          class: 'icon-btn danger', title: 'Delete group', onclick: async () => {
            if (!await confirmDialog('Delete this question group?', { ok: 'Delete', danger: true })) return;
            if (g.imageId) await DB.deleteFile(g.imageId);
            part.groups.splice(gi, 1); E.touch(true);
          }
        }, '🗑'))
    ));

    card.appendChild(el('div', { class: 'grid-2' },
      E.field('Instructions', E.area(g, 'instructions', 4)),
      el('div', null,
        E.field('Title above the questions (optional)', E.input(g, 'title', { placeholder: 'e.g. List of Headings · Notes on the museum' })),
        el('details', { class: 'details', open: !!g.imageId }, el('summary', null, 'Picture (optional — map / diagram labelling)'), E.fileField(g, 'imageId', 'image'))
      )
    ));

    if (g.type === 'tfng' || g.type === 'ynng' || g.type === 'short') card.appendChild(this.listEditor(E, g));
    else if (g.type === 'mcq' || g.type === 'mcq_multi') card.appendChild(this.mcqEditor(E, g, g.type === 'mcq_multi'));
    else if (g.type === 'matching') card.appendChild(this.matchingEditor(E, g));
    else if (g.type === 'completion') card.appendChild(this.completionEditor(E, g));
    return card;
  },

  convert(g, t) {
    const oldDefault = QTYPES[g.type].instructions;
    if (!g.instructions.trim() || g.instructions === oldDefault) g.instructions = QTYPES[t].instructions;
    const swap = { TRUE: 'YES', FALSE: 'NO', YES: 'TRUE', NO: 'FALSE', 'NOT GIVEN': 'NOT GIVEN' };
    g.type = t;
    if (t === 'completion') return;
    if (!g.questions.length) g.questions = [newQuestion(t)];
    g.questions.forEach(q => {
      if ((t === 'mcq' || t === 'mcq_multi') && !Array.isArray(q.options)) q.options = ['', '', '', ''];
      if (t === 'mcq_multi') { if (!Array.isArray(q.answer)) q.answer = parseLetterList(q.answer); }
      else if (Array.isArray(q.answer)) q.answer = q.answer[0] || '';
      if (t === 'tfng' || t === 'ynng') {
        const a = String(q.answer || '').toUpperCase();
        q.answer = QTYPES[t].choices.includes(a) ? a : (swap[a] && QTYPES[t].choices.includes(swap[a]) ? swap[a] : '');
      }
    });
    if (t === 'matching' && !g.options.length) {
      g.labelStyle = 'roman';
      g.options = [0, 1, 2, 3, 4].map(i => ({ label: makeLabel('roman', i), text: '' }));
    }
  },

  normChoice(type, a) {
    a = String(a || '').trim().toUpperCase().replace(/\./g, '');
    const map = { T: 'TRUE', F: 'FALSE', NG: 'NOT GIVEN', 'NOT-GIVEN': 'NOT GIVEN', Y: 'YES', N: 'NO' };
    a = map[a] || a;
    return QTYPES[type].choices.includes(a) ? a : '';
  },

  addButtons(E, g, onAdd) {
    return el('div', { class: 'row-actions' },
      el('button', { class: 'btn btn-sm', onclick: () => { onAdd(); E.touch(true); } }, '＋ Add question'),
      el('button', { class: 'btn btn-sm btn-ghost', onclick: () => this.bulkPaste(E, g) }, '📋 Paste many')
    );
  },

  async bulkPaste(E, g) {
    const examples = {
      tfng: 'The museum opened in 1990 | FALSE\nVisitors can take photographs | NOT GIVEN',
      ynng: 'The writer supports the plan | YES',
      short: 'Where did the first trial take place? | (in) Leeds',
      matching: 'Paragraph B | iii\nParagraph C | i',
      mcq: '', mcq_multi: ''
    };
    const txt = await promptDialog({
      title: 'Paste many questions', multiline: true, ok: 'Add',
      label: 'One question per line. Put the answer after a | sign (optional). Leading numbers like “5.” are removed.',
      placeholder: examples[g.type] || ''
    });
    if (!txt) return;
    const rows = txt.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const idx = line.lastIndexOf('|');
      let text = idx >= 0 ? line.slice(0, idx).trim() : line;
      let ans = idx >= 0 ? line.slice(idx + 1).trim() : '';
      text = text.replace(/^\(?\d{1,2}[.)]\s*/, '');
      if (g.type === 'tfng' || g.type === 'ynng') ans = this.normChoice(g.type, ans);
      return Object.assign(newQuestion(g.type), { text, answer: ans });
    });
    if (g.questions.length === 1 && !g.questions[0].text.trim()) g.questions = [];
    g.questions.push(...rows);
    E.touch(true);
  },

  delBtn(E, arr, i) {
    return el('button', { class: 'icon-btn danger', title: 'Remove', onclick: () => { arr.splice(i, 1); E.touch(true); } }, '✕');
  },

  /* ---- TRUE/FALSE/NOT GIVEN, YES/NO/NOT GIVEN, short answer ---- */
  listEditor(E, g) {
    const box = el('div', { class: 'q-rows' });
    g.questions.forEach((q, qi) => {
      let ansCtl;
      if (g.type === 'short') {
        ansCtl = el('input', { class: 'input ans-input', value: q.answer, placeholder: 'Answer (alt / alt)', oninput: e => { q.answer = e.target.value; E.touch(); } });
      } else {
        ansCtl = el('div', { class: 'seg' }, QTYPES[g.type].choices.map(c =>
          el('button', {
            class: 'seg-btn' + (q.answer === c ? ' on' : ''),
            onclick: e => { q.answer = c; $$('.seg-btn', e.target.parentNode).forEach(b => b.classList.toggle('on', b === e.target)); E.touch(); }
          }, c === 'NOT GIVEN' ? 'NG' : c[0] + c.slice(1).toLowerCase())));
      }
      box.appendChild(el('div', { class: 'q-row' },
        el('span', { class: 'qnum', dataset: { qnum: q.id } }),
        el('input', { class: 'input', value: q.text, placeholder: g.type === 'short' ? 'Question' : 'Statement', oninput: e => { q.text = e.target.value; E.touch(); } }),
        ansCtl,
        this.delBtn(E, g.questions, qi)
      ));
    });
    box.appendChild(this.addButtons(E, g, () => g.questions.push(newQuestion(g.type))));
    return box;
  },

  /* ---- multiple choice ---- */
  mcqEditor(E, g, multi) {
    const box = el('div', { class: 'mcq-list' });
    g.questions.forEach((q, qi) => {
      const opts = el('div', { class: 'mcq-opts' });
      q.options.forEach((o, oi) => {
        const L = makeLabel('upper', oi);
        const correct = multi ? (q.answer || []).includes(L) : q.answer === L;
        opts.appendChild(el('div', { class: 'mcq-opt' + (correct ? ' correct' : '') },
          el('label', { class: 'mcq-correct', title: 'Correct answer' },
            el('input', {
              type: multi ? 'checkbox' : 'radio', name: 'ans_' + q.id, checked: correct,
              onchange: e => {
                if (multi) {
                  const set = new Set(q.answer || []);
                  e.target.checked ? set.add(L) : set.delete(L);
                  q.answer = [...set].sort();
                } else q.answer = L;
                $$('.mcq-opt', opts).forEach((row, ri) => row.classList.toggle('correct', multi ? q.answer.includes(makeLabel('upper', ri)) : q.answer === makeLabel('upper', ri)));
                E.touch();
              }
            }), el('b', null, L)),
          el('input', { class: 'input', value: o, placeholder: 'Option ' + L, oninput: e => { q.options[oi] = e.target.value; E.touch(); } })
        ));
      });
      box.appendChild(el('div', { class: 'mcq-q' },
        el('div', { class: 'q-row' },
          el('span', { class: 'qnum', dataset: { qnum: q.id } }),
          el('input', { class: 'input', value: q.text, placeholder: 'Question / sentence beginning', oninput: e => { q.text = e.target.value; E.touch(); } }),
          this.delBtn(E, g.questions, qi)),
        el('small', { class: 'hint' }, multi ? 'Tick every correct option — each correct option counts as one question number.' : 'Tick the correct option.'),
        opts,
        el('div', { class: 'row-actions' },
          el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { q.options.push(''); E.touch(true); } }, '＋ Option'),
          el('button', {
            class: 'btn btn-sm btn-ghost', disabled: q.options.length <= 2, onclick: () => {
              q.options.pop();
              const last = makeLabel('upper', q.options.length);
              if (multi) q.answer = (q.answer || []).filter(a => a !== last); else if (q.answer === last) q.answer = '';
              E.touch(true);
            }
          }, '－ Option'))
      ));
    });
    box.appendChild(el('div', { class: 'row-actions' },
      el('button', { class: 'btn btn-sm', onclick: () => { g.questions.push(newQuestion(g.type)); E.touch(true); } }, '＋ Add question')));
    return box;
  },

  /* ---- option list (matching options, completion word bank) ---- */
  optionsEditor(E, g, title) {
    const box = el('div', { class: 'opt-editor' });
    box.appendChild(el('div', { class: 'opt-head' },
      el('b', null, title),
      el('span', { class: 'muted' }, 'Labels:'),
      E.select(g, 'labelStyle', [['roman', 'i, ii, iii'], ['upper', 'A, B, C'], ['lower', 'a, b, c'], ['number', '1, 2, 3']], v => {
        g.options.forEach((o, i) => { o.label = makeLabel(v, i); });
        E.touch(true);
      })
    ));
    g.options.forEach((o, oi) => box.appendChild(el('div', { class: 'opt-row' },
      el('input', { class: 'input opt-label', value: o.label, onchange: e => { o.label = e.target.value.trim(); E.touch(true); } }),
      el('input', { class: 'input', value: o.text, placeholder: 'Option text (can be empty, e.g. for paragraph letters)', oninput: e => { o.text = e.target.value; E.touch(); } }),
      this.delBtn(E, g.options, oi)
    )));
    box.appendChild(el('div', { class: 'row-actions' },
      el('button', { class: 'btn btn-sm btn-ghost', onclick: () => { g.options.push({ label: makeLabel(g.labelStyle, g.options.length), text: '' }); E.touch(true); } }, '＋ Option'),
      el('button', {
        class: 'btn btn-sm btn-ghost', onclick: async () => {
          const txt = await promptDialog({ title: 'Paste options', label: 'One option per line. Labels are added automatically.', multiline: true, ok: 'Add' });
          if (!txt) return;
          const lines = txt.split('\n').map(l => l.trim()).filter(Boolean)
            .map(l => l.replace(/^([ivx]{1,5}|[A-Za-z]|\d{1,2})[.)]\s+/, ''));
          if (g.options.every(o => !o.text.trim())) g.options = [];
          lines.forEach(t => g.options.push({ label: makeLabel(g.labelStyle, g.options.length), text: t }));
          E.touch(true);
        }
      }, '📋 Paste options')
    ));
    return box;
  },

  /* ---- matching ---- */
  matchingEditor(E, g) {
    const box = el('div', { class: 'matching-editor' });
    box.appendChild(this.optionsEditor(E, g, 'Options to choose from'));
    box.appendChild(el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: g.reuse, onchange: e => { g.reuse = e.target.checked; E.touch(); } }),
      ' Options can be used more than once'));

    const rows = el('div', { class: 'q-rows' });
    rows.appendChild(el('b', null, 'Questions'));
    g.questions.forEach((q, qi) => rows.appendChild(el('div', { class: 'q-row' },
      el('span', { class: 'qnum', dataset: { qnum: q.id } }),
      el('input', { class: 'input', value: q.text, placeholder: 'e.g. Paragraph B · a statement · a sentence beginning', oninput: e => { q.text = e.target.value; E.touch(); } }),
      el('select', { class: 'input ans-select', onchange: e => { q.answer = e.target.value; E.touch(); } },
        el('option', { value: '' }, 'Answer…'),
        g.options.map(o => el('option', { value: o.label, selected: String(q.answer).toLowerCase() === String(o.label).toLowerCase() }, o.label + (o.text ? ' — ' + o.text.slice(0, 40) : '')))),
      this.delBtn(E, g.questions, qi)
    )));
    rows.appendChild(this.addButtons(E, g, () => g.questions.push(newQuestion('matching'))));
    box.appendChild(rows);
    return box;
  },

  /* ---- completion ---- */
  completionEditor(E, g) {
    const box = el('div', { class: 'completion-editor' });
    box.appendChild(E.field('Text with gaps', E.area(g, 'content', 8, { class: 'input mono' }),
      'Put each answer in double brackets: <code>[[answer]]</code> or <code>[[colour / color]]</code>. Use <code># heading</code>, <code>- bullet</code>, <code>a | b | c</code> table rows, <code>&gt; step</code> flow-chart boxes. See “Formatting help”.'));
    box.appendChild(el('div', { class: 'gap-list', dataset: { gaps: g.id } }));
    const useBank = g.options.length > 0;
    box.appendChild(el('label', { class: 'check' },
      el('input', {
        type: 'checkbox', checked: useBank, onchange: e => {
          if (e.target.checked) { g.labelStyle = 'upper'; g.options = [0, 1, 2, 3, 4, 5].map(i => ({ label: makeLabel('upper', i), text: '' })); }
          else g.options = [];
          E.touch(true);
        }
      }),
      ' Use a word bank (students pick from a list; write the option letter in the gap, e.g. [[C]])'));
    if (useBank) box.appendChild(this.optionsEditor(E, g, 'Word bank'));
    return box;
  }
};
