import type { Block, Plan } from '../models/plan';
import type {
  ToolCall, ToolCallResult, ValidatedToolCall, RejectedToolCall,
  CreateEventArgs, UpdateEventArgs, DeleteEventArgs,
  MoveEventArgs, ResizeEventArgs,
} from '../models/tools';
import { MIN_BLOCK_MINUTES, DAY_MINUTES, CATEGORIES, TASK_KINDS } from '../engine/constants';
import { cleanDate } from '../engine/date-utils';
import { detectRepeatIntent } from '../engine/repeat-engine';
import type { AgentRole } from './schema';

const AGENT_ALLOWED: Record<AgentRole, Set<string>> = {
  planner: new Set(['create_event', 'update_event', 'delete_event', 'move_event', 'create_goal', 'update_profile', 'respond_text', 'propose_memory']),
  engineer: new Set(['create_event', 'update_event', 'delete_event', 'move_event', 'resize_event', 'respond_text']),
  dialogue: new Set(['respond_text']),
  auditor: new Set(['respond_text']),
};

function reject(name: string, args: Record<string, unknown>, error: string): RejectedToolCall {
  return { name, args, valid: false, error };
}

function accept(call: ToolCall): ValidatedToolCall {
  return { ...call, valid: true };
}

function validateTimeRange(start: number | undefined, end: number | undefined, label = ''): string | null {
  if (start !== undefined && (start < 0 || start > DAY_MINUTES - MIN_BLOCK_MINUTES)) {
    return `${label}start must be 0-${DAY_MINUTES - MIN_BLOCK_MINUTES}`;
  }
  if (end !== undefined && (end < MIN_BLOCK_MINUTES || end > DAY_MINUTES)) {
    return `${label}end must be ${MIN_BLOCK_MINUTES}-${DAY_MINUTES}`;
  }
  if (start !== undefined && end !== undefined && end - start < MIN_BLOCK_MINUTES) {
    return `${label}duration must be >= ${MIN_BLOCK_MINUTES} minutes`;
  }
  return null;
}

function validateDate(date: string | undefined): string | null {
  if (date !== undefined && !cleanDate(date)) return `invalid date format: ${date}, expected YYYY-MM-DD`;
  return null;
}

function applyRecurrenceGuard(args: CreateEventArgs, userInput?: string): CreateEventArgs {
  if (!args.repeat || args.repeat.frequency === 'none') return args;
  if (userInput) {
    const intent = detectRepeatIntent(userInput);
    if (intent.defaultedToNone && !intent.recurrenceExplicit) {
      return { ...args, repeat: { ...args.repeat, frequency: 'none' } };
    }
  }
  return args;
}

function validateCreateEvent(args: Record<string, unknown>, blocks: Block[], userInput?: string): ToolCallResult {
  const a = args as unknown as CreateEventArgs;
  if (!a.title || typeof a.title !== 'string') return reject('create_event', args, 'title is required');

  const timeErr = validateTimeRange(a.start, a.end);
  if (timeErr) return reject('create_event', args, timeErr);

  const dateErr = validateDate(a.date);
  if (dateErr) return reject('create_event', args, dateErr);

  if (a.category && !CATEGORIES[a.category as keyof typeof CATEGORIES]) {
    return reject('create_event', args, `invalid category: ${a.category}`);
  }
  if (a.kind && !TASK_KINDS[a.kind as keyof typeof TASK_KINDS]) {
    return reject('create_event', args, `invalid kind: ${a.kind}`);
  }

  const guarded = applyRecurrenceGuard(a, userInput);
  return accept({ name: 'create_event', args: guarded });
}

function validateUpdateEvent(args: Record<string, unknown>, blocks: Block[]): ToolCallResult {
  const a = args as unknown as UpdateEventArgs;
  if (!a.targetId) return reject('update_event', args, 'targetId is required');
  if (!blocks.some(b => b.id === a.targetId)) {
    return reject('update_event', args, `block not found: ${a.targetId}`);
  }

  const timeErr = validateTimeRange(a.start, a.end);
  if (timeErr) return reject('update_event', args, timeErr);

  const dateErr = validateDate(a.date);
  if (dateErr) return reject('update_event', args, dateErr);

  return accept({ name: 'update_event', args: a });
}

