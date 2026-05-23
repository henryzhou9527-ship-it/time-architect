export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

const repeatSchema = {
  type: 'object',
  properties: {
    frequency: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
    interval: { type: 'integer', minimum: 1, maximum: 30, default: 1 },
    until: { type: 'string', pattern: '^(\\d{4}-\\d{2}-\\d{2})?$' },
    count: { type: 'integer', minimum: 0, maximum: 366 },
  },
  additionalProperties: false,
} as const;

const categoryEnum = ['deep', 'study', 'workout', 'admin', 'life', 'reflection', 'recovery', 'reward', 'rest'];
const kindEnum = ['fixed', 'deadline', 'spark', 'routine', 'general'];

export const CREATE_EVENT: ToolDefinition = {
  name: 'create_event',
  description: '在日历上创建新的时间块。date 使用 YYYY-MM-DD 格式，start/end 是 0-1440 的分钟数（如 600 = 10:00）。repeat.frequency 默认 none，只有用户明确说了"每天/每周/每月/daily/weekly/monthly"才设为对应值。',
  input_schema: {
    type: 'object',
    required: ['title', 'start', 'end'],
    properties: {
      title: { type: 'string', maxLength: 90 },
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      day: { type: 'integer', minimum: 0, maximum: 6 },
      start: { type: 'integer', minimum: 0, maximum: 1435 },
      end: { type: 'integer', minimum: 5, maximum: 1440 },
      category: { type: 'string', enum: categoryEnum, default: 'deep' },
      kind: { type: 'string', enum: kindEnum, default: 'general' },
      repeat: repeatSchema,
      goalId: { type: 'string' },
      note: { type: 'string', maxLength: 360 },
      exactAction: { type: 'string', maxLength: 420 },
      output: { type: 'string', maxLength: 260 },
      ifInterrupted: { type: 'string', maxLength: 260 },
      ifFinishedEarly: { type: 'string', maxLength: 260 },
    },
    additionalProperties: false,
  },
};

export const UPDATE_EVENT: ToolDefinition = {
  name: 'update_event',
  description: '修改已有时间块的字段。只传需要修改的字段，未传的字段保持不变。targetId 为要修改的 block.id。',
  input_schema: {
    type: 'object',
    required: ['targetId'],
    properties: {
      targetId: { type: 'string' },
      title: { type: 'string', maxLength: 90 },
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      day: { type: 'integer', minimum: 0, maximum: 6 },
      start: { type: 'integer', minimum: 0, maximum: 1435 },
      end: { type: 'integer', minimum: 5, maximum: 1440 },
      category: { type: 'string', enum: categoryEnum },
      kind: { type: 'string', enum: kindEnum },
      repeat: repeatSchema,
      status: { type: 'string', enum: ['planned', 'done', 'missed'] },
      note: { type: 'string', maxLength: 360 },
      exactAction: { type: 'string', maxLength: 420 },
      output: { type: 'string', maxLength: 260 },
    },
    additionalProperties: false,
  },
};

export const DELETE_EVENT: ToolDefinition = {
  name: 'delete_event',
  description: '删除一个时间块。targetId 为要删除的 block.id。',
  input_schema: {
    type: 'object',
    required: ['targetId'],
    properties: {
      targetId: { type: 'string' },
      reason: { type: 'string', maxLength: 200 },
    },
    additionalProperties: false,
  },
};

export const MOVE_EVENT: ToolDefinition = {
  name: 'move_event',
  description: '将已有时间块移动到新的日期/时间。',
  input_schema: {
    type: 'object',
    required: ['targetId', 'start', 'end'],
    properties: {
      targetId: { type: 'string' },
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      day: { type: 'integer', minimum: 0, maximum: 6 },
      start: { type: 'integer', minimum: 0, maximum: 1435 },
      end: { type: 'integer', minimum: 5, maximum: 1440 },
    },
    additionalProperties: false,
  },
};

export const RESIZE_EVENT: ToolDefinition = {
  name: 'resize_event',
  description: '改变时间块的时长（调整 end 时间）。',
  input_schema: {
    type: 'object',
    required: ['targetId', 'end'],
    properties: {
      targetId: { type: 'string' },
      start: { type: 'integer', minimum: 0, maximum: 1435 },
      end: { type: 'integer', minimum: 5, maximum: 1440 },
    },
    additionalProperties: false,
  },
};

