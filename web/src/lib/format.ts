export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function fmtDay(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return `${h} h ${m} min`;
  return m ? `${m} min${r ? ` ${r} s` : ''}` : `${r} s`;
}

export function wordCount(text: unknown): number {
  const t = String(text ?? '').trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

/** days until a due date (negative = overdue) */
export function daysUntil(isoDate: string): number {
  const due = new Date(`${isoDate}T23:59:59`).getTime();
  return Math.ceil((due - Date.now()) / 86400_000);
}
