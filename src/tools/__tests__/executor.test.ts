import { describe, it, expect } from 'vitest';
import { executeToolCalls } from '../executor';
import type { Plan } from '../../models/plan';
import type { ValidatedToolCall } from '../../models/tools';
import { cleanBlock, cleanGoal, cleanProfile, defaultProfile } from '../../engine/plan-cleaner';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    version: 1,
    weekStart: '2026-05-17',
    profile: defaultProfile(),
    habits: { wake: '08:00', sleep: '23:30', deepWorkStart: '09:00' },
    goals: [],
    blocks: [],
    reflections: [],
    memories: [],
    archives: [],
    agents: [],
    workflowPrompts: {},
    ...overrides,
  };
}

describe('executeToolCalls', () => {
  it('creates an event', () => {
    const plan = makePlan();
    const result = executeToolCalls(plan, [{
      name: 'create_event',
      args: { title: 'Meeting', start: 600, end: 660, category: 'admin', kind: 'fixed' },
      valid: true,
    }]);
    expect(result.blocksAdded).toHaveLength(1);
    expect(result.plan.blocks).toHaveLength(1);
    expect(result.plan.blocks[0].title).toBe('Meeting');
    expect(result.plan.blocks[0].start).toBe(600);
    expect(plan.blocks).toHaveLength(0); // original untouched
  });

  it('updates an event', () => {
    const block = cleanBlock({ id: 'b1', title: 'Old', start: 600, end: 660 });
    const plan = makePlan({ blocks: [block] });
    const result = executeToolCalls(plan, [{
      name: 'update_event',
      args: { targetId: 'b1', title: 'New Title' },
      valid: true,
    }]);
    expect(result.blocksModified).toContain('b1');
    expect(result.plan.blocks[0].title).toBe('New Title');
    expect(result.plan.blocks[0].start).toBe(600);
  });

  it('deletes an event', () => {
    const block = cleanBlock({ id: 'b1', title: 'Doomed', start: 600, end: 660 });
    const plan = makePlan({ blocks: [block] });
    const result = executeToolCalls(plan, [{
      name: 'delete_event',
      args: { targetId: 'b1' },
      valid: true,
    }]);
    expect(result.blocksRemoved).toContain('b1');
    expect(result.plan.blocks).toHaveLength(0);
  });

  it('moves an event', () => {
    const block = cleanBlock({ id: 'b1', title: 'Movable', start: 600, end: 660, date: '2026-05-23' });
    const plan = makePlan({ blocks: [block] });
    const result = executeToolCalls(plan, [{
      name: 'move_event',
      args: { targetId: 'b1', start: 480, end: 540, date: '2026-05-24' },
      valid: true,
    }]);
    expect(result.plan.blocks[0].start).toBe(480);
    expect(result.plan.blocks[0].end).toBe(540);
    expect(result.plan.blocks[0].date).toBe('2026-05-24');
  });

  it('resizes an event', () => {
    const block = cleanBlock({ id: 'b1', title: 'Resize', start: 600, end: 660 });
    const plan = makePlan({ blocks: [block] });
    const result = executeToolCalls(plan, [{
      name: 'resize_event',
      args: { targetId: 'b1', end: 720 },
      valid: true,
    }]);
    expect(result.plan.blocks[0].end).toBe(720);
    expect(result.plan.blocks[0].start).toBe(600);
  });

  it('creates a goal', () => {
    const plan = makePlan();
    const result = executeToolCalls(plan, [{
      name: 'create_goal',
      args: { title: 'IELTS 7', deadline: '2026-07-01', successCriteria: 'Writing band >= 7' },
      valid: true,
    }]);
    expect(result.goalsAdded).toHaveLength(1);
    expect(result.plan.goals[0].title).toBe('IELTS 7');
    expect(result.plan.goals[0].status).toBe('active');
  });

  it('updates profile', () => {
    const plan = makePlan();
    const result = executeToolCalls(plan, [{
      name: 'update_profile',
      args: { name: 'Alice', weeklyCapacityHours: 20 },
      valid: true,
    }]);
    expect(result.profileUpdated).toBe(true);
    expect(result.plan.profile.name).toBe('Alice');
    expect(result.plan.profile.weeklyCapacityHours).toBe(20);
  });

  it('collects respond_text messages', () => {
    const plan = makePlan();
    const result = executeToolCalls(plan, [{
      name: 'respond_text',
      args: { text: 'Hello, I scheduled your meeting.' },
      valid: true,
    }]);
    expect(result.messages).toContain('Hello, I scheduled your meeting.');
  });

  it('collects proposed memories', () => {
    const plan = makePlan();
    const result = executeToolCalls(plan, [{
      name: 'propose_memory',
      args: { key: 'sleep-preference', content: 'User prefers 23:00-07:00', reason: 'User stated in chat' },
      valid: true,
    }]);
    expect(result.proposedMemories).toHaveLength(1);
    expect(result.proposedMemories[0].key).toBe('sleep-preference');
  });

  it('handles multiple tool calls in sequence', () => {
    const plan = makePlan();
    const calls: ValidatedToolCall[] = [
      { name: 'create_event', args: { title: 'A', start: 480, end: 540 }, valid: true },
      { name: 'create_event', args: { title: 'B', start: 600, end: 660 }, valid: true },
      { name: 'respond_text', args: { text: 'Created 2 events' }, valid: true },
    ];
    const result = executeToolCalls(plan, calls);
    expect(result.plan.blocks).toHaveLength(2);
    expect(result.blocksAdded).toHaveLength(2);
    expect(result.messages).toHaveLength(1);
  });

  it('does not mutate original plan', () => {
    const block = cleanBlock({ id: 'b1', title: 'Original', start: 600, end: 660 });
    const plan = makePlan({ blocks: [block] });
    const originalBlockCount = plan.blocks.length;
    executeToolCalls(plan, [{
      name: 'delete_event',
      args: { targetId: 'b1' },
      valid: true,
    }]);
    expect(plan.blocks.length).toBe(originalBlockCount);
  });
});
