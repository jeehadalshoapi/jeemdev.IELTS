import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Db } from '../db/client';
import { files } from '../db/schema';

export type FileKind = 'audio' | 'image' | 'recording';

export class FileTooLargeError extends Error {
  constructor(readonly maxBytes: number) { super(`The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`); }
}
export class EmptyFileError extends Error {
  constructor() { super('The file is empty.'); }
}

const EXT_BY_MIME: Record<string, string> = {
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  'audio/ogg': '.ogg', 'audio/webm': '.webm', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg'
};

/** URL the website uses for a stored file (served behind login from Phase 2) */
export const fileUrl = (id: string): string => `/files/${id}`;

/** saves uploaded files to disk (UPLOAD_DIR) and records them in the "files" table */
export class FileStore {
  readonly rootDir: string;
  /** a relative UPLOAD_DIR is resolved now: res.sendFile() needs an absolute path */
  constructor(private readonly db: Db, rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  async save(input: {
    data: Uint8Array;
    originalName: string;
    mimeType: string;
    kind: FileKind;
    testId?: string;
    attemptId?: string;
    id?: string;
  }): Promise<{ id: string; url: string; storagePath: string }> {
    const id = input.id ?? randomUUID();
    const ext = (path.extname(input.originalName) || EXT_BY_MIME[input.mimeType] || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const storagePath = `${input.kind}/${id}${ext}`;
    const abs = path.join(this.rootDir, storagePath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, input.data);
    await this.db.insert(files).values({
      id,
      kind: input.kind,
      originalName: input.originalName.slice(0, 255),
      mimeType: input.mimeType || 'application/octet-stream',
      sizeBytes: input.data.byteLength,
      sha256: createHash('sha256').update(input.data).digest('hex'),
      storagePath,
      testId: input.testId ?? null,
      attemptId: input.attemptId ?? null
    });
    return { id, url: fileUrl(id), storagePath };
  }

  /**
   * Stream an upload to disk without holding it in memory. Throws FileTooLargeError past `maxBytes`
   * (the partial file is removed) and EmptyFileError for an empty body.
   */
  async saveStream(input: {
    stream: Readable;
    maxBytes: number;
    originalName: string;
    mimeType: string;
    kind: FileKind;
    testId?: string;
    attemptId?: string;
  }): Promise<{ id: string; url: string; storagePath: string; sizeBytes: number }> {
    const id = randomUUID();
    const ext = (path.extname(input.originalName) || EXT_BY_MIME[input.mimeType] || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    const storagePath = `${input.kind}/${id}${ext}`;
    const abs = path.join(this.rootDir, storagePath);
    const tmp = `${abs}.part`;
    await mkdir(path.dirname(abs), { recursive: true });
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        size += chunk.length;
        if (size > input.maxBytes) { done(new FileTooLargeError(input.maxBytes)); return; }
        hash.update(chunk);
        done(null, chunk);
      }
    });
    try {
      await pipeline(input.stream, meter, createWriteStream(tmp));
      if (size === 0) throw new EmptyFileError();
      await rename(tmp, abs);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    await this.db.insert(files).values({
      id,
      kind: input.kind,
      originalName: input.originalName.slice(0, 255),
      mimeType: input.mimeType,
      sizeBytes: size,
      sha256: hash.digest('hex'),
      storagePath,
      testId: input.testId ?? null,
      attemptId: input.attemptId ?? null
    });
    return { id, url: fileUrl(id), storagePath, sizeBytes: size };
  }

  absolutePath(storagePath: string): string {
    return path.join(this.rootDir, storagePath);
  }
}