function validateDeleteEvent(args: Record<string, unknown>, blocks: Block[]): ToolCallResult {
  const a = args as unknown as DeleteEventArgs;
  if (!a.targetId) return reject('delete_event', args, 'targetId is required');
  if (!blocks.some(b => b.id === a.targetId)) {
    return reject('delete_event', args, `block not found: ${a.targetId}`);
  }
  return accept({ name: 'delete_event', args: a });
}

function validateMoveEvent(args: Record<string, unknown>, blocks: Block[]): ToolCallResult {
  const a = args as unknown as MoveEventArgs;
  if (!a.targetId) return reject('move_event', args, 'targetId is required');
  if (!blocks.some(b => b.id === a.targetId)) {
    return reject('move_event', args, `block not found: ${a.targetId}`);
  }

  const timeErr = validateTimeRange(a.start, a.end);
  if (timeErr) return reject('move_event', args, timeErr);

  const dateErr = validateDate(a.date);
  if (dateErr) return reject('move_event', args, dateErr);

  return accept({ name: 'move_event', args: a });
}

function validateResizeEvent(args: Record<string, unknown>, blocks: Block[]): ToolCallResult {
  const a = args as unknown as ResizeEventArgs;
  if (!a.targetId) return reject('resize_event', args, 'targetId is required');
  const block = blocks.find(b => b.id === a.targetId);
  if (!block) return reject('resize_event', args, `block not found: ${a.targetId}`);

  const start = a.start ?? block.start;
  const timeErr = validateTimeRange(start, a.end);
  if (timeErr) return reject('resize_event', args, timeErr);

  return accept({ name: 'resize_event', args: a });
}

function validateCreateGoal(args: Record<string, unknown>): ToolCallResult {
  if (!args.title || typeof args.title !== 'string') return reject('create_goal', args, 'title is required');
  return accept({ name: 'create_goal', args: args as any });
}

function validateUpdateProfile(args: Record<string, unknown>): ToolCallResult {
  if (Object.keys(args).length === 0) return reject('update_profile', args, 'at least one field is required');
  return accept({ name: 'update_profile', args: args as any });
}

function validateRespondText(args: Record<string, unknown>): ToolCallResult {
  if (!args.text || typeof args.text !== 'string') return reject('respond_text', args, 'text is required');
  return accept({ name: 'respond_text', args: args as any });
}

function validateProposeMemory(args: Record<string, unknown>): ToolCallResult {
  if (!args.key || !args.content) return reject('propose_memory', args, 'key and content are required');
  return accept({ name: 'propose_memory', args: args as any });
}

export function validateToolCall(
  call: { name: string; args: Record<string, unknown> },
  plan: Pick<Plan, 'blocks'>,
  agentRole: AgentRole,
  userInput?: string,
): ToolCallResult {
  const allowed = AGENT_ALLOWED[agentRole];
  if (!allowed?.has(call.name)) {
    return reject(call.name, call.args, `${agentRole} agent cannot use tool: ${call.name}`);
  }

  switch (call.name) {
    case 'create_event': return validateCreateEvent(call.args, plan.blocks, userInput);
    case 'update_event': return validateUpdateEvent(call.args, plan.blocks);
    case 'delete_event': return validateDeleteEvent(call.args, plan.blocks);
    case 'move_event': return validateMoveEvent(call.args, plan.blocks);
    case 'resize_event': return validateResizeEvent(call.args, plan.blocks);
    case 'create_goal': return validateCreateGoal(call.args);
    case 'update_profile': return validateUpdateProfile(call.args);
    case 'respond_text': return validateRespondText(call.args);
    case 'propose_memory': return validateProposeMemory(call.args);
    default: return reject(call.name, call.args, `unknown tool: ${call.name}`);
  }
}

export function validateToolCalls(
  calls: { name: string; args: Record<string, unknown> }[],
  plan: Pick<Plan, 'blocks'>,
  agentRole: AgentRole,
  userInput?: string,
): ToolCallResult[] {
  return calls.map(call => validateToolCall(call, plan, agentRole, userInput));
}
