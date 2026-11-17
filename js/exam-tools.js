/* ===== Exam tools: highlighting and notes (select text → Highlight / Note, right-click menu) ===== */

const Tools = {
  S: null,
  menu: null,

  init(S) {
    this.S = S;
    this.menu = el('div', { class: 'hl-menu no-hl hidden', role: 'menu' });
    document.body.appendChild(this.menu);
    const root = S.root;
    this._down = e => { if (!this.menu.contains(e.target)) this.hideMenu(); };
    this._scroll = () => this.hideMenu();
    document.addEventListener('mousedown', this._down);
    root.addEventListener('scroll', this._scroll, true);
    root.addEventListener('mouseup', e => this.onMouseUp(e));
    root.addEventListener('contextmenu', e => this.onContext(e));
    root.addEventListener('click', e => {
      const mark = e.target.closest('mark.hl');
      if (mark && window.getSelection().isCollapsed) this.markMenu(mark, e.clientX, e.clientY);
    });
  },

  destroy() {
    document.removeEventListener('mousedown', this._down);
    if (this.menu) this.menu.remove();
  },

  zoneOf(node) {
    const e = node && (node.nodeType === 1 ? node : node.parentElement);
    return e ? e.closest('.hl-zone') : null;
  },

  currentRange() {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !sel.toString().trim()) return null;
    const range = sel.getRangeAt(0);
    const zone = this.zoneOf(range.commonAncestorContainer);
    if (!zone || !this.S.root.contains(zone)) return null;
    return range;
  },

  onMouseUp(e) {
    if (e.button !== 0 || this.S.review === 'locked') return;
    if (e.target.closest('input, textarea, select, .hl-menu, .drop-zone, .chip-opt')) return;
    setTimeout(() => {
      const range = this.currentRange();
      if (!range) return;
      const r = range.getBoundingClientRect();
      this.showMenu(r.left + r.width / 2, r.top, [
        ['🖍 Highlight', () => this.apply(range)],
        ['📝 Add note', () => this.apply(range, true)]
      ], true);
    }, 0);
  },

  onContext(e) {
    if (e.target.closest('input, textarea, select')) return;
    const zone = e.target.closest('.hl-zone');
    if (!zone) return;
    e.preventDefault();
    const range = this.currentRange();
    const mark = e.target.closest('mark.hl');
    const items = [];
    if (range) items.push(['🖍 Highlight', () => this.apply(range)], ['📝 Notes', () => this.apply(range, true)]);
    if (mark) items.push(['✕ Clear', () => this.clear(mark.dataset.hid)], [mark.dataset.note ? '📝 Edit note' : '📝 Add note', () => this.editNote(mark.dataset.hid)]);
    items.push(['Clear all highlights', () => this.clearAll(zone.closest('.cd-part') || zone)]);
    this.showMenu(e.clientX, e.clientY, items, false);
  },

  markMenu(mark, x, y) {
    const note = mark.dataset.note;
    this.showMenu(x, y, [
      ...(note ? [[null, note]] : []),
      ['✕ Clear highlight', () => this.clear(mark.dataset.hid)],
      [note ? '📝 Edit note' : '📝 Add note', () => this.editNote(mark.dataset.hid)]
    ], false);
  },

  showMenu(x, y, items, above) {
    const m = this.menu;
    m.innerHTML = '';
    items.forEach(([label, fn]) => {
      if (label === null) { m.appendChild(el('div', { class: 'hl-note-text' }, fn)); return; }
      m.appendChild(el('button', {
        onmousedown: e => e.preventDefault(),   // keep the text selection alive
        onclick: () => { this.hideMenu(); fn(); }
      }, label));
    });
    m.classList.remove('hidden');
    m.classList.toggle('above', !!above);
    const w = m.offsetWidth, h = m.offsetHeight;
    let left = above ? x - w / 2 : x;
    let top = above ? y - h - 8 : y;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (top < 8) top = above ? y + 24 : 8;
    top = Math.min(top, window.innerHeight - h - 8);
    m.style.left = left + 'px';
    m.style.top = top + 'px';
  },

  hideMenu() { if (this.menu) this.menu.classList.add('hidden'); },

  apply(range, withNote) {
    const hid = this.wrap(range);
    window.getSelection().removeAllRanges();
    if (!hid) return;
    if (withNote) this.editNote(hid);
    this.S.onToolsChange();
  },

  /** wrap every text node inside the range in <mark class="hl"> */
  wrap(range) {
    const zone = this.zoneOf(range.commonAncestorContainer);
    if (!zone) return null;
    const hid = uid('h');
    const nodes = [];
    const walker = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        if (!range.intersectsNode(n) || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (n.parentElement.closest('.no-hl, button, select, option, textarea, input')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let wrapped = 0;
    const startC = range.startContainer, startO = range.startOffset, endC = range.endContainer, endO = range.endOffset;
    nodes.forEach(node => {
      const start = node === startC ? startO : 0;
      const end = node === endC ? endO : node.nodeValue.length;
      if (start >= end) return;
      let target = node;
      if (end < target.nodeValue.length) target.splitText(end);
      if (start > 0) target = target.splitText(start);
      const mark = el('mark', { class: 'hl', dataset: { hid } });
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
      wrapped++;
    });
    return wrapped ? hid : null;
  },

  marks(hid) { return $$(`mark.hl[data-hid="${hid}"]`, this.S.root); },

  unwrap(m) {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  },

  clear(hid) {
    this.marks(hid).forEach(m => this.unwrap(m));
    this.S.onToolsChange();
  },

  async clearAll(scope) {
    const marks = $$('mark.hl', scope);
    if (!marks.length) return;
    if (marks.some(m => m.dataset.note) && !await confirmDialog('Clear all highlights and notes in this part?', { ok: 'Clear all' })) return;
    marks.forEach(m => this.unwrap(m));
    this.S.onToolsChange();
  },

  async editNote(hid) {
    const marks = this.marks(hid);
    if (!marks.length) return;
    const quote = marks.map(m => m.textContent).join(' ');
    const text = await promptDialog({
      title: 'Note', multiline: true, ok: 'Save note', value: marks[0].dataset.note || '',
      label: '“' + (quote.length > 120 ? quote.slice(0, 120) + '…' : quote) + '”'
    });
    if (text === null) return;
    marks.forEach((m, i) => {
      if (text.trim()) { m.dataset.note = text.trim(); m.title = text.trim(); m.classList.add('has-note'); }
      else { delete m.dataset.note; m.removeAttribute('title'); m.classList.remove('has-note'); }
      m.classList.toggle('note-end', !!text.trim() && i === marks.length - 1);
    });
    this.S.onToolsChange();
  },

  /** [{hid, note, quote, el}] for the notes panel */
  notes() {
    const byId = {};
    $$('mark.hl[data-note]', this.S.root).forEach(m => {
      const id = m.dataset.hid;
      if (!byId[id]) byId[id] = { hid: id, note: m.dataset.note, quote: '', el: m };
      byId[id].quote += m.textContent;
    });
    return Object.values(byId);
  }
};
