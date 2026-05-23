import type { Block, Plan } from '../models/plan';
import { SLOT_MINUTES, DAY_MINUTES } from './constants';
import { timeToMinutes, roundToSlot, nowMinutes } from './date-utils';
import { blocksForDay } from './repeat-engine';

export function slotIsFree(
  blocks: Block[],
  dayIndex: number,
  start: number,
  end: number,
  ignoreId = '',
  planWeekStart?: string,
): boolean {
  return !blocksForDay(blocks, dayIndex, planWeekStart).some(block => {
    if (block.id === ignoreId) return false;
    return start < block.end && end > block.start;
  });
}

export function findFreeSlot(
  blocks: Block[],
  dayIndex: number,
  duration: number,
  habits: { wake?: string; sleep?: string },
  preferredStarts: number[] = [],
  minimumStart: number | null = null,
  planWeekStart?: string,
): number | null {
  const wake = timeToMinutes(habits?.wake, 8 * 60);
  let sleep = timeToMinutes(habits?.sleep, 23 * 60 + 30);
  if (sleep <= wake) sleep = DAY_MINUTES;
  const earliest = minimumStart === null ? wake : Math.max(wake, minimumStart);

  const starts = [
    ...preferredStarts,
    8 * 60, 9 * 60, 10 * 60 + 30,
    14 * 60, 16 * 60, 18 * 60 + 30,
    20 * 60, 21 * 60 + 30,
  ]
    .map(roundToSlot)
    .filter(s => s >= earliest && s + duration <= sleep);

  for (const s of starts) {
    if (slotIsFree(blocks, dayIndex, s, s + duration, '', planWeekStart)) return s;
  }

  for (let s = roundToSlot(earliest); s + duration <= sleep; s += SLOT_MINUTES) {
    if (slotIsFree(blocks, dayIndex, s, s + duration, '', planWeekStart)) return s;
  }

  return null;
}

export function findNextFreeSlot(
  blocks: Block[],
  duration: number,
  habits: { wake?: string; sleep?: string },
  preferredStarts: number[] = [],
  currentDayIndex: number,
  planWeekStart?: string,
): { day: number; start: number } | null {
  const start = currentDayIndex >= 0 ? currentDayIndex : new Date().getDay();
  for (let offset = 0; offset < 7; offset++) {
    const day = (start + offset) % 7;
    const minStart = offset === 0 ? roundToSlot(nowMinutes() + SLOT_MINUTES) : null;
    const slot = findFreeSlot(blocks, day, duration, habits, preferredStarts, minStart, planWeekStart);
    if (slot !== null) return { day, start: slot };
  }
  return null;
}
