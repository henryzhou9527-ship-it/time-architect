import { describe, it, expect } from 'vitest';
import {
  textArray, normalizeTaskKind, cleanBlock, cleanWorkload,
  cleanGoal, cleanReflection, cleanAgent, cleanProfile, defaultProfile,
} from '../plan-cleaner';

describe('textArray', () => {
  it('converts string to array', () => expect(textArray('hello')).toEqual(['hello']));
  it('filters empty strings', () => expect(textArray(['a', '', 'b'])).toEqual(['a', 'b']));
  it('limits length', () => expect(textArray(['a', 'b', 'c'], 2).length).toBe(2));
  it('returns empty for non-array non-string', () => expect(textArray(42)).toEqual([]));
});

describe('normalizeTaskKind', () => {
  it('accepts valid kinds', () => {
    expect(normalizeTaskKind('fixed')).toBe('fixed');
    expect(normalizeTaskKind('deadline')).toBe('deadline');
    expect(normalizeTaskKind('spark')).toBe('spark');
  });
  it('falls back to general', () => expect(normalizeTaskKind('invalid')).toBe('general'));
});

describe('cleanBlock', () => {
  it('creates block with defaults', () => {
    const block = cleanBlock({});
    expect(block.title).toBe('未命名');
    expect(block.category).toBe('deep');
    expect(block.status).toBe('planned');
    expect(block.start).toBeGreaterThanOrEqual(0);
    expect(block.end).toBeGreaterThan(block.start);
    expect(block.repeat.frequency).toBe('none');
  });

  it('preserves valid values', () => {
    const block = cleanBlock({
      title: 'Meeting',
      start: 600,
      end: 660,
      category: 'admin',
      kind: 'fixed',
      status: 'done',
    });
    expect(block.title).toBe('Meeting');
    expect(block.start).toBe(600);
    expect(block.end).toBe(660);
    expect(block.category).toBe('admin');
    expect(block.kind).toBe('fixed');
    expect(block.status).toBe('done');
  });

  it('enforces minimum duration', () => {
    const block = cleanBlock({ start: 600, end: 601 });
    expect(block.end - block.start).toBeGreaterThanOrEqual(5);
  });
});

describe('cleanWorkload', () => {
  it('cleans workload', () => {
    const w = cleanWorkload({ minimumHours: 5, realisticHours: 8 });
    expect(w.minimumHours).toBe(5);
    expect(w.realisticHours).toBe(8);
    expect(w.strongHours).toBe(0);
    expect(w.confidence).toBe('low');
  });
});

describe('cleanGoal', () => {
  it('creates goal with defaults', () => {
    const goal = cleanGoal({});
    expect(goal.title).toBe('未命名目标');
    expect(goal.status).toBe('active');
    expect(goal.priority).toBe('P2');
  });

  it('preserves provided values', () => {
    const goal = cleanGoal({ title: 'IELTS 7', status: 'done', priority: 'P1' });
    expect(goal.title).toBe('IELTS 7');
    expect(goal.status).toBe('done');
    expect(goal.priority).toBe('P1');
  });
});

describe('cleanReflection', () => {
  it('cleans reflection', () => {
    const r = cleanReflection({ text: 'Good day' });
    expect(r.text).toBe('Good day');
    expect(r.messages).toEqual([]);
    expect(r.id).toBeTruthy();
  });
});

describe('cleanAgent', () => {
  it('creates agent with defaults', () => {
    const a = cleanAgent({});
    expect(a.label).toBe('新 Agent');
    expect(a.key).toBeTruthy();
  });
  it('preserves values', () => {
    const a = cleanAgent({ label: 'Planner', model: 'claude-opus', job: 'plan things' });
    expect(a.label).toBe('Planner');
    expect(a.model).toBe('claude-opus');
    expect(a.job).toBe('plan things');
  });
});

describe('defaultProfile', () => {
  it('returns valid profile', () => {
    const p = defaultProfile();
    expect(p.name).toBe('Henry');
    expect(p.weeklyCapacityHours).toBe(10);
    expect(p.planningStyle).toBe('hybrid');
  });
});

describe('cleanProfile', () => {
  it('cleans with defaults', () => {
    const p = cleanProfile({});
    expect(p.name).toBe('Henry');
    expect(p.planningStyle).toBe('hybrid');
  });

  it('overrides with valid values', () => {
    const p = cleanProfile({ name: 'Alice', planningStyle: 'strict', weeklyCapacityHours: 20 });
    expect(p.name).toBe('Alice');
    expect(p.planningStyle).toBe('strict');
    expect(p.weeklyCapacityHours).toBe(20);
  });

  it('clamps capacity hours', () => {
    expect(cleanProfile({ weeklyCapacityHours: 100 }).weeklyCapacityHours).toBe(80);
    expect(cleanProfile({ weeklyCapacityHours: 0 }).weeklyCapacityHours).toBe(10);
  });
});
