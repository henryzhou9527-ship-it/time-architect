import type { Repeat, Block, BlockOccurrence, Plan } from '../models/plan';
import { REPEAT_OPTIONS } from './constants';
import { cleanDate, weekStart, dateForDay, dateDiffDays, dayIndexForDate, parseDate, weekdayForDate } from './date-utils';

export interface RepeatIntent {
  frequency: Repeat['frequency'];
  interval: number;
  recurrenceExplicit: boolean;
  defaultedToNone: boolean;
}

export function cleanRepeat(raw: unknown): Repeat {
  let source: Record<string, unknown> = {};
  if (typeof raw === 'string') source = { frequency: raw };
  else if (raw && typeof raw === 'object') source = raw as Record<string, unknown>;

  const freq = String(source.frequency || '');
  const frequency = Object.prototype.hasOwnProperty.call(REPEAT_OPTIONS, freq)
    ? (freq as Repeat['frequency'])
    : 'none';
  const interval = Math.max(1, Math.min(30, Number(source.interval) || 1));
  const until = /^\d{4}-\d{2}-\d{2}$/.test(String(source.until || '')) ? String(source.until) : '';
  const count = Math.max(0, Math.min(366, Number(source.count) || 0));
  return { frequency, interval, until, count };
}

export function repeatLabel(repeat: unknown): string {
  const clean = cleanRepeat(repeat);
  const base = REPEAT_OPTIONS[clean.frequency]?.label || REPEAT_OPTIONS.none.label;
  if (clean.frequency === 'none') return base;
  const every = clean.interval > 1 ? `每 ${clean.interval} 个周期` : base;
  const stop = clean.until ? `，到 ${clean.until}` : (clean.count ? `，共 ${clean.count} 次` : '');
  return `${every}${stop}`;
}

export function detectRepeatIntent(note: string): RepeatIntent {
  const text = String(note || '').toLowerCase();
  const hasDaily = /(每天|每日|天天|\bdaily\b|\bevery\s+day\b)/i.test(text);
  const hasWeekly = /(每周|每星期|每礼拜|每个?周[一二三四五六日天]?|每个?星期[一二三四五六日天]?|\bweekly\b|\bevery\s+week\b|\bevery\s+(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\b)/i.test(text);
  const hasMonthly = /(每月|每个月|每个?月|\bmonthly\b|\bevery\s+month\b)/i.test(text);
  const hasGenericRepeat = /(重复|循环|固定每|recurring|recur|repeat)/i.test(text);
  const frequency: Repeat['frequency'] =
    hasDaily ? 'daily' : hasWeekly ? 'weekly' : hasMonthly ? 'monthly' : 'none';
  return {
    frequency: frequency === 'none' && hasGenericRepeat ? 'weekly' : frequency,
    interval: 1,
    recurrenceExplicit: frequency !== 'none' || hasGenericRepeat,
    defaultedToNone: frequency === 'none' && !hasGenericRepeat,
  };
}

export function blockAnchorDate(block: Partial<Block>, planWeekStart?: string): string {
  const ws = planWeekStart || weekStart(new Date());
  return cleanDate(block?.date) || dateForDay(ws, block?.day || 0);
}

export function repeatAllowsDate(block: Partial<Block>, dateStr: string, planWeekStart?: string): boolean {
  const repeat = cleanRepeat(block?.repeat);
  const anchorDate = blockAnchorDate(block, planWeekStart);
  if (!anchorDate) return false;
  const diff = dateDiffDays(anchorDate, dateStr);
  if (diff < 0) return false;
  if (repeat.until && dateStr > repeat.until) return false;

  if (repeat.frequency === 'none') {
    return dateStr === anchorDate ||
      (!block?.date && dayIndexForDate(dateStr, planWeekStart || weekStart(new Date())) === block?.day);
  }
  if (repeat.frequency === 'daily') {
    const occurrence = Math.floor(diff / repeat.interval) + 1;
    return diff % repeat.interval === 0 && (!repeat.count || occurrence <= repeat.count);
  }
  if (repeat.frequency === 'weekly') {
    const weeks = Math.floor(diff / 7);
    const occurrence = weeks + 1;
    return diff % 7 === 0 && weeks % repeat.interval === 0 && (!repeat.count || occurrence <= repeat.count);
  }
  if (repeat.frequency === 'monthly') {
    const anchor = parseDate(anchorDate);
    const current = parseDate(dateStr);
    if (!anchor || !current || current.getDate() !== anchor.getDate()) return false;
    const months = (current.getFullYear() - anchor.getFullYear()) * 12 + current.getMonth() - anchor.getMonth();
    const occurrence = months + 1;
    return months >= 0 && months % repeat.interval === 0 && (!repeat.count || occurrence <= repeat.count);
  }
  return false;
}

export function blockOccurrenceForDay(
  block: Block,
  dayIndex: number,
  planWeekStart?: string,
): BlockOccurrence | null {
  const ws = planWeekStart || weekStart(new Date());
  const dateStr = dateForDay(ws, dayIndex);
  if (!repeatAllowsDate(block, dateStr, ws)) return null;
  return {
    ...block,
    day: dayIndex,
    occurrenceDate: dateStr,
    occurrenceAnchorDate: blockAnchorDate(block, ws),
    recurringOccurrence: cleanRepeat(block.repeat).frequency !== 'none',
  };
}

export function blocksForDay(blocks: Block[], dayIndex: number, planWeekStart?: string): BlockOccurrence[] {
  return blocks
    .map(block => blockOccurrenceForDay(block, dayIndex, planWeekStart))
    .filter((b): b is BlockOccurrence => b !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.title.localeCompare(b.title));
}
