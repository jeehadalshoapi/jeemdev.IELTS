/* Toasts and dialogs (converted from the old js/util.js) */
import { $, el, type Child } from './dom';

export function toast(msg: string, type: 'info' | 'ok' | 'err' = 'info', ms = 2600): void {
  const box = $('#toasts') ?? document.body.appendChild(el('div', { id: 'toasts' }));
  const t = el('div', { class: `toast toast-${type}`, role: 'status' }, msg);
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export interface ModalAction { label: string; kind?: 'primary' | 'danger' | 'ghost'; onClick?: () => unknown }

export function modal(o: { title?: string; body: Node | string; actions?: ModalAction[]; wide?: boolean; dismissable?: boolean; onClose?: () => void }): { close: () => void; root: HTMLElement } {
  const dismissable = o.dismissable ?? true;
  const overlay = el('div', { class: 'modal-overlay' });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    o.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && dismissable) close(); };
  const box = el('div', { class: 'modal' + (o.wide ? ' modal-wide' : ''), role: 'dialog', 'aria-modal': 'true' },
    o.title ? el('div', { class: 'modal-head' },
      el('h3', null, o.title),
      dismissable ? el('button', { class: 'icon-btn modal-x', title: 'Close', onclick: close }, '✕') : null) : null,
    el('div', { class: 'modal-body' }, typeof o.body === 'string' ? el('div', { html: o.body }) : o.body),
    o.actions?.length ? el('div', { class: 'modal-actions' }, o.actions.map(a =>
      el('button', {
        class: 'btn' + (a.kind ? ` btn-${a.kind}` : ''),
        onclick: async () => { const r = a.onClick ? await a.onClick() : undefined; if (r !== false) close(); }
      }, a.label))) : null);
  overlay.appendChild(box);
  if (dismissable) overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  const first = box.querySelector<HTMLElement>('textarea, input, .btn-primary');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, root: box };
}

export function confirmDialog(message: Child, o: { title?: string; ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise(resolve => {
    let answer = false;
    modal({
      title: o.title ?? 'Please confirm',
      body: el('div', null, message),
      actions: [
        { label: o.cancel ?? 'Cancel', kind: 'ghost' },
        { label: o.ok ?? 'OK', kind: o.danger ? 'danger' : 'primary', onClick: () => { answer = true; } }
      ],
      onClose: () => resolve(answer)
    });
  });
}

export function promptDialog(o: { title: string; label?: string; value?: string; multiline?: boolean; ok?: string; placeholder?: string }): Promise<string | null> {
  return new Promise(resolve => {
    let answer: string | null = null;
    const input = o.multiline
      ? el('textarea', { class: 'input', rows: 6, placeholder: o.placeholder ?? '' })
      : el('input', { class: 'input', type: 'text', placeholder: o.placeholder ?? '' });
    input.value = o.value ?? '';
    const m = modal({
      title: o.title,
      body: el('div', null, o.label ? el('label', { class: 'field-label' }, o.label) : null, input),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: o.ok ?? 'Save', kind: 'primary', onClick: () => { answer = input.value; } }
      ],
      onClose: () => resolve(answer)
    });
    if (!o.multiline) input.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') { answer = input.value; m.close(); } });
  });
}
