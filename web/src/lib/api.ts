import type { ApiErrorBody, UploadResponse } from '@ielts/shared';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly issues: ApiErrorBody['issues'] = []) {
    super(message);
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)ielts_csrf=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : '';
}

/**
 * Call the server API. Network problems throw a TypeError (the caller decides whether to retry);
 * a 401 sends the browser to the login page.
 */
export async function api<T>(path: string, o: { method?: string; body?: unknown; keepalive?: boolean; redirectOn401?: boolean } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: o.method ?? 'GET',
    credentials: 'same-origin',
    keepalive: o.keepalive ?? false,
    headers: {
      'x-csrf-token': csrfToken(),
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {})
    },
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {})
  });
  if (res.status === 401 && (o.redirectOn401 ?? true)) {
    location.href = '/login';
    throw new ApiError(401, 'not_logged_in', 'Please log in.');
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const b = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, b.error ?? 'http_error', b.message ?? `Request failed (${res.status})`, b.issues ?? []);
  }
  return data as T;
}

/** send a file or recording as the raw request body; XHR rather than fetch so the progress can be shown */
export function uploadTo<T>(url: string, body: Blob, contentType: string, onProgress: (fraction: number) => void): { done: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<T>((resolve, reject) => {
    xhr.open('POST', url);
    xhr.setRequestHeader('x-csrf-token', csrfToken());
    xhr.setRequestHeader('content-type', contentType);
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data: Partial<ApiErrorBody> = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 401) { location.href = '/login'; reject(new ApiError(401, 'not_logged_in', 'Please log in.')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, data.error ?? 'http_error', data.message ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new TypeError('Cannot reach the server.'));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled.'));
    xhr.send(body);
  });
  return { done, abort: () => xhr.abort() };
}

/** upload an audio file or picture for a test (POST /api/files) */
export function uploadFile(file: File, contentType: string, onProgress: (fraction: number) => void): { done: Promise<UploadResponse>; abort: () => void } {
  return uploadTo<UploadResponse>(`/api/files?name=${encodeURIComponent(file.name)}`, file, contentType, onProgress);
}
