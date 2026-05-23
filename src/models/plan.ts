export interface EnergyPattern {
  highFocusTime: string;
  lowEnergyTime: string;
  bestCreativeTime: string;
  bestAdminTime: string;
}

export interface Profile {
  name: string;
  timezone: string;
  currentLifeStage: string;
  roles: string[];
  fixedCommitments: string;
  sleepWindow: string;
  mealRoutines: string;
  commuteConstraints: string;
  energyPattern: EnergyPattern;
  healthRecoveryConstraints: string;
  planningStyle: 'strict' | 'flexible' | 'hybrid';
  defaultBlockLength: string;
  motivationPattern: string;
  commonFailureModes: string[];
  weeklyCapacityHours: number;
  preferredReviewCadence: string;
}

export interface Habits {
  wake: string;
  sleep: string;
  deepWorkStart: string;
}

export interface Repeat {
  frequency: 'none' | 'daily' | 'weekly' | 'monthly';
  interval: number;
  until: string;
  count: number;
}

export type Category =
  | 'deep' | 'study' | 'workout' | 'admin'
  | 'life' | 'reflection' | 'recovery' | 'reward' | 'rest';

export type TaskKind = 'fixed' | 'deadline' | 'spark' | 'routine' | 'general';

export type BlockStatus = 'planned' | 'done' | 'missed';

export interface Block {
  id: string;
  title: string;
  date: string;
  day: number;
  start: number;
  end: number;
  category: Category;
  kind: TaskKind;
  repeat: Repeat;
  goalId: string;
  source: string;
  status: BlockStatus;
  note: string;
  exactAction: string;
  output: string;
  ifInterrupted: string;
  ifFinishedEarly: string;
}

export interface BlockOccurrence extends Block {
  occurrenceDate: string;
  occurrenceAnchorDate: string;
  recurringOccurrence: boolean;
}

export interface Workload {
  minimumHours: number;
  realisticHours: number;
  strongHours: number;
  confidence: string;
}

export interface Goal {
  id: string;
  title: string;
  type: string;
  desiredOutcome: string;
  deadline: string;
  successCriteria: string;
  currentBaseline: string;
  gap: string;
  requiredDeliverables: string[];
  requiredSkills: string[];
  estimatedWorkload: Workload;
  confidence: string;
  risks: string[];
  dependencies: string[];
  reviewCheckpoints: string[];
  priority: string;
  consequenceIfDelayed: string;
  weeklyTarget: string;
  dailyMinimum: string;
  status: 'active' | 'done' | 'paused';
  target: Record<string, unknown>;
  createdAt: string;
  notes: string;
}

export interface Reflection {
  id: string;
  at: string;
  text: string;
  messages: string[];
}

export interface Agent {
  key: string;
  label: string;
  model: string;
  configName: string;
  modelId: string;
  job: string;
}

export interface Plan {
  version: number;
  weekStart: string;
  profile: Profile;
  habits: Habits;
  goals: Goal[];
  blocks: Block[];
  reflections: Reflection[];
  memories: unknown[];
  archives: unknown[];
  agents: Agent[];
  workflowPrompts: Record<string, unknown>;
}
