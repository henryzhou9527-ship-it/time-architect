import { AGENT_TOOLS } from './tool-schema.js';

const MIN_BLOCK_MINUTES = 5;
const DAY_MINUTES = 1440;
const VALID_CATEGORIES = new Set(['deep', 'study', 'workout', 'admin', 'life', 'reflection', 'recovery', 'reward', 'rest']);
const VALID_KINDS = new Set(['fixed', 'deadline', 'spark', 'routine', 'general']);

function reject(name, args, error) {
  return { name, args, valid: false, error };
}

function accept(name, args) {
  return { name, args, valid: true };
}

function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(str || ''));
}

function validateTimeRange(start, end) {
  if (start !== undefined && (start < 0 || start > DAY_MINUTES - MIN_BLOCK_MINUTES)) {
    return `start must be 0-${DAY_MINUTES - MIN_BLOCK_MINUTES}`;
  }
  if (end !== undefined && (end < MIN_BLOCK_MINUTES || end > DAY_MINUTES)) {
    return `end must be ${MIN_BLOCK_MINUTES}-${DAY_MINUTES}`;
  }
  if (start !== undefined && end !== undefined && end - start < MIN_BLOCK_MINUTES) {
    return `duration must be >= ${MIN_BLOCK_MINUTES} minutes`;
  }
  return null;
}

function detectExplicitRecurrence(text) {
  const s = String(text || '').toLowerCase();
  return /(每天|每日|天天|\bdaily\b|\bevery\s+day\b|每周|每星期|每礼拜|\bweekly\b|\bevery\s+week\b|\bevery\s+(mon|tue|wed|thu|fri|sat|sun)\w*\b|每月|每个月|\bmonthly\b|\bevery\s+month\b|重复|循环|recurring|recur|repeat)/i.test(s);
}

function applyRecurrenceGuard(args, userInput) {
  if (!args.repeat || args.repeat.frequency === 'none') return args;
  if (userInput && !detectExplicitRecurrence(userInput)) {
    return { ...args, repeat: { ...args.repeat, frequency: 'none' } };
  }
  return args;
}

function validateCreateEvent(args, blocks, userInput) {
  if (!args.title || typeof args.title !== 'string') return reject('create_event', args, 'title is required');
  const timeErr = validateTimeRange(args.start, args.end);
  if (timeErr) return reject('create_event', args, timeErr);
  if (args.date !== undefined && !isValidDate(args.date)) return reject('create_event', args, `invalid date: ${args.date}`);
  if (args.category && !VALID_CATEGORIES.has(args.category)) return reject('create_event', args, `invalid category: ${args.category}`);
  if (args.kind && !VALID_KINDS.has(args.kind)) return reject('create_event', args, `invalid kind: ${args.kind}`);
  const guarded = applyRecurrenceGuard(args, userInput);
  return accept('create_event', guarded);
}

function validateUpdateEvent(args, blocks) {
  if (!args.targetId) return reject('update_event', args, 'targetId is required');
  if (!blocks.some(b => b.id === args.targetId)) return reject('update_event', args, `block not found: ${args.targetId}`);
  const timeErr = validateTimeRange(args.start, args.end);
  if (timeErr) return reject('update_event', args, timeErr);
  if (args.date !== undefined && !isValidDate(args.date)) return reject('update_event', args, `invalid date: ${args.date}`);
  return accept('update_event', args);
}

function validateDeleteEvent(args, blocks) {
  if (!args.targetId) return reject('delete_event', args, 'targetId is required');
  if (!blocks.some(b => b.id === args.targetId)) return reject('delete_event', args, `block not found: ${args.targetId}`);
  return accept('delete_event', args);
}

function validateMoveEvent(args, blocks) {
  if (!args.targetId) return reject('move_event', args, 'targetId is required');
  if (!blocks.some(b => b.id === args.targetId)) return reject('move_event', args, `block not found: ${args.targetId}`);
  const timeErr = validateTimeRange(args.start, args.end);
  if (timeErr) return reject('move_event', args, timeErr);
  if (args.date !== undefined && !isValidDate(args.date)) return reject('move_event', args, `invalid date: ${args.date}`);
  return accept('move_event', args);
}

function validateResizeEvent(args, blocks) {
  if (!args.targetId) return reject('resize_event', args, 'targetId is required');
  const block = blocks.find(b => b.id === args.targetId);
  if (!block) return reject('resize_event', args, `block not found: ${args.targetId}`);
  const start = args.start !== undefined ? args.start : block.start;
  const timeErr = validateTimeRange(start, args.end);
  if (timeErr) return reject('resize_event', args, timeErr);
  return accept('resize_event', args);
}

function validateCreateGoal(args) {
  if (!args.title || typeof args.title !== 'string') return reject('create_goal', args, 'title is required');
  return accept('create_goal', args);
}

function validateUpdateGoal(args, goals) {
  if (!args.targetId) return reject('update_goal', args, 'targetId is required');
  if (!goals.some(g => g.id === args.targetId)) return reject('update_goal', args, `goal not found: ${args.targetId}`);
  if (Object.keys(args).length <= 1) return reject('update_goal', args, 'at least one field besides targetId is required');
  return accept('update_goal', args);
}

function validateDeleteGoal(args, goals) {
  if (!args.targetId) return reject('delete_goal', args, 'targetId is required');
  if (!goals.some(g => g.id === args.targetId)) return reject('delete_goal', args, `goal not found: ${args.targetId}`);
  return accept('delete_goal', args);
}

function validateUpdateProfile(args) {
  if (Object.keys(args).length === 0) return reject('update_profile', args, 'at least one field is required');
  return accept('update_profile', args);
}

function validateRespondText(args) {
  if (!args.text || typeof args.text !== 'string') return reject('respond_text', args, 'text is required');
  return accept('respond_text', args);
}

function validateProposeMemory(args) {
  if (!args.key || !args.content) return reject('propose_memory', args, 'key and content are required');
  return accept('propose_memory', args);
}

// `planContext` is either the legacy blocks array or { blocks, goals }.
function validateToolCall(call, planContext, agentRole, userInput) {
  const blocks = Array.isArray(planContext) ? planContext : (Array.isArray(planContext?.blocks) ? planContext.blocks : []);
  const goals = Array.isArray(planContext) ? [] : (Array.isArray(planContext?.goals) ? planContext.goals : []);
  const allowed = AGENT_TOOLS[agentRole] || AGENT_TOOLS.all;
  if (!allowed.includes(call.name)) {
    return reject(call.name, call.args || {}, `${agentRole} agent cannot use tool: ${call.name}`);
  }
  const args = call.args || {};
  switch (call.name) {
    case 'create_event': return validateCreateEvent(args, blocks, userInput);
    case 'update_event': return validateUpdateEvent(args, blocks);
    case 'delete_event': return validateDeleteEvent(args, blocks);
    case 'move_event': return validateMoveEvent(args, blocks);
    case 'resize_event': return validateResizeEvent(args, blocks);
    case 'create_goal': return validateCreateGoal(args);
    case 'update_goal': return validateUpdateGoal(args, goals);
    case 'delete_goal': return validateDeleteGoal(args, goals);
    case 'update_profile': return validateUpdateProfile(args);
    case 'respond_text': return validateRespondText(args);
    case 'propose_memory': return validateProposeMemory(args);
    default: return reject(call.name, args, `unknown tool: ${call.name}`);
  }
}

function validateToolCalls(calls, planContext, agentRole, userInput) {
  return calls.map(call => validateToolCall(call, planContext, agentRole, userInput));
}

export { validateToolCall, validateToolCalls };
