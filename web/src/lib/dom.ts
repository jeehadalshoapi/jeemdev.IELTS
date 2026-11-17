/* Small DOM helpers (converted from the old js/util.js) */

export type Child = Node | string | number | null | undefined | false | Child[];
export type Attrs = Record<string, unknown> | null | undefined;

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(sel));

/** el('div', { class: 'x', onclick: fn, dataset: { a: '1' } }, child1, [child2], 'text') */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'html') node.innerHTML = String(v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'value') (node as unknown as HTMLInputElement).value = String(v);
      else if (['checked', 'disabled', 'selected', 'multiple', 'readOnly', 'hidden', 'open'].includes(k)) (node as unknown as Record<string, boolean>)[k] = !!v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(node, children);
  return node;
}

export function append(node: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else if (c instanceof Node) node.appendChild(c);
    else node.appendChild(document.createTextNode(String(c)));
  }
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/** localStorage that never throws (private mode, blocked storage) — only for device preferences and the offline buffer */
export const local = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
  remove(key: string): void { try { localStorage.removeItem(key); } catch { /* ignore */ } }
};

/** a random id for this browser (shown in the attempt's device log) */
export function deviceId(): string {
  let id = local.get('ielts-device');
  if (!id) { id = uid('dev'); local.set('ielts-device', id); }
  return id;
}
