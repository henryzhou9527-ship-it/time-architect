import { describe, it, expect } from 'vitest';
import { slotIsFree, findFreeSlot } from '../slot-finder';
import type { Block } from '../../models/plan';
import { cleanBlock } from '../plan-cleaner';

function makeBlock(start: number, end: number, day = 0): Block {
  return cleanBlock({ start, end, day, date: '2026-05-18' });
}

describe('slotIsFree', () => {
  const blocks = [makeBlock(600, 660), makeBlock(720, 780)];

  it('returns true for empty slot', () => {
    expect(slotIsFree(blocks, 0, 660, 720, '', '2026-05-18')).toBe(true);
  });
  it('returns false for overlapping slot', () => {
    expect(slotIsFree(blocks, 0, 630, 690, '', '2026-05-18')).toBe(false);
  });
  it('ignores block by id', () => {
    expect(slotIsFree(blocks, 0, 600, 660, blocks[0].id, '2026-05-18')).toBe(true);
  });
});

describe('findFreeSlot', () => {
  const blocks = [makeBlock(480, 600), makeBlock(600, 720)];
  const habits = { wake: '08:00', sleep: '23:30' };

  it('finds first available slot', () => {
    const slot = findFreeSlot(blocks, 0, 60, habits, [], null, '2026-05-18');
    expect(slot).not.toBeNull();
    expect(slot!).toBeGreaterThanOrEqual(720);
  });

  it('returns null when no room', () => {
    const fullBlocks = [];
    for (let s = 480; s < 1410; s += 15) {
      fullBlocks.push(makeBlock(s, s + 15));
    }
    const slot = findFreeSlot(fullBlocks, 0, 60, habits, [], null, '2026-05-18');
    expect(slot).toBeNull();
  });

  it('respects minimum start', () => {
    const slot = findFreeSlot([], 0, 60, habits, [], 900, '2026-05-18');
    expect(slot).not.toBeNull();
    expect(slot!).toBeGreaterThanOrEqual(900);
  });
});
