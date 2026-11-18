/* #/tests — every test, with Archive / Restore (tests are never deleted) and the way to the import box. */
import type { ConnectorResponse, ManagedTest, TestsResponse, TestStatus } from '@ielts/shared';
import { api } from '../lib/api';
import { el } from '../lib/dom';
import { fmtDate } from '../lib/format';
import { confirmDialog, toast } from '../lib/ui';
import { appHeader, kindBadge, skillBadge } from './common';

export async function mountTests(root: HTMLElement): Promise<void> {
  const [{ tests }, connector] = await Promise.all([api<TestsResponse>('/tests'), api<ConnectorResponse>('/connector')]);
  let showArchived = false;
  const body = el('div');
  const connectorBox = el('section', { class: 'card connector-card' });
  const toggleLabel = el('span');
  const page = el('div', { class: 'page' },
    el('div', { class: 'toolbar' },
      el('h2', { class: 'section-title' }, 'All tests'),
      el('div', { class: 'toolbar-right' },
        el('label', { class: 'check' }, el('input', { type: 'checkbox', id: 'show-archived', onchange: (e: Event) => { showArchived = (e.target as HTMLInputElement).checked; draw(); } }), toggleLabel),
        el('a', { class: 'btn btn-primary', href: '#/import' }, '＋ Import a test'))),
    body,
    connectorBox);
  root.append(appHeader('Import, archive and restore tests'), page);

  async function setStatus(t: ManagedTest, status: TestStatus) {
    try {
      await api(`/tests/${t.id}`, { method: 'PATCH', body: { status } });
      t.status = status;
      toast(status === 'archived' ? `Archived "${t.title}". It no longer shows on the dashboard.` : `Restored "${t.title}" to the dashboard.`, 'ok');
      draw();
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  function draw() {
    const archived = tests.filter(t => t.status === 'archived').length;
    toggleLabel.textContent = `Show archived (${archived})`;
    const list = tests.filter(t => showArchived || t.status !== 'archived');
    if (!list.length) {
      body.replaceChildren(el('div', { class: 'empty' },
        el('h3', null, tests.length ? 'Every test is archived' : 'No tests yet'),
        el('p', null, 'Paste a test from Claude (JSON) or a test in the text format.'),
        el('a', { class: 'btn btn-primary', href: '#/import' }, '＋ Import a test')));
      return;
    }
    body.replaceChildren(el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', { class: 'table tests-table' },
      el('thead', null, el('tr', null, [['Added', 'col-added'], ['Test', ''], ['Questions', ''], ['Attempts', 'col-attempts'], ['From', 'col-from'], ['', '']].map(([h, c]) => el('th', { class: c || null }, h)))),
      el('tbody', null, list.map(t => el('tr', { class: t.status === 'archived' ? 'archived' : '', dataset: { testId: t.id } },
        el('td', { class: 'nowrap col-added' }, fmtDate(t.createdAt)),
        el('td', null,
          el('a', { href: `#/test/${t.id}` }, el('b', null, t.title)),
          el('div', { class: 'badges' }, skillBadge(t.skill), kindBadge(t.kind), t.status === 'archived' ? el('span', { class: 'badge badge-archived' }, 'Archived') : null)),
        el('td', null, t.marks ? String(t.marks) : '–'),
        el('td', { class: 'col-attempts' }, String(t.attemptCount)),
        el('td', { class: 'col-from' }, t.source === 'claude' ? 'Claude' : 'Import'),
        el('td', { class: 'test-action' }, t.status === 'archived'
          ? el('button', { class: 'btn btn-sm', onclick: () => setStatus(t, 'assigned') }, 'Restore')
          : el('button', { class: 'btn btn-sm', onclick: () => setStatus(t, 'archived') }, 'Archive')))))))));
  }
  function drawConnector(c: ConnectorResponse) {
    const copy = async () => {
      try { await navigator.clipboard.writeText(c.mcpUrl); toast('Address copied', 'ok'); } catch { toast('Copying is blocked in this browser', 'err'); }
    };
    const disconnect = async () => {
      if (!await confirmDialog('Disconnect Claude? It has to sign in again (and you approve it again) before it can use the site.', { ok: 'Disconnect', danger: true })) return;
      try {
        await api('/connector/disconnect', { method: 'POST', body: {} });
        drawConnector(await api<ConnectorResponse>('/connector'));
        toast('Disconnected', 'ok');
      } catch (e) { toast((e as Error).message, 'err'); }
    };
    connectorBox.replaceChildren(
      el('div', { class: 'card-head' },
        el('h3', { class: 'card-title' }, '🔌 Claude connector'),
        c.connections.length ? el('span', { class: 'pill-ok' }, '✓ Connected') : el('span', { class: 'badge' }, 'Not connected')),
      el('p', null, 'Claude can upload tests, read your answers and save its marking here. In claude.ai: ', el('b', null, 'Customize → Connectors → Add custom connector'), ', then paste this address:'),
      el('div', { class: 'connector-url' }, el('code', null, c.mcpUrl), el('button', { class: 'btn btn-sm', onclick: copy }, 'Copy')),
      el('p', { class: 'hint' }, 'Claude then opens this site and asks you to allow the connection.'),
      c.connections.length
        ? el('div', null,
          el('ul', { class: 'plain-list' }, c.connections.map(x => el('li', null,
            el('b', null, x.clientName || 'An app'), ` — connected ${fmtDate(x.connectedAt)}`, x.lastUsedAt ? `, last used ${fmtDate(x.lastUsedAt)}` : ''))),
          el('button', { class: 'btn btn-sm btn-danger', onclick: disconnect }, 'Disconnect'))
        : '');
  }
  draw();
  drawConnector(connector);
}
