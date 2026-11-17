import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../db/client';
import { files } from '../db/schema';

export type FileKind = 'audio' | 'image' | 'recording';

const EXT_BY_MIME: Record<string, string> = {
  'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  'audio/ogg': '.ogg', 'audio/webm': '.webm', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg'
};

/** URL the website uses for a stored file (served behind login from Phase 2) */
export const fileUrl = (id: string): string => `/files/${id}`;

/** saves uploaded files to disk (UPLOAD_DIR) and records them in the "files" table */
export class FileStore {
  constructor(private readonly db: Db, readonly rootDir: string) {}

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

  absolutePath(storagePath: string): string {
    return path.join(this.rootDir, storagePath);
  }
}
