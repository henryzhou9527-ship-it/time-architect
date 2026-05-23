import type { Category, TaskKind } from '../models/plan';

export const SLOT_MINUTES = 15;
export const INPUT_STEP_MINUTES = 5;
export const MIN_BLOCK_MINUTES = 5;
export const DAY_MINUTES = 24 * 60;

export const CATEGORIES: Record<Category, { label: string; color: string }> = {
  deep: { label: '深度工作', color: '#34d399' },
  study: { label: '学习', color: '#38bdf8' },
  workout: { label: '运动', color: '#fb923c' },
  admin: { label: '事务', color: '#a78bfa' },
  life: { label: '生活', color: '#fbbf24' },
  reflection: { label: '复盘', color: '#2dd4bf' },
  recovery: { label: '补救', color: '#f87171' },
  reward: { label: '奖励', color: '#f472b6' },
  rest: { label: '休息', color: '#9ca3af' },
};

export const TASK_KINDS: Record<TaskKind, { label: string; description: string }> = {
  fixed: { label: '固定时间', description: '预约、会议、考试等已经有明确时间的事件。' },
  deadline: { label: '截止任务', description: '需要在 deadline 前拆解完成的目标。' },
  spark: { label: '灵感想法', description: '有空时智能塞进 spare time，不强制完成。' },
  routine: { label: '固定习惯', description: '明确要求每天/每周/每月重复的安排。' },
  general: { label: '普通任务', description: '没有特殊约束的一次性时间块。' },
};

export const REPEAT_OPTIONS: Record<string, { label: string }> = {
  none: { label: '不重复' },
  daily: { label: '每天' },
  weekly: { label: '每周' },
  monthly: { label: '每月' },
};
