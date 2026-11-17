/* ===== IndexedDB storage: tests, uploaded files (audio/images) and attempts ===== */

const DB = {
  _db: null,
  _urls: {},

  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('ielts-practice-studio', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const store of ['exams', 'files', 'attempts', 'runs']) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },

  async _tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const st = tx.objectStore(store);
      let result;
      const r = fn(st);
      if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  },

  getAll(store) { return this._tx(store, 'readonly', st => st.getAll()).then(r => r || []); },
  get(store, id) { return this._tx(store, 'readonly', st => st.get(id)); },
  put(store, obj) { return this._tx(store, 'readwrite', st => st.put(obj)); },
  delete(store, id) { return this._tx(store, 'readwrite', st => st.delete(id)); },

  /* ---- files ---- */
  async saveFile(blob, name, id) {
    id = id || uid('file');
    await this.put('files', { id, blob, name: name || blob.name || 'file', type: blob.type || '' });
    return id;
  },
  async fileURL(id) {
    if (!id) return null;
    if (this._urls[id]) return this._urls[id];
    const f = await this.get('files', id);
    if (!f) return null;
    this._urls[id] = URL.createObjectURL(f.blob);
    return this._urls[id];
  },
  async fileInfo(id) {
    if (!id) return null;
    const f = await this.get('files', id);
    return f ? { id: f.id, name: f.name, type: f.type, size: f.blob.size } : null;
  },
  async deleteFile(id) {
    if (!id) return;
    if (this._urls[id]) { URL.revokeObjectURL(this._urls[id]); delete this._urls[id]; }
    await this.delete('files', id);
  },

  /* ---- exam helpers ---- */
  async listExams() {
    const all = await this.getAll('exams');
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  async saveExam(exam) {
    exam.updatedAt = Date.now();
    await this.put('exams', exam);
  },
  async deleteExam(exam) {
    for (const fid of examFileIds(exam)) await this.deleteFile(fid);
    await this.delete('exams', exam.id);
  },
  async listAttempts() {
    const all = await this.getAll('attempts');
    return all.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  },
  async listRuns() {
    const all = await this.getAll('runs');
    return all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
};

/** every file id referenced by a test (audio, task images, group images) */
function examFileIds(exam) {
  const ids = [];
  for (const p of exam.parts || []) {
    if (p.audioId) ids.push(p.audioId);
    if (p.imageId) ids.push(p.imageId);
    for (const g of p.groups || []) if (g.imageId) ids.push(g.imageId);
  }
  return ids;
}

/* ---------- export / import (files embedded as data URLs) ---------- */
async function exportExams(exams) {
  const files = {};
  for (const ex of exams) {
    for (const fid of examFileIds(ex)) {
      const f = await DB.get('files', fid);
      if (f) files[fid] = { name: f.name, type: f.type, data: await blobToDataURL(f.blob) };
    }
  }
  return JSON.stringify({ format: 'ielts-practice-studio', version: 1, exportedAt: new Date().toISOString(), exams, files }, null, 1);
}

async function importExamsFromJSON(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('This file is not valid JSON.'); }
  let exams = [], files = {};
  if (Array.isArray(data)) exams = data;
  else if (data.exams) { exams = data.exams; files = data.files || {}; }
  else if (data.parts) exams = [data];
  else throw new Error('No tests found in this file.');

  const existing = new Set((await DB.getAll('exams')).map(e => e.id));
  const fileMap = {};
  for (const [oldId, f] of Object.entries(files)) {
    try {
      const blob = await dataURLToBlob(f.data);
      fileMap[oldId] = await DB.saveFile(blob, f.name);
    } catch (e) { console.warn('Could not import file', oldId, e); }
  }
  const remap = id => (id && fileMap[id]) ? fileMap[id] : (id && files[id] ? null : id);
  const imported = [];
  for (const raw of exams) {
    const ex = normalizeExam(raw);
    if (existing.has(ex.id)) { ex.id = uid('exam'); ex.title += ' (imported)'; }
    for (const p of ex.parts) {
      p.audioId = remap(p.audioId);
      p.imageId = remap(p.imageId);
      for (const g of p.groups) g.imageId = remap(g.imageId);
    }
    ex.updatedAt = Date.now();
    await DB.put('exams', ex);
    imported.push(ex);
  }
  return imported;
}
