import { describe, it, expect } from 'vitest';
import {
  pad, formatDate, parseDate, datePlus, weekStart, dateForDay,
  cleanDate, weekdayForDate, dayIndexForDate, minutesToTime,
  timeToMinutes, roundToSlot, roundToInputStep, clampMinute,
  cleanDurationMinutes, dateDiffDays,
} from '../date-utils';

describe('pad', () => {
  it('pads single digit', () => expect(pad(3)).toBe('03'));
  it('leaves double digit', () => expect(pad(12)).toBe('12'));
});

describe('formatDate', () => {
  it('formats date as YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 23);
    expect(formatDate(d)).toBe('2026-05-23');
  });
});

describe('parseDate', () => {
  it('parses valid date', () => {
    const d = parseDate('2026-05-23');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(4);
    expect(d!.getDate()).toBe(23);
  });
  it('returns null for invalid', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('not-a-date')).toBeNull();
  });
});

describe('datePlus', () => {
  it('adds days', () => expect(datePlus('2026-05-23', 3)).toBe('2026-05-26'));
  it('crosses month boundary', () => expect(datePlus('2026-05-30', 3)).toBe('2026-06-02'));
});

describe('weekStart', () => {
  it('returns Sunday of the week', () => {
    const d = new Date(2026, 4, 23);
    const ws = weekStart(d);
    const parsed = parseDate(ws)!;
    expect(parsed.getDay()).toBe(0);
  });
});

describe('dateForDay', () => {
  it('offsets from week start', () => {
    expect(dateForDay('2026-05-17', 3)).toBe('2026-05-20');
  });
});

describe('cleanDate', () => {
  it('accepts valid date string', () => expect(cleanDate('2026-05-23')).toBe('2026-05-23'));
  it('rejects invalid', () => expect(cleanDate('hello')).toBe(''));
  it('rejects null', () => expect(cleanDate(null)).toBe(''));
});

describe('weekdayForDate', () => {
  it('returns day of week', () => {
    expect(weekdayForDate('2026-05-23')).toBe(6); // Saturday
  });
  it('returns fallback for invalid', () => expect(weekdayForDate('bad', 2)).toBe(2));
});

describe('dayIndexForDate', () => {
  it('computes offset from week start', () => {
    expect(dayIndexForDate('2026-05-20', '2026-05-17')).toBe(3);
  });
  it('returns -1 for invalid', () => {
    expect(dayIndexForDate('bad', '2026-05-17')).toBe(-1);
  });
});

describe('minutesToTime', () => {
  it('converts minutes to HH:MM', () => expect(minutesToTime(630)).toBe('10:30'));
  it('clamps negative', () => expect(minutesToTime(-10)).toBe('00:00'));
  it('clamps over 24h', () => expect(minutesToTime(1500)).toBe('24:00'));
});

describe('timeToMinutes', () => {
  it('parses HH:MM', () => expect(timeToMinutes('10:30')).toBe(630));
  it('parses with am/pm', () => expect(timeToMinutes('2:30pm')).toBe(870));
  it('parses 12am as midnight', () => expect(timeToMinutes('12:00am')).toBe(0));
  it('returns fallback for garbage', () => expect(timeToMinutes('nope', 480)).toBe(480));
});

describe('roundToSlot', () => {
  it('rounds to 15-minute slot', () => {
    expect(roundToSlot(607)).toBe(600);
    expect(roundToSlot(608)).toBe(615);
  });
});

describe('roundToInputStep', () => {
  it('rounds to 5-minute step', () => {
    expect(roundToInputStep(603)).toBe(605);
    expect(roundToInputStep(602)).toBe(600);
  });
});

describe('clampMinute', () => {
  it('clamps within 0..1440', () => {
    expect(clampMinute(-5)).toBe(0);
    expect(clampMinute(1500)).toBe(1440);
    expect(clampMinute(600)).toBe(600);
  });
  it('uses fallback for non-number', () => expect(clampMinute('abc', 120)).toBe(120));
});

describe('cleanDurationMinutes', () => {
  it('clamps to range', () => {
    expect(cleanDurationMinutes(3)).toBe(5);
    expect(cleanDurationMinutes(500)).toBe(360);
    expect(cleanDurationMinutes(90)).toBe(90);
  });
  it('uses fallback for empty', () => expect(cleanDurationMinutes('', 60)).toBe(60));
});

describe('dateDiffDays', () => {
  it('calculates positive diff', () => expect(dateDiffDays('2026-05-20', '2026-05-23')).toBe(3));
  it('calculates negative diff', () => expect(dateDiffDays('2026-05-23', '2026-05-20')).toBe(-3));
  it('returns 0 for invalid', () => expect(dateDiffDays('bad', '2026-05-20')).toBe(0));
});
