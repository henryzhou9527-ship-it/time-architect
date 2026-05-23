import type { Plan, Block, Goal } from '../models/plan';
import type {
  ValidatedToolCall, CreateEventArgs, UpdateEventArgs, DeleteEventArgs,
  MoveEventArgs, ResizeEventArgs, CreateGoalArgs, UpdateProfileArgs,
  RespondTextArgs, ProposeMemoryArgs,
} from '../models/tools';
import { cleanBlock, cleanGoal, cleanProfile, generateId } from '../engine/plan-cleaner';
import { cleanRepeat } from '../engine/repeat-engine';

export interface ExecutionResult {
  plan: Plan;
  messages: string[];
  proposedMemories: ProposeMemoryArgs[];
  blocksAdded: string[];
  blocksRemoved: string[];
  blocksModified: string[];
  goalsAdded: string[];
  profileUpdated: boolean;
}

function clonePlan(plan: Plan): Plan {
  return JSON.parse(JSON.stringify(plan));
}

function executeCreateEvent(plan: Plan, args: CreateEventArgs): { blockId: string } {
  const block = cleanBlock({
    ...args,
    id: generateId('block'),
    source: 'ai-tool',
    status: 'planned',
    repeat: args.repeat ? cleanRepeat(args.repeat) : { frequency: 'none', interval: 1, until: '', count: 0 },
  });
  plan.blocks.push(block);
  return { blockId: block.id };
}

function executeUpdateEvent(plan: Plan, args: UpdateEventArgs): void {
  const idx = plan.blocks.findIndex(b => b.id === args.targetId);
  if (idx === -1) return;
  const existing = plan.blocks[idx];
  const updates: Record<string, unknown> = { ...args };
  delete updates.targetId;
  if (updates.repeat) {
    updates.repeat = cleanRepeat(updates.repeat);
  }
  plan.blocks[idx] = cleanBlock({ ...existing, ...updates });
  plan.blocks[idx].id = existing.id;
}

function executeDeleteEvent(plan: Plan, args: DeleteEventArgs): void {
  plan.blocks = plan.blocks.filter(b => b.id !== args.targetId);
}

function executeMoveEvent(plan: Plan, args: MoveEventArgs): void {
  const block = plan.blocks.find(b => b.id === args.targetId);
  if (!block) return;
  if (args.date !== undefined) block.date = args.date;
  if (args.day !== undefined) block.day = args.day;
  block.start = args.start;
  block.end = args.end;
}

function executeResizeEvent(plan: Plan, args: ResizeEventArgs): void {
  const block = plan.blocks.find(b => b.id === args.targetId);
  if (!block) return;
  if (args.start !== undefined) block.start = args.start;
  block.end = args.end;
}

function executeCreateGoal(plan: Plan, args: CreateGoalArgs): { goalId: string } {
  const goal = cleanGoal({
    ...args,
    id: generateId('goal'),
    status: 'active',
  });
  plan.goals.push(goal);
  return { goalId: goal.id };
}

function executeUpdateProfile(plan: Plan, args: UpdateProfileArgs): void {
  const merged = { ...plan.profile, ...args };
  if (args.energyPattern) {
    merged.energyPattern = { ...plan.profile.energyPattern, ...args.energyPattern };
  }
  plan.profile = cleanProfile(merged);
}

export function executeToolCalls(plan: Plan, calls: ValidatedToolCall[]): ExecutionResult {
  const draft = clonePlan(plan);
  const messages: string[] = [];
  const proposedMemories: ProposeMemoryArgs[] = [];
  const blocksAdded: string[] = [];
  const blocksRemoved: string[] = [];
  const blocksModified: string[] = [];
  const goalsAdded: string[] = [];
  let profileUpdated = false;

  for (const call of calls) {
    switch (call.name) {
      case 'create_event': {
        const { blockId } = executeCreateEvent(draft, call.args as CreateEventArgs);
        blocksAdded.push(blockId);
        break;
      }
      case 'update_event': {
        const args = call.args as UpdateEventArgs;
        executeUpdateEvent(draft, args);
        blocksModified.push(args.targetId);
        break;
      }
      case 'delete_event': {
        const args = call.args as DeleteEventArgs;
        blocksRemoved.push(args.targetId);
        executeDeleteEvent(draft, args);
        break;
      }
      case 'move_event': {
        const args = call.args as MoveEventArgs;
        executeMoveEvent(draft, args);
        blocksModified.push(args.targetId);
        break;
      }
      case 'resize_event': {
        const args = call.args as ResizeEventArgs;
        executeResizeEvent(draft, args);
        blocksModified.push(args.targetId);
        break;
      }
      case 'create_goal': {
        const { goalId } = executeCreateGoal(draft, call.args as CreateGoalArgs);
        goalsAdded.push(goalId);
        break;
      }
      case 'update_profile': {
        executeUpdateProfile(draft, call.args as UpdateProfileArgs);
        profileUpdated = true;
        break;
      }
      case 'respond_text': {
        messages.push((call.args as RespondTextArgs).text);
        break;
      }
      case 'propose_memory': {
        proposedMemories.push(call.args as ProposeMemoryArgs);
        break;
      }
    }
  }

  return { plan: draft, messages, proposedMemories, blocksAdded, blocksRemoved, blocksModified, goalsAdded, profileUpdated };
}
