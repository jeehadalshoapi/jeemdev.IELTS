/* ===== Exam view: renders passages, question groups and writing tasks =====
   S (the exam state) must provide: exam, num (numberExam result), answers, review,
   setAnswer(qid, value), registerNum(num, element)                                      */

const Render = {
  part(S, part, pi) {
    const ex = S.exam;
    const sec = el('section', { class: 'cd-part', dataset: { part: pi }, hidden: true });
    if (ex.module === 'writing') {
      sec.appendChild(el('div', { class: 'cd-split' },
        el('div', { class: 'pane pane-left hl-zone' }, this.writingPrompt(S, part)),
        el('div', { class: 'divider no-hl', title: 'Drag to resize · double-click to reset' }, el('span', null, '⋮')),
        el('div', { class: 'pane pane-right' }, this.writingAnswer(S, part, pi))
      ));
    } else if (ex.module === 'listening') {
      const pane = el('div', { class: 'pane pane-single hl-zone' });
      if (S.review && part.transcript) pane.appendChild(el('details', { class: 'transcript no-hl' }, el('summary', null, 'Show transcript'), el('div', { html: mdBlock(part.transcript) })));
      part.groups.forEach(g => pane.appendChild(this.group(S, g)));
      sec.appendChild(el('div', { class: 'cd-single' }, pane));
    } else {
      const left = el('div', { class: 'pane pane-left hl-zone passage', dataset: { part: pi } },
        part.passageTitle ? el('h2', { class: 'psg-title' }, part.passageTitle) : null,
        el('div', { class: 'psg-body', html: renderPassageHTML(part.passage) }));
      const right = el('div', { class: 'pane pane-right hl-zone' });
      part.groups.forEach(g => right.appendChild(this.group(S, g)));
      sec.appendChild(el('div', { class: 'cd-split' },
        left,
        el('div', { class: 'divider no-hl', title: 'Drag to resize · double-click to reset' }, el('span', null, '⋮')),
        right));
    }
    return sec;
  },

  partInstruction(S, pi) {
    const ex = S.exam, part = ex.parts[pi];
    if (ex.module === 'writing') {
      const mins = pi === 0 ? 20 : 40;
      return `You should spend about ${mins} minutes on this task. Write at least ${part.minWords || (pi === 0 ? 150 : 250)} words.`;
    }
    const r = S.num.partRange[pi];
    const qs = r && r[1] >= r[0] ? `questions ${r[0]}–${r[1]}` : 'the questions';
    return ex.module === 'listening' ? `Listen and answer ${qs}.` : `Read the text and answer ${qs}.`;
  },

  /* ---------- question groups ---------- */
  group(S, g) {
    const box = el('div', { class: 'q-group', dataset: { group: g.id } });
    box.appendChild(el('h3', { class: 'q-range' }, rangeText(S.num.groupRange[g.id])));
    if (g.instructions) box.appendChild(el('div', { class: 'q-instr', html: mdBlock(g.instructions) }));
    if (g.imageId) {
      const img = el('img', { class: 'q-img', alt: '' });
      DB.fileURL(g.imageId).then(u => { if (u) img.src = u; });
      box.appendChild(img);
    }
    if (g.title && g.type !== 'matching') box.appendChild(el('h4', { class: 'q-title' }, g.title));
    const fn = { tfng: 'choiceGroup', ynng: 'choiceGroup', mcq: 'mcq', mcq_multi: 'mcqMulti', matching: 'matching', completion: 'completion', short: 'short' }[g.type];
    box.appendChild(this[fn](S, g));
    return box;
  },

  qNum(n) { return el('span', { class: 'q-num no-hl' }, String(n)); },

  radios(S, qid, choices) {
    return el('div', { class: 'choices' }, choices.map(c => el('label', { class: 'choice', dataset: { value: c.value } },
      el('input', {
        type: 'radio', name: 'r_' + qid, value: c.value, checked: S.answers[qid] === c.value, disabled: S.review,
        onchange: () => S.setAnswer(qid, c.value)
      }),
      c.letter ? el('b', { class: 'choice-letter' }, c.letter) : null,
      el('span', { class: 'choice-text', html: inlineMd(c.text) })
    )));
  },

  choiceGroup(S, g) {
    const wrap = el('div', { class: 'q-list' });
    g.questions.forEach(q => {
      const n = S.num.itemStart[q.id];
      const item = el('div', { class: 'q-item', dataset: { num: n, qid: q.id } },
        el('div', { class: 'q-text' }, this.qNum(n), el('span', { html: inlineMd(q.text) })),
        this.radios(S, q.id, QTYPES[g.type].choices.map(c => ({ value: c, text: c }))));
      S.registerNum(n, item);
      wrap.appendChild(item);
    });
    return wrap;
  },

  mcq(S, g) {
    const wrap = el('div', { class: 'q-list' });
    g.questions.forEach(q => {
      const n = S.num.itemStart[q.id];
      const item = el('div', { class: 'q-item', dataset: { num: n, qid: q.id } },
        el('div', { class: 'q-text' }, this.qNum(n), el('span', { html: inlineMd(q.text) })),
        this.radios(S, q.id, q.options.map((o, i) => ({ value: makeLabel('upper', i), letter: makeLabel('upper', i), text: o }))));
      S.registerNum(n, item);
      wrap.appendChild(item);
    });
    return wrap;
  },

  mcqMulti(S, g) {
    const wrap = el('div', { class: 'q-list' });
    g.questions.forEach(q => {
      const n = S.num.itemStart[q.id];
      const count = Math.max(1, (q.answer || []).length || q.choose || 2);
      const sel = () => Array.isArray(S.answers[q.id]) ? S.answers[q.id] : [];
      const item = el('div', { class: 'q-item', dataset: { num: n, qid: q.id } },
        el('div', { class: 'q-text' }, el('span', { class: 'q-num no-hl' }, count > 1 ? `${n}–${n + count - 1}` : String(n)), el('span', { html: inlineMd(q.text) })),
        el('div', { class: 'choices' }, q.options.map((o, i) => {
          const L = makeLabel('upper', i);
          return el('label', { class: 'choice', dataset: { value: L } },
            el('input', {
              type: 'checkbox', value: L, checked: sel().includes(L), disabled: S.review,
              onchange: e => {
                let cur = sel().slice();
                if (e.target.checked) {
                  if (cur.length >= count) { e.target.checked = false; S.flash(`You can choose only ${count} answers. Untick one first.`); return; }
                  cur.push(L);
                } else cur = cur.filter(x => x !== L);
                S.setAnswer(q.id, cur.sort());
              }
            }),
            el('b', { class: 'choice-letter' }, L),
            el('span', { class: 'choice-text', html: inlineMd(o) }));
        })));
      for (let k = 0; k < count; k++) S.registerNum(n + k, item);
      wrap.appendChild(item);
    });
    return wrap;
  },

  short(S, g) {
    const wrap = el('div', { class: 'q-list' });
    g.questions.forEach(q => {
      const n = S.num.itemStart[q.id];
      const item = el('div', { class: 'q-item q-short', dataset: { num: n, qid: q.id } },
        el('div', { class: 'q-text' }, this.qNum(n), el('span', { html: inlineMd(q.text) })),
        this.textInput(S, q.id, n));
      S.registerNum(n, item);
      wrap.appendChild(item);
    });
    return wrap;
  },

  textInput(S, qid, n) {
    return el('input', {
      class: 'gap-input no-hl', type: 'text', placeholder: String(n), value: S.answers[qid] || '', disabled: S.review,
      autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-label': 'Answer ' + n,
      dataset: { qid, num: n },
      oninput: e => S.setAnswer(qid, e.target.value)
    });
  },

  completion(S, g) {
    const items = groupItems(g);
    const bank = g.options.length > 0;
    const wrap = el('div', { class: 'cmp', html: renderCompletionHTML(g.content) });
    $$('.gap', wrap).forEach(span => {
      const it = items[Number(span.dataset.gap)];
      if (!it) return;
      const n = S.num.itemStart[it.id];
      const ctl = bank ? this.dropZone(S, g, it.id, n, true) : this.textInput(S, it.id, n);
      const holder = el('span', { class: 'gap-holder', dataset: { num: n, qid: it.id } }, ctl);
      span.replaceWith(holder);
      S.registerNum(n, holder);
    });
    if (!bank) return wrap;
    return el('div', null, wrap, this.optionBank(S, g, items.map(i => i.id)));
  },

  /* ---------- matching (drag & drop, or click a chip then a box) ---------- */
  matching(S, g) {
    const box = el('div', { class: 'match' });
    const qs = el('div', { class: 'match-qs' });
    g.questions.forEach(q => {
      const n = S.num.itemStart[q.id];
      const item = el('div', { class: 'q-item match-item', dataset: { num: n, qid: q.id } },
        el('div', { class: 'q-text' }, this.qNum(n), el('span', { html: inlineMd(q.text) })),
        this.dropZone(S, g, q.id, n, false));
      S.registerNum(n, item);
      qs.appendChild(item);
    });
    box.append(qs, this.optionBank(S, g, g.questions.map(q => q.id)));
    return box;
  },

  optionText(g, label) {
    const o = g.options.find(o => String(o.label).toLowerCase() === String(label).toLowerCase());
    return o ? o : null;
  },

  dropZone(S, g, qid, n, inline) {
    const zone = el('span', {
      class: 'drop-zone no-hl' + (inline ? ' inline' : ''), tabindex: S.review ? -1 : 0,
      dataset: { qid, group: g.id, num: n }, role: 'button', 'aria-label': 'Answer box ' + n
    });
    const draw = () => {
      const v = S.answers[qid];
      zone.innerHTML = '';
      zone.classList.toggle('filled', !!v);
      if (!v) { zone.appendChild(el('span', { class: 'dz-placeholder' }, String(n))); return; }
      const o = this.optionText(g, v);
      zone.draggable = !S.review;
      zone.appendChild(el('b', null, v));
      if (o && o.text) zone.appendChild(el('span', { class: 'dz-text' }, ' ' + o.text));
    };
    zone._draw = draw;
    draw();
    if (S.review) return zone;

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('over');
      let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      if (data.group !== g.id) return;
      if (data.from && data.from !== qid) {
        // swap when moving from one box to another
        const mine = S.answers[qid] || '';
        S.setAnswer(data.from, mine);
      }
      S.setAnswer(qid, data.label);
      this.refreshGroupZones(S, g);
    });
    zone.addEventListener('dragstart', e => {
      const v = S.answers[qid];
      if (!v) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', JSON.stringify({ group: g.id, label: v, from: qid }));
    });
    const activate = () => {
      if (S.picked && S.picked.group === g.id) {
        S.setAnswer(qid, S.picked.label);
        S.picked = null;
        $$('.chip-opt.picked').forEach(c => c.classList.remove('picked'));
      } else if (S.answers[qid]) {
        S.setAnswer(qid, '');
      }
      this.refreshGroupZones(S, g);
    };
    zone.addEventListener('click', activate);
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); activate(); } });
    return zone;
  },

  optionBank(S, g, qids) {
    const bank = el('div', { class: 'opt-bank no-hl', dataset: { bank: g.id } },
      g.title && g.type === 'matching' ? el('h4', { class: 'q-title' }, g.title) : null,
      el('div', { class: 'chips' }, g.options.map(o => {
        const chip = el('div', {
          class: 'chip-opt', draggable: S.review ? null : 'true', dataset: { label: o.label, group: g.id }, tabindex: S.review ? -1 : 0, role: 'button',
          title: S.review ? '' : 'Drag into a box, or click here and then click a box'
        }, el('b', null, o.label), o.text ? el('span', null, o.text) : null);
        if (!S.review) {
          chip.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ group: g.id, label: o.label }));
            chip.classList.add('dragging');
          });
          chip.addEventListener('dragend', () => chip.classList.remove('dragging'));
          const pick = () => {
            if (chip.classList.contains('used')) return;
            const was = chip.classList.contains('picked');
            $$('.chip-opt.picked').forEach(c => c.classList.remove('picked'));
            S.picked = was ? null : { group: g.id, label: o.label };
            if (!was) chip.classList.add('picked');
          };
          chip.addEventListener('click', pick);
          chip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        }
        return chip;
      }))
    );
    bank._qids = qids;
    if (!S.review) {
      // dropping a used option back onto the list clears that box
      bank.addEventListener('dragover', e => e.preventDefault());
      bank.addEventListener('drop', e => {
        e.preventDefault();
        let data; try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
        if (data.group === g.id && data.from) { S.setAnswer(data.from, ''); this.refreshGroupZones(S, g); }
      });
    }
    S.afterRender.push(() => this.refreshGroupZones(S, g));
    return bank;
  },

  refreshGroupZones(S, g) {
    const root = S.root;
    $$(`.drop-zone[data-group="${g.id}"]`, root).forEach(z => z._draw && z._draw());
    const bank = $(`[data-bank="${g.id}"]`, root);
    if (!bank) return;
    const used = new Set(bank._qids.map(id => String(S.answers[id] || '').toLowerCase()).filter(Boolean));
    $$('.chip-opt', bank).forEach(c => c.classList.toggle('used', !g.reuse && used.has(String(c.dataset.label).toLowerCase())));
  },

  /* ---------- writing ---------- */
  writingPrompt(S, part) {
    const box = el('div', { class: 'w-prompt' }, el('h2', { class: 'psg-title' }, part.title), el('div', { html: mdBlock(part.prompt) }));
    if (part.imageId) {
      const img = el('img', { class: 'w-img', alt: '' });
      DB.fileURL(part.imageId).then(u => { if (u) img.src = u; });
      box.appendChild(img);
    }
    if (S.review && part.modelAnswer) box.appendChild(el('details', { class: 'transcript no-hl', open: true }, el('summary', null, 'Model answer'), el('div', { html: mdBlock(part.modelAnswer) })));
    return box;
  },

  writingAnswer(S, part, pi) {
    const key = part.id;
    const count = el('span', { class: 'wc-num' }, String(wordCount(S.answers[key])));
    const ta = el('textarea', {
      class: 'w-text', spellcheck: 'false', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', disabled: S.review,
      placeholder: 'Type your answer here', value: S.answers[key] || '', dataset: { num: 'w' + pi },
      oninput: e => { S.setAnswer(key, e.target.value); count.textContent = wordCount(e.target.value); }
    });
    return el('div', { class: 'w-answer' }, ta, el('div', { class: 'wc no-hl' }, 'Words: ', count, el('span', { class: 'muted' }, ` (minimum ${part.minWords || 0})`)));
  }
};
