import type { ApiErrorBody } from '@ielts/shared';

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
