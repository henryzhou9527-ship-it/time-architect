import type { Block, Goal, Reflection, Profile, Workload, Agent, Plan, Category, Repeat } from '../models/plan';
import { CATEGORIES, DAY_MINUTES, MIN_BLOCK_MINUTES, TASK_KINDS } from './constants';
import { cleanDate, weekdayForDate, clampMinute, weekStart, formatDate } from './date-utils';
import { cleanRepeat } from './repeat-engine';

let idCounter = 0;
export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}

export function textArray(value: unknown, limit = 12, itemLimit = 120): string[] {
  if (!Array.isArray(value)) {
    if (typeof value === 'string' && value.trim()) return [value.trim().slice(0, itemLimit)];
    return [];
  }
  return value
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .slice(0, limit)
    .map(item => item.slice(0, itemLimit));
}

export function normalizeTaskKind(kind: unknown, fallback = 'general'): string {
  const raw = String(kind || '').trim();
  if (TASK_KINDS[raw as keyof typeof TASK_KINDS]) return raw;
  return TASK_KINDS[fallback as keyof typeof TASK_KINDS] ? fallback : 'general';
}

export function cleanBlock(raw: Record<string, unknown> | null | undefined): Block {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const date = cleanDate(r.date || r.startDate);
  const day = date
    ? weekdayForDate(date as string, r.day as number)
    : Math.max(0, Math.min(6, Number(r.day) || 0));
  const start = Math.max(0, Math.min(DAY_MINUTES - MIN_BLOCK_MINUTES, clampMinute(r.start, 0)));
  const rawEnd = Number(r.end) || start + 60;
  const end = Math.max(start + MIN_BLOCK_MINUTES, Math.min(DAY_MINUTES, clampMinute(rawEnd, start + 60)));
  const category: Category = CATEGORIES[r.category as Category] ? (r.category as Category) : 'deep';
  const kind = normalizeTaskKind(r.kind || r.taskKind || r.type, 'general');

  return {
    id: String(r.id || generateId('block')),
    title: String(r.title || '未命名').trim().slice(0, 90),
    date,
    day,
    start,
    end,
    category,
    kind: kind as Block['kind'],
    repeat: cleanRepeat(r.repeat || r.recurrence),
    goalId: r.goalId ? String(r.goalId) : '',
    source: String(r.source || 'manual').slice(0, 90),
    status: (['planned', 'done', 'missed'] as const).includes(r.status as Block['status']) ? (r.status as Block['status']) : 'planned',
    note: String(r.note || '').trim().slice(0, 360),
    exactAction: String(r.exactAction || '').trim().slice(0, 420),
    output: String(r.output || '').trim().slice(0, 260),
    ifInterrupted: String(r.ifInterrupted || '').trim().slice(0, 260),
    ifFinishedEarly: String(r.ifFinishedEarly || '').trim().slice(0, 260),
  };
}

export function cleanWorkload(raw: unknown): Workload {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    minimumHours: Math.max(0, Number(source.minimumHours) || 0),
    realisticHours: Math.max(0, Number(source.realisticHours) || 0),
    strongHours: Math.max(0, Number(source.strongHours) || 0),
    confidence: String(source.confidence || 'low').trim().slice(0, 80),
  };
}

export function cleanGoal(raw: Record<string, unknown> | null | undefined): Goal {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const workload = cleanWorkload(r.estimatedWorkload);
  return {
    id: String(r.id || generateId('goal')),
    title: String(r.title || '未命名目标').trim().slice(0, 120),
    type: String(r.type || 'project').trim().slice(0, 40),
    desiredOutcome: String(r.desiredOutcome || r.title || '').trim().slice(0, 240),
    deadline: String(r.deadline || '').trim().slice(0, 20),
    successCriteria: String(r.successCriteria || '').trim().slice(0, 300),
    currentBaseline: String(r.currentBaseline || '').trim().slice(0, 240),
    gap: String(r.gap || '').trim().slice(0, 240),
    requiredDeliverables: textArray(r.requiredDeliverables, 16, 140),
    requiredSkills: textArray(r.requiredSkills, 12, 90),
    estimatedWorkload: workload,
    confidence: String(r.confidence || workload.confidence || 'low').trim().slice(0, 80),
    risks: textArray(r.risks, 12, 140),
    dependencies: textArray(r.dependencies, 12, 120),
    reviewCheckpoints: textArray(r.reviewCheckpoints, 12, 120),
    priority: String(r.priority || 'P2').trim().slice(0, 20),
    consequenceIfDelayed: String(r.consequenceIfDelayed || '').trim().slice(0, 220),
    weeklyTarget: String(r.weeklyTarget || '').trim().slice(0, 180),
    dailyMinimum: String(r.dailyMinimum || '').trim().slice(0, 180),
    status: (['active', 'done', 'paused'] as const).includes(r.status as Goal['status']) ? (r.status as Goal['status']) : 'active',
    target: r.target && typeof r.target === 'object' ? (r.target as Record<string, unknown>) : {},
    createdAt: String(r.createdAt || new Date().toISOString()),
    notes: String(r.notes || '').trim().slice(0, 600),
  };
}

