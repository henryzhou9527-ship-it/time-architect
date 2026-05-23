import type { Category, TaskKind, BlockStatus } from './plan';

export interface CreateEventArgs {
  title: string;
  date?: string;
  day?: number;
  start: number;
  end: number;
  category?: Category;
  kind?: TaskKind;
  repeat?: { frequency?: 'none' | 'daily' | 'weekly' | 'monthly'; interval?: number; until?: string; count?: number };
  goalId?: string;
  note?: string;
  exactAction?: string;
  output?: string;
  ifInterrupted?: string;
  ifFinishedEarly?: string;
}

export interface UpdateEventArgs {
  targetId: string;
  title?: string;
  date?: string;
  day?: number;
  start?: number;
  end?: number;
  category?: Category;
  kind?: TaskKind;
  repeat?: { frequency?: 'none' | 'daily' | 'weekly' | 'monthly'; interval?: number; until?: string; count?: number };
  status?: BlockStatus;
  note?: string;
  exactAction?: string;
  output?: string;
}

export interface DeleteEventArgs {
  targetId: string;
  reason?: string;
}

export interface MoveEventArgs {
  targetId: string;
  date?: string;
  day?: number;
  start: number;
  end: number;
}

export interface ResizeEventArgs {
  targetId: string;
  start?: number;
  end: number;
}

export interface CreateGoalArgs {
  title: string;
  type?: string;
  desiredOutcome?: string;
  deadline?: string;
  successCriteria?: string;
  currentBaseline?: string;
  gap?: string;
  requiredDeliverables?: string[];
  requiredSkills?: string[];
  estimatedWorkload?: { minimumHours?: number; realisticHours?: number; strongHours?: number; confidence?: string };
  risks?: string[];
  dependencies?: string[];
  priority?: string;
  consequenceIfDelayed?: string;
  weeklyTarget?: string;
  dailyMinimum?: string;
}

export interface UpdateProfileArgs {
  name?: string;
  timezone?: string;
  currentLifeStage?: string;
  roles?: string[];
  fixedCommitments?: string;
  sleepWindow?: string;
  mealRoutines?: string;
  commuteConstraints?: string;
  energyPattern?: { highFocusTime?: string; lowEnergyTime?: string; bestCreativeTime?: string; bestAdminTime?: string };
  healthRecoveryConstraints?: string;
  planningStyle?: 'strict' | 'flexible' | 'hybrid';
  weeklyCapacityHours?: number;
  motivationPattern?: string;
  commonFailureModes?: string[];
}

export interface RespondTextArgs {
  text: string;
}

export interface ProposeMemoryArgs {
  key: string;
  content: string;
  reason?: string;
}

export type ToolName =
  | 'create_event' | 'update_event' | 'delete_event'
  | 'move_event' | 'resize_event' | 'create_goal'
  | 'update_profile' | 'respond_text' | 'propose_memory';

export interface ToolCall {
  name: ToolName;
  args: CreateEventArgs | UpdateEventArgs | DeleteEventArgs | MoveEventArgs
    | ResizeEventArgs | CreateGoalArgs | UpdateProfileArgs | RespondTextArgs | ProposeMemoryArgs;
}

export interface ValidatedToolCall extends ToolCall {
  valid: true;
}

export interface RejectedToolCall {
  name: string;
  args: Record<string, unknown>;
  valid: false;
  error: string;
}

export type ToolCallResult = ValidatedToolCall | RejectedToolCall;
