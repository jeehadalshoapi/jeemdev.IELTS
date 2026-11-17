/*
 * Highlighting and notes (converted from the old js/exam-tools.js).
 * Highlights are saved as text offsets inside each pane — never as HTML — so they sync safely between devices.
 */
import { $$, el, uid } from '../lib/dom';
import { confirmDialog, promptDialog } from '../lib/ui';

export interface SavedHighlight { s: number; e: number; n?: string }

const SKIP = '.no-hl, button, select, option, textarea, input';

/** text nodes that count for offsets (answer boxes and labels that change are excluded) */
function textNodes(container: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: n => ((n as Text).parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  while (walker.nextNode()) out.push(walker.currentNode as Text);
  return out;
}

export class Tools {
  private menu: HTMLElement;
  private readonly onDown = (e: MouseEvent) => { if (!this.menu.contains(e.target as Node)) this.hideMenu(); };

  constructor(private readonly root: HTMLElement, private readonly onChange: (zone: HTMLElement) => void) {
    this.menu = el('div', { class: 'hl-menu no-hl hidden', role: 'menu' });
    document.body.appendChild(this.menu);
    document.addEventListener('mousedown', this.onDown);
    root.addEventListener('scroll', () => this.hideMenu(), true);
    root.addEventListener('mouseup', e => this.onMouseUp(e));
    root.addEventListener('touchend', () => setTimeout(() => this.offerForSelection(), 350));
    root.addEventListener('contextmenu', e => this.onContext(e));
    root.addEventListener('click', e => {
      const mark = (e.target as Element).closest<HTMLElement>('mark.hl');
      if (mark && window.getSelection()?.isCollapsed) this.markMenu(mark, e.clientX, e.clientY);
    });
  }

  destroy(): void {
    document.removeEventListener('mousedown', this.onDown);
    this.menu.remove();
  }

  private zoneOf(node: Node | null): HTMLElement | null {
    const e = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
    return e ? e.closest<HTMLElement>('.hl-zone') : null;
  }

  private currentRange(): Range | null {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed || !sel.toString().trim()) return null;
    const range = sel.getRangeAt(0);
    const zone = this.zoneOf(range.commonAncestorContainer);
    return zone && this.root.contains(zone) ? range : null;
  }

  private onMouseUp(e: MouseEvent): void {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('input, textarea, select, .hl-menu, .drop-zone, .chip-opt')) return;
    setTimeout(() => this.offerForSelection(), 0);
  }

  private offerForSelection(): void {
    const range = this.currentRange();
    if (!range) return;
    const r = range.getBoundingClientRect();
    this.showMenu(r.left + r.width / 2, r.top, [
      ['🖍 Highlight', () => this.apply(range)],
      ['📝 Add note', () => this.apply(range, true)]
    ], true);
  }

  private onContext(e: MouseEvent): void {
    const target = e.target as Element;
    if (target.closest('input, textarea, select')) return;
    const zone = target.closest<HTMLElement>('.hl-zone');
    if (!zone) return;
    e.preventDefault();
    const range = this.currentRange();
    const mark = target.closest<HTMLElement>('mark.hl');
    const items: Array<[string | null, (() => void) | string]> = [];
    if (range) items.push(['🖍 Highlight', () => this.apply(range)], ['📝 Notes', () => this.apply(range, true)]);
    if (mark) items.push(['✕ Clear', () => this.clear(mark.dataset.hid!)], [mark.dataset.note ? '📝 Edit note' : '📝 Add note', () => this.editNote(mark.dataset.hid!)]);
    items.push(['Clear all highlights', () => this.clearAll(zone.closest<HTMLElement>('.cd-part') ?? zone)]);
    this.showMenu(e.clientX, e.clientY, items, false);
  }

  private markMenu(mark: HTMLElement, x: number, y: number): void {
    const note = mark.dataset.note;
    this.showMenu(x, y, [
      ...(note ? [[null, note] as [null, string]] : []),
      ['✕ Clear highlight', () => this.clear(mark.dataset.hid!)],
      [note ? '📝 Edit note' : '📝 Add note', () => this.editNote(mark.dataset.hid!)]
    ], false);
  }

  private showMenu(x: number, y: number, items: Array<[string | null, (() => void) | string]>, above: boolean): void {
    const m = this.menu;
    m.innerHTML = '';
    for (const [label, fn] of items) {
      if (label === null) { m.appendChild(el('div', { class: 'hl-note-text' }, fn as string)); continue; }
      m.appendChild(el('button', {
        onmousedown: (e: Event) => e.preventDefault(), // keep the text selection alive
        onclick: () => { this.hideMenu(); (fn as () => void)(); }
      }, label));
    }
    m.classList.remove('hidden');
    m.classList.toggle('above', above);
    const w = m.offsetWidth, h = m.offsetHeight;
    let left = above ? x - w / 2 : x;
    let top = above ? y - h - 8 : y;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    if (top < 8) top = above ? y + 24 : 8;
    top = Math.min(top, window.innerHeight - h - 8);
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
  }

  hideMenu(): void { this.menu.classList.add('hidden'); }

  private apply(range: Range, withNote = false): void {
    const zone = this.zoneOf(range.commonAncestorContainer);
    const hid = this.wrap(range);
    window.getSelection()?.removeAllRanges();
    if (!hid || !zone) return;
    if (withNote) void this.editNote(hid);
    else this.onChange(zone);
  }

  /** wrap every text node inside the range in <mark class="hl"> */
  wrap(range: Range, hid = uid('h')): string | null {
    const zone = this.zoneOf(range.commonAncestorContainer);
    if (!zone) return null;
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(zone, NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        if (!range.intersectsNode(n) || !n.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        return (n as Text).parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const { startContainer, startOffset, endContainer, endOffset } = range;
    let wrapped = 0;
    for (const node of nodes) {
      const start = node === startContainer ? startOffset : 0;
      const end = node === endContainer ? endOffset : node.nodeValue!.length;
      if (start >= end) continue;
      let target: Text = node;
      if (end < target.nodeValue!.length) target.splitText(end);
      if (start > 0) target = target.splitText(start);
      const mark = el('mark', { class: 'hl', dataset: { hid } });
      target.parentNode!.insertBefore(mark, target);
      mark.appendChild(target);
      wrapped++;
    }
    return wrapped ? hid : null;
  }

  private marks(hid: string): HTMLElement[] { return $$<HTMLElement>(`mark.hl[data-hid="${hid}"]`, this.root); }

  private unwrap(m: HTMLElement): void {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  }

  private clear(hid: string): void {
    const marks = this.marks(hid);
    const zone = this.zoneOf(marks[0] ?? null);
    marks.forEach(m => this.unwrap(m));
    if (zone) this.onChange(zone);
  }

  private async clearAll(scope: HTMLElement): Promise<void> {
    const marks = $$<HTMLElement>('mark.hl', scope);
    if (!marks.length) return;
    if (marks.some(m => m.dataset.note) && !(await confirmDialog('Clear all highlights and notes in this part?', { ok: 'Clear all' }))) return;
    const zones = new Set(marks.map(m => this.zoneOf(m)).filter((z): z is HTMLElement => !!z));
    marks.forEach(m => this.unwrap(m));
    zones.forEach(z => this.onChange(z));
  }

  private async editNote(hid: string): Promise<void> {
    const marks = this.marks(hid);
    if (!marks.length) return;
    const quote = marks.map(m => m.textContent).join(' ');
    const text = await promptDialog({ title: 'Note', multiline: true, ok: 'Save note', value: marks[0]!.dataset.note ?? '', label: `“${quote.length > 120 ? quote.slice(0, 120) + '…' : quote}”` });
    if (text !== null) setNote(marks, text.trim());
    const zone = this.zoneOf(marks[0]!);
    if (zone) this.onChange(zone);
  }

  /** notes for the notes panel */
  notes(): Array<{ note: string; quote: string; el: HTMLElement }> {
    const byId = new Map<string, { note: string; quote: string; el: HTMLElement }>();
    for (const m of $$<HTMLElement>('mark.hl[data-note]', this.root)) {
      const id = m.dataset.hid!;
      const entry = byId.get(id) ?? { note: m.dataset.note!, quote: '', el: m };
      entry.quote += m.textContent;
      byId.set(id, entry);
    }
    return [...byId.values()];
  }

  /* ---------- saving / restoring as offsets ---------- */
  serialize(zone: HTMLElement): SavedHighlight[] {
    const out: Array<SavedHighlight & { hid: string }> = [];
    let offset = 0;
    for (const node of textNodes(zone)) {
      const len = node.nodeValue?.length ?? 0;
      const mark = node.parentElement?.closest<HTMLElement>('mark.hl');
      if (mark && zone.contains(mark)) {
        const hid = mark.dataset.hid!;
        const last = out[out.length - 1];
        if (last && last.hid === hid) last.e = offset + len;
        else out.push({ hid, s: offset, e: offset + len, ...(mark.dataset.note ? { n: mark.dataset.note } : {}) });
      }
      offset += len;
    }
    // a highlight interrupted by another one comes back as two entries with the same id: merge them
    const merged = new Map<string, SavedHighlight>();
    for (const h of out) {
      const m = merged.get(h.hid);
      if (m) { m.s = Math.min(m.s, h.s); m.e = Math.max(m.e, h.e); }
      else merged.set(h.hid, { s: h.s, e: h.e, ...(h.n ? { n: h.n } : {}) });
    }
    return [...merged.values()];
  }

  restore(zone: HTMLElement, list: SavedHighlight[] | undefined): void {
    if (!Array.isArray(list)) return;
    for (const h of list) {
      const nodes = textNodes(zone);
      const at = (pos: number): [Text, number] | null => {
        let offset = 0;
        for (const n of nodes) {
          const len = n.nodeValue?.length ?? 0;
          if (pos <= offset + len) return [n, pos - offset];
          offset += len;
        }
        return null;
      };
      const a = at(h.s), b = at(h.e);
      if (!a || !b || h.e <= h.s) continue;
      const range = document.createRange();
      range.setStart(a[0], a[1]);
      range.setEnd(b[0], b[1]);
      const hid = this.wrap(range);
      if (hid && h.n) setNote(this.marks(hid), h.n);
    }
  }
}

function setNote(marks: HTMLElement[], text: string): void {
  marks.forEach((m, i) => {
    if (text) { m.dataset.note = text; m.title = text; m.classList.add('has-note'); }
    else { delete m.dataset.note; m.removeAttribute('title'); m.classList.remove('has-note'); }
    m.classList.toggle('note-end', !!text && i === marks.length - 1);
  });
}
