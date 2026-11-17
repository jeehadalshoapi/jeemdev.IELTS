/* ===== Results page ===== */

const Results = {
  async mount(root, id) {
    document.body.classList.add('theme-app');
    const a = await DB.get('attempts', id);
    if (!a) throw new Error('This result no longer exists.');
    const exam = normalizeExam(a.examSnapshot);
    const examStillExists = !!(await DB.get('exams', a.examId));

    root.appendChild(el('header', { class: 'app-header' },
      el('div', { class: 'brand' },
        el('a', { class: 'icon-btn back', href: '#/', title: 'Back to dashboard' }, '←'),
        el('div', null, el('b', null, 'Results'), el('small', null, a.examTitle))),
      el('div', { class: 'header-actions' },
        a.runId ? el('a', { class: 'btn', href: '#/full/' + a.runId }, '🏁 Full test results') : null,
        exam.module !== 'writing' ? el('a', { class: 'btn', href: '#/review/' + a.id }, '🔍 Review answers in the test') : el('a', { class: 'btn', href: '#/review/' + a.id }, '🔍 Open in test view'),
        examStillExists ? el('a', { class: 'btn btn-primary', href: '#/test/' + a.examId }, '↻ Take again') : null)
    ));
    const page = el('div', { class: 'page results' });
    root.appendChild(page);

    if (exam.module === 'writing') this.writing(page, a, exam);
    else this.objective(page, a, exam);

    if (a.notes && a.notes.length) {
      page.appendChild(el('section', { class: 'card' },
        el('h2', { class: 'card-title' }, `Your notes (${a.notes.length})`),
        el('div', { class: 'notes-list' }, a.notes.map(n => el('div', { class: 'note-item static' }, el('q', null, n.quote), el('p', null, n.note))))));
    }
    return {};
  },

  hero(a, big, bigLabel, rows) {
    return el('section', { class: 'card hero' },
      el('div', { class: 'hero-band' }, el('div', { class: 'band-num' }, big), el('div', { class: 'band-label' }, bigLabel)),
      el('div', { class: 'hero-info' },
        el('h2', null, a.examTitle),
        el('div', { class: 'hero-rows' }, rows.map(([k, v]) => el('div', null, el('small', null, k), el('b', null, v))))));
  },

  objective(page, a, exam) {
    const score = scoreAttempt(exam, a.answers || {});
    const band = bandFor(exam, score.correct, score.total);
    const overtime = a.timeUsed > a.timeLimit;
    page.appendChild(this.hero(a, band ? fmtBand(band.band) : '–', band && band.estimated ? `Estimated band (≈ ${band.scaled}/40)` : 'Band score', [
      ['Score', `${score.correct} / ${score.total}`],
      ['Accuracy', score.total ? Math.round(score.correct / score.total * 100) + '%' : '–'],
      ['Time used', fmtDuration(a.timeUsed) + (overtime ? ' (over time)' : ` of ${a.timeLimit / 60} min`)],
      ['Mode', a.mode === 'practice' ? 'Practice' : 'Exam'],
      ['Date', fmtDate(a.finishedAt)]
    ]));
    if (band && band.estimated) {
      page.appendChild(el('p', { class: 'muted small-note' }, `This test has ${score.total} questions, so your score was scaled to 40 to estimate a band. Band tables are approximate.`));
    }

    // breakdowns
    const byType = {};
    const { slots } = numberExam(exam);
    score.items.forEach((it, i) => {
      const t = slots[i].type;
      byType[t] = byType[t] || { c: 0, t: 0 };
      byType[t].t++; if (it.ok) byType[t].c++;
    });
    const bar = (label, c, t) => el('div', { class: 'bd-row' },
      el('span', { class: 'bd-label' }, label),
      el('div', { class: 'bd-track' }, el('div', { class: 'bd-fill', style: { width: (t ? c / t * 100 : 0) + '%' } })),
      el('b', { class: 'bd-val' }, `${c}/${t}`));
    page.appendChild(el('div', { class: 'grid-2' },
      el('section', { class: 'card' }, el('h3', { class: 'card-title' }, 'By part'),
        exam.parts.map((p, i) => bar(p.title, score.perPart[i].correct, score.perPart[i].total))),
      el('section', { class: 'card' }, el('h3', { class: 'card-title' }, 'By question type'),
        Object.entries(byType).map(([t, v]) => bar(QTYPE_SHORT[t], v.c, v.t)))
    ));

    // answer table per part
    exam.parts.forEach((p, pi) => {
      const items = score.items.filter(i => i.partIndex === pi);
      if (!items.length) return;
      page.appendChild(el('section', { class: 'card' },
        el('h3', { class: 'card-title' }, `${p.title} — ${score.perPart[pi].correct}/${score.perPart[pi].total}`),
        el('div', { class: 'table-wrap' }, el('table', { class: 'table answers' },
          el('thead', null, el('tr', null, el('th', null, 'Q'), el('th', null, 'Your answer'), el('th', null, 'Correct answer'), el('th', null, ''))),
          el('tbody', null, items.map(it => el('tr', { class: it.ok ? 'ok' : 'bad' },
            el('td', null, el('b', null, it.num), a.flags && a.flags[it.num] ? el('span', { class: 'flag-dot', title: 'You marked this for review' }, ' ⚑') : null),
            el('td', null, it.user ? String(it.user) : el('span', { class: 'muted' }, '— not answered —')),
            el('td', null, it.correct),
            el('td', { class: 'mark' }, it.ok ? '✓' : '✗'))))))
      ));
      if (exam.module === 'listening' && p.transcript) {
        page.appendChild(el('details', { class: 'card details' }, el('summary', null, `${p.title} transcript`), el('div', { html: mdBlock(p.transcript) })));
      }
    });
  },

  writing(page, a, exam) {
    const crit = ['Task achievement / response', 'Coherence & cohesion', 'Lexical resource', 'Grammatical range & accuracy'];
    a.selfBands = a.selfBands || exam.parts.map(() => [null, null, null, null]);
    const overallEl = el('div', { class: 'band-num' });
    const roundHalf = x => Math.round(x * 2) / 2;
    const taskBand = ti => {
      const v = (a.selfBands[ti] || []).filter(x => x != null);
      return v.length === 4 ? roundHalf(v.reduce((s, x) => s + x, 0) / 4) : null;
    };
    const updateOverall = async () => {
      const tb = exam.parts.map((_, i) => taskBand(i));
      let overall = null;
      if (tb.every(b => b != null)) {
        overall = tb.length >= 2 ? roundHalf((tb[0] + 2 * tb[1] + tb.slice(2).reduce((s, x) => s + x, 0)) / (tb.length + 1)) : tb[0];
      }
      overallEl.textContent = overall == null ? '–' : fmtBand(overall);
      $$('[data-taskband]', page).forEach(n => { const b = tb[Number(n.dataset.taskband)]; n.textContent = b == null ? '' : 'Task band: ' + fmtBand(b); });
      a.band = overall;
      await DB.put('attempts', a);
    };

    page.appendChild(el('section', { class: 'card hero' },
      el('div', { class: 'hero-band' }, overallEl, el('div', { class: 'band-label' }, 'Self-assessed band')),
      el('div', { class: 'hero-info' },
        el('h2', null, a.examTitle),
        el('div', { class: 'hero-rows' },
          exam.parts.map((p, i) => el('div', null, el('small', null, p.title), el('b', null, `${(a.wordCounts || [])[i] ?? wordCount(a.answers[p.id])} words`))),
          el('div', null, el('small', null, 'Time used'), el('b', null, fmtDuration(a.timeUsed))),
          el('div', null, el('small', null, 'Date'), el('b', null, fmtDate(a.finishedAt)))),
        el('p', { class: 'muted' }, 'Writing is not marked automatically. Compare with the model answer (if any) and score yourself on the four criteria below — Task 2 counts double.'))));

    exam.parts.forEach((p, ti) => {
      const text = a.answers[p.id] || '';
      const wc = wordCount(text);
      page.appendChild(el('section', { class: 'card' },
        el('div', { class: 'card-head' },
          el('h3', { class: 'card-title' }, p.title),
          el('span', { class: wc < (p.minWords || 0) ? 'pill-bad' : 'pill-ok' }, `${wc} words ${wc < (p.minWords || 0) ? `(below ${p.minWords})` : '✓'}`),
          el('button', { class: 'btn btn-sm', onclick: () => navigator.clipboard.writeText(text).then(() => toast('Copied', 'ok'), () => toast('Could not copy', 'err')) }, '⧉ Copy text')),
        el('details', { class: 'details' }, el('summary', null, 'Task question'), el('div', { html: mdBlock(p.prompt) })),
        el('div', { class: 'essay' }, text || el('span', { class: 'muted' }, 'No answer written.')),
        p.modelAnswer ? el('details', { class: 'details' }, el('summary', null, 'Model answer'), el('div', { class: 'essay', html: mdBlock(p.modelAnswer) })) : null,
        el('div', { class: 'self-score' },
          crit.map((c, ci) => el('label', null, el('span', null, c),
            el('select', {
              class: 'input', onchange: e => { a.selfBands[ti][ci] = e.target.value === '' ? null : Number(e.target.value); updateOverall(); }
            }, el('option', { value: '' }, '–'),
              [9, 8.5, 8, 7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 3, 2, 1].map(b => el('option', { value: b, selected: a.selfBands[ti][ci] === b }, fmtBand(b)))))),
          el('b', { class: 'task-band', dataset: { taskband: ti } }))
      ));
    });
    updateOverall();
  }
};
