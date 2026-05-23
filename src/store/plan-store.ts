import { signal, computed, effect } from '@preact/signals';
import type { Plan, Block, Goal, Profile } from '../models/plan';
import { cleanBlock, cleanGoal, cleanProfile, defaultProfile } from '../engine/plan-cleaner';
import { weekStart, formatDate, datePlus } from '../engine/date-utils';
import { blocksForDay } from '../engine/repeat-engine';

const STORAGE_KEY = 'calendarPlan';

function defaultPlan(): Plan {
  return {
    version: 1,
    weekStart: weekStart(new Date()),
    profile: defaultProfile(),
    habits: { wake: '08:00', sleep: '23:30', deepWorkStart: '09:00' },
    goals: [],
    blocks: [],
    reflections: [],
    memories: [],
    archives: [],
    agents: [],
    workflowPrompts: {},
  };
}

function loadFromStorage(): Plan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const source = parsed as Record<string, unknown>;
        return {
          version: Number(source.version) || 1,
          weekStart: String(source.weekStart || weekStart(new Date())),
          profile: cleanProfile(source.profile),
          habits: {
            wake: String((source.habits as any)?.wake || '08:00'),
            sleep: String((source.habits as any)?.sleep || '23:30'),
            deepWorkStart: String((source.habits as any)?.deepWorkStart || '09:00'),
          },
          goals: Array.isArray(source.goals) ? (source.goals as any[]).map(g => cleanGoal(g)) : [],
          blocks: Array.isArray(source.blocks) ? (source.blocks as any[]).map(b => cleanBlock(b)) : [],
          reflections: Array.isArray(source.reflections) ? source.reflections as any[] : [],
          memories: Array.isArray(source.memories) ? source.memories as any[] : [],
          archives: Array.isArray(source.archives) ? source.archives as any[] : [],
          agents: Array.isArray(source.agents) ? source.agents as any[] : [],
          workflowPrompts: (source.workflowPrompts && typeof source.workflowPrompts === 'object') ? source.workflowPrompts as Record<string, unknown> : {},
        };
      }
    }
  } catch { /* corrupted storage, use default */ }
  return defaultPlan();
}

function saveToStorage(p: Plan) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch { /* storage full or unavailable */ }
}

export const plan = signal<Plan>(loadFromStorage());
export const syncStatus = signal('');
export const cloudSyncBlocked = signal(false);
export const previewDraft = signal(false);
export const draftPlan = signal<Plan | null>(null);

effect(() => {
  saveToStorage(plan.value);
});

export const activePlan = computed(() => previewDraft.value && draftPlan.value ? draftPlan.value : plan.value);
export const blocks = computed(() => activePlan.value.blocks);
export const goals = computed(() => activePlan.value.goals);
export const profile = computed(() => activePlan.value.profile);

export function blocksForDayIndex(dayIndex: number) {
  return blocksForDay(activePlan.value.blocks, dayIndex, activePlan.value.weekStart);
}

export function loadPlan(raw: unknown) {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const p: Plan = {
    version: Number(source.version) || 1,
    weekStart: String(source.weekStart || weekStart(new Date())),
    profile: cleanProfile(source.profile),
    habits: {
      wake: String((source.habits as any)?.wake || '08:00'),
      sleep: String((source.habits as any)?.sleep || '23:30'),
      deepWorkStart: String((source.habits as any)?.deepWorkStart || '09:00'),
    },
    goals: Array.isArray(source.goals) ? (source.goals as any[]).map(g => cleanGoal(g)) : [],
    blocks: Array.isArray(source.blocks) ? (source.blocks as any[]).map(b => cleanBlock(b)) : [],
    reflections: Array.isArray(source.reflections) ? source.reflections as any[] : [],
    memories: Array.isArray(source.memories) ? source.memories as any[] : [],
    archives: Array.isArray(source.archives) ? source.archives as any[] : [],
    agents: Array.isArray(source.agents) ? source.agents as any[] : [],
    workflowPrompts: (source.workflowPrompts && typeof source.workflowPrompts === 'object') ? source.workflowPrompts as Record<string, unknown> : {},
  };
  plan.value = p;
}

export function updatePlan(updater: (p: Plan) => Plan) {
  plan.value = updater(JSON.parse(JSON.stringify(plan.value)));
}

export function applyDraft() {
  if (draftPlan.value) {
    plan.value = draftPlan.value;
    draftPlan.value = null;
    previewDraft.value = false;
  }
}

export function discardDraft() {
  draftPlan.value = null;
  previewDraft.value = false;
}

export function setDraft(draft: Plan) {
  draftPlan.value = draft;
  previewDraft.value = true;
}

export function addBlock(blockData: Record<string, unknown>) {
  const block = cleanBlock(blockData);
  updatePlan(p => {
    p.blocks.push(block);
    return p;
  });
  return block;
}

export function removeBlock(blockId: string) {
  updatePlan(p => {
    p.blocks = p.blocks.filter(b => b.id !== blockId);
    return p;
  });
}

export function updateBlock(blockId: string, updates: Partial<Block>) {
  updatePlan(p => {
    const idx = p.blocks.findIndex(b => b.id === blockId);
    if (idx !== -1) {
      p.blocks[idx] = cleanBlock({ ...p.blocks[idx], ...updates });
      p.blocks[idx].id = blockId;
    }
    return p;
  });
}

export function addGoal(goalData: Record<string, unknown>) {
  const goal = cleanGoal(goalData);
  updatePlan(p => {
    p.goals.push(goal);
    return p;
  });
  return goal;
}

export function updateProfile(updates: Partial<Profile>) {
  updatePlan(p => {
    p.profile = cleanProfile({ ...p.profile, ...updates });
    return p;
  });
}

export function navigateWeek(delta: number) {
  updatePlan(p => {
    p.weekStart = datePlus(p.weekStart, delta * 7);
    return p;
  });
}

export function goToCurrentWeek() {
  updatePlan(p => {
    p.weekStart = weekStart(new Date());
    return p;
  });
}