export const CREATE_GOAL: ToolDefinition = {
  name: 'create_goal',
  description: '创建新的目标合约，包含截止日期、成功标准、工作量估计等。',
  input_schema: {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string', maxLength: 120 },
      type: { type: 'string', maxLength: 40 },
      desiredOutcome: { type: 'string', maxLength: 240 },
      deadline: { type: 'string', maxLength: 20 },
      successCriteria: { type: 'string', maxLength: 300 },
      currentBaseline: { type: 'string', maxLength: 240 },
      gap: { type: 'string', maxLength: 240 },
      requiredDeliverables: { type: 'array', items: { type: 'string', maxLength: 140 }, maxItems: 16 },
      requiredSkills: { type: 'array', items: { type: 'string', maxLength: 90 }, maxItems: 12 },
      estimatedWorkload: {
        type: 'object',
        properties: {
          minimumHours: { type: 'number', minimum: 0 },
          realisticHours: { type: 'number', minimum: 0 },
          strongHours: { type: 'number', minimum: 0 },
          confidence: { type: 'string' },
        },
        additionalProperties: false,
      },
      risks: { type: 'array', items: { type: 'string', maxLength: 140 }, maxItems: 12 },
      dependencies: { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 12 },
      priority: { type: 'string', maxLength: 20 },
      consequenceIfDelayed: { type: 'string', maxLength: 220 },
      weeklyTarget: { type: 'string', maxLength: 180 },
      dailyMinimum: { type: 'string', maxLength: 180 },
    },
    additionalProperties: false,
  },
};

export const UPDATE_PROFILE: ToolDefinition = {
  name: 'update_profile',
  description: '更新用户画像信息。只传需要修改的字段。',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', maxLength: 80 },
      timezone: { type: 'string', maxLength: 80 },
      currentLifeStage: { type: 'string', maxLength: 140 },
      roles: { type: 'array', items: { type: 'string', maxLength: 60 }, maxItems: 8 },
      fixedCommitments: { type: 'string', maxLength: 800 },
      sleepWindow: { type: 'string', maxLength: 40 },
      mealRoutines: { type: 'string', maxLength: 300 },
      commuteConstraints: { type: 'string', maxLength: 300 },
      energyPattern: {
        type: 'object',
        properties: {
          highFocusTime: { type: 'string', maxLength: 120 },
          lowEnergyTime: { type: 'string', maxLength: 120 },
          bestCreativeTime: { type: 'string', maxLength: 120 },
          bestAdminTime: { type: 'string', maxLength: 120 },
        },
        additionalProperties: false,
      },
      healthRecoveryConstraints: { type: 'string', maxLength: 500 },
      planningStyle: { type: 'string', enum: ['strict', 'flexible', 'hybrid'] },
      weeklyCapacityHours: { type: 'number', minimum: 1, maximum: 80 },
      motivationPattern: { type: 'string', maxLength: 400 },
      commonFailureModes: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 12 },
    },
    additionalProperties: false,
  },
};

export const RESPOND_TEXT: ToolDefinition = {
  name: 'respond_text',
  description: '纯文字回复用户，不修改日历或目标。用于对话、建议、解释等。',
  input_schema: {
    type: 'object',
    required: ['text'],
    properties: {
      text: { type: 'string', maxLength: 4000 },
    },
    additionalProperties: false,
  },
};

export const PROPOSE_MEMORY: ToolDefinition = {
  name: 'propose_memory',
  description: '提议保存一条长期记忆（用户偏好、习惯等），需要用户确认。',
  input_schema: {
    type: 'object',
    required: ['key', 'content'],
    properties: {
      key: { type: 'string', maxLength: 60 },
      content: { type: 'string', maxLength: 500 },
      reason: { type: 'string', maxLength: 200 },
    },
    additionalProperties: false,
  },
};

export const ALL_TOOLS: ToolDefinition[] = [
  CREATE_EVENT, UPDATE_EVENT, DELETE_EVENT,
  MOVE_EVENT, RESIZE_EVENT, CREATE_GOAL,
  UPDATE_PROFILE, RESPOND_TEXT, PROPOSE_MEMORY,
];

export type AgentRole = 'planner' | 'engineer' | 'dialogue' | 'auditor';

const AGENT_TOOLS: Record<AgentRole, string[]> = {
  planner: ['create_event', 'update_event', 'delete_event', 'move_event', 'create_goal', 'update_profile', 'respond_text', 'propose_memory'],
  engineer: ['create_event', 'update_event', 'delete_event', 'move_event', 'resize_event', 'respond_text'],
  dialogue: ['respond_text'],
  auditor: ['respond_text'],
};

export function toolsForAgent(role: AgentRole): ToolDefinition[] {
  const allowed = AGENT_TOOLS[role] || AGENT_TOOLS.dialogue;
  return ALL_TOOLS.filter(t => allowed.includes(t.name));
}
