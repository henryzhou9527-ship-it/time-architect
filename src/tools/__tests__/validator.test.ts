import { describe, it, expect } from 'vitest';
import { validateToolCall, validateToolCalls } from '../validator';
import { cleanBlock } from '../../engine/plan-cleaner';

const block1 = cleanBlock({ id: 'b1', title: 'Meeting', start: 600, end: 660, date: '2026-05-23' });
const block2 = cleanBlock({ id: 'b2', title: 'Lunch', start: 720, end: 780, date: '2026-05-23' });
const plan = { blocks: [block1, block2] };

describe('validateToolCall', () => {
  describe('agent role restrictions', () => {
    it('allows engineer to create_event', () => {
      const result = validateToolCall(
        { name: 'create_event', args: { title: 'Test', start: 480, end: 540 } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(true);
    });

    it('blocks dialogue from create_event', () => {
      const result = validateToolCall(
        { name: 'create_event', args: { title: 'Test', start: 480, end: 540 } },
        plan, 'dialogue',
      );
      expect(result.valid).toBe(false);
      expect((result as any).error).toContain('cannot use tool');
    });

    it('allows dialogue to respond_text', () => {
      const result = validateToolCall(
        { name: 'respond_text', args: { text: 'Hello' } },
        plan, 'dialogue',
      );
      expect(result.valid).toBe(true);
    });

    it('blocks auditor from delete_event', () => {
      const result = validateToolCall(
        { name: 'delete_event', args: { targetId: 'b1' } },
        plan, 'auditor',
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('create_event validation', () => {
    it('rejects missing title', () => {
      const result = validateToolCall(
        { name: 'create_event', args: { start: 480, end: 540 } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(false);
    });

    it('rejects invalid time range', () => {
      const result = validateToolCall(
        { name: 'create_event', args: { title: 'X', start: 600, end: 601 } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(false);
    });

    it('rejects invalid date', () => {
      const result = validateToolCall(
        { name: 'create_event', args: { title: 'X', start: 600, end: 660, date: 'next-wed' } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(false);
    });

    it('rejects invalid category', () => {
      const result = validateToolCall(
        { name: 'create_event', args: { title: 'X', start: 600, end: 660, category: 'bogus' } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(false);
    });

    it('applies recurrence guard', () => {
      const result = validateToolCall(
        { name: 'create_event', args: { title: 'Consult', start: 600, end: 660, repeat: { frequency: 'weekly' } } },
        plan, 'engineer', 'book next Wednesday 10am consulting',
      );
      expect(result.valid).toBe(true);
      expect((result as any).args.repeat.frequency).toBe('none');
    });

    it('preserves explicit recurrence', () => {
      const result = validateToolCall(
        { name: 'create_event', args: { title: 'Standup', start: 540, end: 555, repeat: { frequency: 'daily' } } },
        plan, 'engineer', '每天早上9点standup',
      );
      expect(result.valid).toBe(true);
      expect((result as any).args.repeat.frequency).toBe('daily');
    });
  });

  describe('update_event validation', () => {
    it('rejects missing targetId', () => {
      const result = validateToolCall(
        { name: 'update_event', args: { title: 'New title' } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(false);
    });

    it('rejects non-existent block', () => {
      const result = validateToolCall(
        { name: 'update_event', args: { targetId: 'ghost' } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(false);
      expect((result as any).error).toContain('not found');
    });

    it('accepts valid update', () => {
      const result = validateToolCall(
        { name: 'update_event', args: { targetId: 'b1', title: 'Renamed' } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('delete_event validation', () => {
    it('rejects non-existent block', () => {
      const result = validateToolCall(
        { name: 'delete_event', args: { targetId: 'ghost' } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(false);
    });

    it('accepts valid delete', () => {
      const result = validateToolCall(
        { name: 'delete_event', args: { targetId: 'b1' } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('move_event validation', () => {
    it('validates target exists', () => {
      const result = validateToolCall(
        { name: 'move_event', args: { targetId: 'ghost', start: 480, end: 540 } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(false);
    });

    it('accepts valid move', () => {
      const result = validateToolCall(
        { name: 'move_event', args: { targetId: 'b1', start: 480, end: 540, date: '2026-05-24' } },
        plan, 'engineer',
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('respond_text validation', () => {
    it('rejects missing text', () => {
      const result = validateToolCall(
        { name: 'respond_text', args: {} },
        plan, 'dialogue',
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('unknown tool', () => {
    it('rejects unknown tool name', () => {
      const result = validateToolCall(
        { name: 'hack_system', args: {} },
        plan, 'planner',
      );
      expect(result.valid).toBe(false);
    });
  });
});

describe('validateToolCalls', () => {
  it('validates multiple calls', () => {
    const results = validateToolCalls([
      { name: 'create_event', args: { title: 'A', start: 480, end: 540 } },
      { name: 'respond_text', args: { text: 'Done' } },
    ], plan, 'engineer');
    expect(results).toHaveLength(2);
    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(true);
  });
});