export function cleanReflection(raw: Record<string, unknown> | null | undefined): Reflection {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    id: String(r.id || generateId('reflection')),
    at: String(r.at || new Date().toISOString()),
    text: String(r.text || '').trim().slice(0, 1500),
    messages: Array.isArray(r.messages)
      ? (r.messages as unknown[]).map(item => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [],
  };
}

export function cleanAgent(raw: unknown): Agent {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    key: String(source.key || generateId('agent')).slice(0, 40),
    label: String(source.label || '新 Agent').trim().slice(0, 40),
    model: String(source.model || '').trim().slice(0, 60),
    configName: String(source.configName || source.label || 'New Agent').trim().slice(0, 60),
    modelId: String(source.modelId || '').trim().slice(0, 120),
    job: String(source.job || '').trim().slice(0, 200),
  };
}

export function defaultProfile(): Profile {
  const timezone = typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    : 'Asia/Shanghai';
  return {
    name: 'Henry',
    timezone,
    currentLifeStage: '',
    roles: [],
    fixedCommitments: '',
    sleepWindow: '23:30-08:00',
    mealRoutines: '',
    commuteConstraints: '',
    energyPattern: {
      highFocusTime: '上午或晚间待校准',
      lowEnergyTime: '待校准',
      bestCreativeTime: '',
      bestAdminTime: '晚上',
    },
    healthRecoveryConstraints: '',
    planningStyle: 'hybrid',
    defaultBlockLength: 'variable',
    motivationPattern: '',
    commonFailureModes: ['underestimating workload', 'late-night drift'],
    weeklyCapacityHours: 10,
    preferredReviewCadence: 'daily + weekly',
  };
}

export function cleanProfile(raw: unknown): Profile {
  const base = defaultProfile();
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const energy = (source.energyPattern && typeof source.energyPattern === 'object'
    ? source.energyPattern : {}) as Record<string, unknown>;
  return {
    name: String(source.name || base.name).trim().slice(0, 80),
    timezone: String(source.timezone || base.timezone).trim().slice(0, 80),
    currentLifeStage: String(source.currentLifeStage || '').trim().slice(0, 140),
    roles: textArray(source.roles, 8, 60),
    fixedCommitments: String(source.fixedCommitments || '').trim().slice(0, 800),
    sleepWindow: String(source.sleepWindow || base.sleepWindow).trim().slice(0, 40),
    mealRoutines: String(source.mealRoutines || '').trim().slice(0, 300),
    commuteConstraints: String(source.commuteConstraints || '').trim().slice(0, 300),
    energyPattern: {
      highFocusTime: String(energy.highFocusTime || base.energyPattern.highFocusTime).trim().slice(0, 120),
      lowEnergyTime: String(energy.lowEnergyTime || base.energyPattern.lowEnergyTime).trim().slice(0, 120),
      bestCreativeTime: String(energy.bestCreativeTime || '').trim().slice(0, 120),
      bestAdminTime: String(energy.bestAdminTime || base.energyPattern.bestAdminTime).trim().slice(0, 120),
    },
    healthRecoveryConstraints: String(source.healthRecoveryConstraints || '').trim().slice(0, 500),
    planningStyle: (['strict', 'flexible', 'hybrid'] as const).includes(source.planningStyle as Profile['planningStyle'])
      ? (source.planningStyle as Profile['planningStyle'])
      : base.planningStyle,
    defaultBlockLength: String(source.defaultBlockLength || base.defaultBlockLength).trim().slice(0, 40),
    motivationPattern: String(source.motivationPattern || '').trim().slice(0, 400),
    commonFailureModes: textArray(source.commonFailureModes || base.commonFailureModes, 12, 80),
    weeklyCapacityHours: Math.max(1, Math.min(80, Number(source.weeklyCapacityHours) || base.weeklyCapacityHours)),
    preferredReviewCadence: String(source.preferredReviewCadence || base.preferredReviewCadence).trim().slice(0, 80),
  };
}
