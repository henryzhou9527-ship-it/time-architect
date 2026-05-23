import { DAY_MINUTES, SLOT_MINUTES, INPUT_STEP_MINUTES, MIN_BLOCK_MINUTES } from './constants';

export function pad(value: number | string): string {
  return String(value).padStart(2, '0');
}

export function formatDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function parseDate(dateStr: string): Date | null {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function datePlus(dateStr: string, days: number): string {
  const date = parseDate(dateStr) || new Date();
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

export function weekStart(date: Date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return formatDate(d);
}

export function weekRangeLabel(ws: string): string {
  return `${ws} - ${datePlus(ws, 6)}`;
}

export function dateForDay(ws: string, day: number): string {
  return datePlus(ws, day);
}

export function cleanDate(value: unknown): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
}

export function weekdayForDate(dateStr: string, fallback = 0): number {
  const date = parseDate(dateStr);
  if (!date) return Math.max(0, Math.min(6, Number(fallback) || 0));
  return date.getDay();
}

export function dayIndexForDate(dateStr: string, ws: string): number {
  const start = parseDate(ws);
  const current = parseDate(dateStr);
  if (!start || !current) return -1;
  return Math.round((current.getTime() - start.getTime()) / 86400000);
}

export function currentDayIndex(ws: string): number {
  return dayIndexForDate(formatDate(new Date()), ws);
}

export function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${pad(h)}:${pad(m)}`;
}

export function timeToMinutes(value: unknown, fallback = 9 * 60): number {
  const text = String(value || '').trim().toLowerCase();
  const match = text.match(/^(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/);
  if (!match) return fallback;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const suffix = match[3];
  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return fallback;
  return Math.max(0, Math.min(DAY_MINUTES, hour * 60 + minute));
}

export function roundToSlot(minutes: number): number {
  return Math.round(minutes / SLOT_MINUTES) * SLOT_MINUTES;
}

export function roundToInputStep(minutes: number): number {
  return Math.round((Number(minutes) || 0) / INPUT_STEP_MINUTES) * INPUT_STEP_MINUTES;
}

export function clampMinute(minutes: unknown, fallback = 0): number {
  const value = Number.isFinite(Number(minutes)) ? Number(minutes) : fallback;
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(value)));
}

export function cleanDurationMinutes(value: unknown, fallback = 60, max = 360): number {
  const text = String(value ?? '').trim();
  const raw = text && Number.isFinite(Number(text)) ? Number(text) : fallback;
  return Math.max(MIN_BLOCK_MINUTES, Math.min(max, Math.round(raw)));
}

export function dateDiffDays(startDate: string, endDate: string): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}
