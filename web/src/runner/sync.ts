/*
 * Autosave to the server.
 * - Only changes are sent (answers / state keys / active seconds), so two devices never wipe each other's work.
 * - Unsent changes are mirrored in localStorage (the offline buffer) and retried until the server has them.
 */
import type { AnswerValue, AttemptPatch, SaveResult } from '@ielts/shared';
import { api, ApiError } from '../lib/api';
import { deviceId, local } from '../lib/dom';

export type SyncStatus = 'saved' | 'saving' | 'offline' | 'error';

interface Pending {
  answers: Record<string, AnswerValue>;
  state: Record<string, unknown>;
  activeSec: Record<string, number>;
}

const empty = (): Pending => ({ answers: {}, state: {}, activeSec: {} });
const isEmpty = (p: Pending) => !Object.keys(p.answers).length && !Object.keys(p.state).length && !Object.values(p.activeSec).some(v => v >= 1);
const RETRY_DELAYS = [2000, 5000, 10000, 30000];

export class AttemptSync {
  private pending: Pending = empty();
  private inFlight: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private stopped = false;
  private readonly key: string;
  status: SyncStatus = 'saved';

  constructor(private readonly attemptId: string, private readonly hooks: {
    onSaved: (r: SaveResult) => void;
    onStatus: (s: SyncStatus, message?: string) => void;
    /** the attempt can no longer be changed (submitted / time up) */
    onClosed: (code: string, message: string) => void;
  }) {
    this.key = `ielts-buffer-${attemptId}`;
  }

  /** changes from this device that never reached the server (e.g. the browser closed while offline) */
  takeBuffer(): Pending | null {
    const raw = local.get(this.key);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Pending;
      this.pending = { answers: { ...p.answers, ...this.pending.answers }, state: { ...p.state, ...this.pending.state }, activeSec: p.activeSec ?? {} };
      return p;
    } catch { local.remove(this.key); return null; }
  }

  setAnswer(qid: string, value: AnswerValue): void { this.pending.answers[qid] = value; this.changed(800); }
  setState(key: string, value: unknown): void { this.pending.state[key] = value; this.changed(1500); }
  addActive(partId: string, seconds: number): void { this.pending.activeSec[partId] = (this.pending.activeSec[partId] ?? 0) + seconds; }

  /** true while something has not reached the server yet */
  get dirty(): boolean { return !isEmpty(this.pending) || this.inFlight !== null; }

  /** active seconds counted on this device that the server has not confirmed yet */
  get unconfirmedActive(): number {
    const sum = (p: Pending | null) => Object.values(p?.activeSec ?? {}).reduce((s, v) => s + v, 0);
    return sum(this.pending) + sum(this.inFlight);
  }

  private changed(delay: number): void {
    this.persist();
    this.setStatus('saving');
    this.schedule(delay);
  }

  private persist(): void {
    const all: Pending = {
      answers: { ...(this.inFlight?.answers ?? {}), ...this.pending.answers },
      state: { ...(this.inFlight?.state ?? {}), ...this.pending.state },
      activeSec: {}
    };
    if (isEmpty(all)) local.remove(this.key); else local.set(this.key, JSON.stringify(all));
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, delay);
  }

  private setStatus(s: SyncStatus, message?: string): void {
    this.status = s;
    this.hooks.onStatus(s, message);
  }

  private body(p: Pending): AttemptPatch {
    const activeSec: Record<string, number> = {};
    for (const [k, v] of Object.entries(p.activeSec)) if (v >= 1) activeSec[k] = Math.round(v);
    return {
      device: deviceId(),
      ...(Object.keys(p.answers).length ? { answers: p.answers } : {}),
      ...(Object.keys(p.state).length ? { state: p.state } : {}),
      ...(Object.keys(activeSec).length ? { activeSec } : {})
    };
  }

  /** send everything pending now. keepalive lets the request finish while the page is closing */
  async flush(opts: { keepalive?: boolean } = {}): Promise<void> {
    if (this.stopped || this.inFlight) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (isEmpty(this.pending)) { if (this.status !== 'offline') this.setStatus('saved'); return; }
    const sending = this.pending;
    this.pending = empty();
    this.inFlight = sending;
    try {
      const r = await api<SaveResult>(`/attempts/${this.attemptId}`, { method: 'PATCH', body: this.body(sending), ...(opts.keepalive ? { keepalive: true } : {}) });
      this.inFlight = null;
      this.retries = 0;
      this.persist();
      this.hooks.onSaved(r);
      if (isEmpty(this.pending)) this.setStatus('saved'); else this.schedule(300);
    } catch (e) {
      this.inFlight = null;
      if (e instanceof ApiError && e.status === 409) {
        this.stopped = true;
        local.remove(this.key);
        this.hooks.onClosed(e.code, e.message);
        return;
      }
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        // the server refused this change (should not happen); drop it rather than retrying forever
        console.error('Save refused', e.issues);
        this.persist();
        this.setStatus('error', e.message);
        return;
      }
      // offline or server unreachable: put the changes back (newer edits win) and retry
      this.pending = {
        answers: { ...sending.answers, ...this.pending.answers },
        state: { ...sending.state, ...this.pending.state },
        activeSec: Object.fromEntries([...new Set([...Object.keys(sending.activeSec), ...Object.keys(this.pending.activeSec)])]
          .map(k => [k, (sending.activeSec[k] ?? 0) + (this.pending.activeSec[k] ?? 0)]))
      };
      this.persist();
      this.setStatus('offline');
      this.schedule(RETRY_DELAYS[Math.min(this.retries++, RETRY_DELAYS.length - 1)] ?? 30000);
    }
  }

  /** save everything and finish the attempt */
  async submit(): Promise<SaveResult> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    while (this.inFlight) await new Promise(r => setTimeout(r, 100));
    const sending = this.pending;
    this.pending = empty();
    try {
      const r = await api<SaveResult>(`/attempts/${this.attemptId}/submit`, { method: 'POST', body: this.body(sending) });
      this.stopped = true;
      local.remove(this.key);
      return r;
    } catch (e) {
      this.pending = { answers: { ...sending.answers, ...this.pending.answers }, state: { ...sending.state, ...this.pending.state }, activeSec: sending.activeSec };
      this.persist();
      throw e;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
