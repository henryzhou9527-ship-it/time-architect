import { describe, it, expect } from 'vitest';
import {
  cleanRepeat, repeatLabel, detectRepeatIntent,
  repeatAllowsDate, blockAnchorDate,
} from '../repeat-engine';

describe('cleanRepeat', () => {
  it('defaults to none', () => {
    const r = cleanRepeat(undefined);
    expect(r.frequency).toBe('none');
    expect(r.interval).toBe(1);
    expect(r.until).toBe('');
    expect(r.count).toBe(0);
  });

  it('accepts string frequency', () => {
    expect(cleanRepeat('daily').frequency).toBe('daily');
    expect(cleanRepeat('weekly').frequency).toBe('weekly');
  });

  it('clamps interval', () => {
    expect(cleanRepeat({ frequency: 'daily', interval: 0 }).interval).toBe(1);
    expect(cleanRepeat({ frequency: 'daily', interval: 50 }).interval).toBe(30);
  });

  it('validates until format', () => {
    expect(cleanRepeat({ until: '2026-06-01' }).until).toBe('2026-06-01');
    expect(cleanRepeat({ until: 'next week' }).until).toBe('');
  });
});

describe('repeatLabel', () => {
  it('returns "不重复" for none', () => expect(repeatLabel({ frequency: 'none' })).toBe('不重复'));
  it('returns "每天" for daily', () => expect(repeatLabel({ frequency: 'daily' })).toBe('每天'));
  it('shows interval', () => expect(repeatLabel({ frequency: 'daily', interval: 3 })).toBe('每 3 个周期'));
  it('shows until', () => expect(repeatLabel({ frequency: 'weekly', interval: 1, until: '2026-06-01' })).toBe('每周，到 2026-06-01'));
});

describe('detectRepeatIntent', () => {
  it('detects daily', () => {
    expect(detectRepeatIntent('每天跑步').frequency).toBe('daily');
    expect(detectRepeatIntent('daily standup').frequency).toBe('daily');
  });
  it('detects weekly', () => {
    expect(detectRepeatIntent('每周三开会').frequency).toBe('weekly');
    expect(detectRepeatIntent('every monday').frequency).toBe('weekly');
  });
  it('detects monthly', () => {
    expect(detectRepeatIntent('每月总结').frequency).toBe('monthly');
  });
  it('defaults to none for one-time', () => {
    const result = detectRepeatIntent('next Wednesday consulting');
    expect(result.frequency).toBe('none');
    expect(result.defaultedToNone).toBe(true);
  });
  it('generic repeat fallback to weekly', () => {
    const result = detectRepeatIntent('重复安排');
    expect(result.frequency).toBe('weekly');
  });
});

describe('blockAnchorDate', () => {
  it('uses block date if present', () => {
    expect(blockAnchorDate({ date: '2026-05-25' }, '2026-05-18')).toBe('2026-05-25');
  });
  it('falls back to day offset', () => {
    const anchor = blockAnchorDate({ day: 3 }, '2026-05-18');
    expect(anchor).toBe('2026-05-21');
  });
});

describe('repeatAllowsDate', () => {
  it('allows same date for non-repeat', () => {
    expect(repeatAllowsDate({ date: '2026-05-25', repeat: { frequency: 'none', interval: 1, until: '', count: 0 } }, '2026-05-25')).toBe(true);
  });
  it('rejects different date for non-repeat', () => {
    expect(repeatAllowsDate({ date: '2026-05-25', repeat: { frequency: 'none', interval: 1, until: '', count: 0 } }, '2026-05-26')).toBe(false);
  });
  it('allows daily repeats', () => {
    const block = { date: '2026-05-20', repeat: { frequency: 'daily' as const, interval: 1, until: '', count: 0 } };
    expect(repeatAllowsDate(block, '2026-05-20')).toBe(true);
    expect(repeatAllowsDate(block, '2026-05-23')).toBe(true);
  });
  it('respects daily interval', () => {
    const block = { date: '2026-05-20', repeat: { frequency: 'daily' as const, interval: 2, until: '', count: 0 } };
    expect(repeatAllowsDate(block, '2026-05-22')).toBe(true);
    expect(repeatAllowsDate(block, '2026-05-21')).toBe(false);
  });
  it('allows weekly repeats on same weekday', () => {
    const block = { date: '2026-05-20', repeat: { frequency: 'weekly' as const, interval: 1, until: '', count: 0 } };
    expect(repeatAllowsDate(block, '2026-05-27')).toBe(true);
    expect(repeatAllowsDate(block, '2026-05-26')).toBe(false);
  });
  it('respects count limit', () => {
    const block = { date: '2026-05-20', repeat: { frequency: 'daily' as const, interval: 1, until: '', count: 3 } };
    expect(repeatAllowsDate(block, '2026-05-22')).toBe(true);
    expect(repeatAllowsDate(block, '2026-05-23')).toBe(false);
  });
  it('respects until date', () => {
    const block = { date: '2026-05-20', repeat: { frequency: 'daily' as const, interval: 1, until: '2026-05-22', count: 0 } };
    expect(repeatAllowsDate(block, '2026-05-22')).toBe(true);
    expect(repeatAllowsDate(block, '2026-05-23')).toBe(false);
  });
});
