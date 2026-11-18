/*
 * Speaking recordings -> text with a whisper.cpp server (Phase 11, ielts-site-spec.md item 10). Off unless WHISPER_URL
 * is set (e.g. http://ielts-whisper:8080). One recording at a time, in the background: saving a recording never waits
 * for it. Recordings still "pending" when the app starts are picked up again.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '../db/client';
import { files } from '../db/schema';
import type { FileStore } from './store';

const TIMEOUT_MS = 10 * 60_000;

/** whisper.cpp answers { "text": "…" } for response_format=json; segments are joined if that is what comes back */
export function textOf(body: unknown): string | null {
  if (typeof body === 'string') return body.trim();
  if (!body || typeof body !== 'object') return null;
  const b = body as { text?: unknown; transcription?: unknown; segments?: unknown };
  if (typeof b.text === 'string') return b.text.replace(/\s+/g, ' ').trim();
  const segs = Array.isArray(b.segments) ? b.segments : Array.isArray(b.transcription) ? b.transcription : null;
  if (segs) return segs.map(s => (s && typeof s === 'object' && typeof (s as { text?: unknown }).text === 'string' ? (s as { text: string }).text : '')).join(' ').replace(/\s+/g, ' ').trim();
  return null;
}

export class Transcriber {
  private queue: string[] = [];
  private busy = false;
  private current: string | null = null;

  constructor(private readonly db: Db, private readonly store: FileStore, private readonly url: string) {}

  /** recordings saved while the app was down, or before the transcriber was switched on */
  async resumePending(): Promise<void> {
    const rows = await this.db.select({ id: files.id }).from(files)
      .where(and(eq(files.kind, 'recording'), or(eq(files.transcriptStatus, 'pending'), isNull(files.transcriptStatus))));
    for (const r of rows) this.enqueue(r.id);
  }

  enqueue(fileId: string): void {
    if (this.queue.includes(fileId) || this.current === fileId) return;
    this.queue.push(fileId);
    void this.db.update(files).set({ transcriptStatus: 'pending' }).where(eq(files.id, fileId)).catch(() => {});
    void this.run();
  }

  /** for tests: resolves when the queue is empty */
  async idle(): Promise<void> {
    while (this.busy || this.queue.length) await new Promise(r => setTimeout(r, 20));
  }

  private async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        this.current = id;
        try { await this.one(id); } finally { this.current = null; }
      }
    } finally { this.busy = false; }
  }

  private async one(id: string): Promise<void> {
    const [f] = await this.db.select().from(files).where(eq(files.id, id)).limit(1);
    if (!f) return; // replaced or deleted meanwhile
    const t0 = Date.now();
    try {
      const data = await readFile(path.join(this.store.rootDir, f.storagePath));
      const form = new FormData();
      form.append('file', new Blob([data], { type: f.mimeType }), f.originalName);
      form.append('response_format', 'json');
      form.append('temperature', '0.0');
      const res = await fetch(`${this.url.replace(/\/$/, '')}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.text();
      let body: unknown = raw;
      try { body = JSON.parse(raw); } catch { /* plain text */ }
      const text = textOf(body);
      if (text === null) throw new Error('no text in the answer');
      await this.db.update(files).set({ transcript: text, transcriptStatus: 'done' }).where(eq(files.id, id));
      console.log(`[whisper] ${id}: ${text.split(/\s+/).filter(Boolean).length} words in ${Date.now() - t0} ms`);
    } catch (e) {
      console.warn(`[whisper] ${id} failed: ${(e as Error).message}`);
      await this.db.update(files).set({ transcriptStatus: 'failed' }).where(eq(files.id, id)).catch(() => {});
    }
  }
}
