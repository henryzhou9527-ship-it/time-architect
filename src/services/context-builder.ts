import type { Plan, Block, Goal, Profile } from '../models/plan';
import type { ChatMessage } from '../store/conversation-store';
import { minutesToTime } from '../engine/date-utils';

export function compactProfileSummary(profile: Profile): string {
  const parts = [
    `Name: ${profile.name}`,
    `TZ: ${profile.timezone}`,
    `Sleep: ${profile.sleepWindow}`,
    `Capacity: ${profile.weeklyCapacityHours}h/week`,
    `Style: ${profile.planningStyle}`,
  ];
  if (profile.currentLifeStage) parts.push(`Stage: ${profile.currentLifeStage}`);
  if (profile.roles.length) parts.push(`Roles: ${profile.roles.join(', ')}`);
  if (profile.energyPattern.highFocusTime) parts.push(`Focus: ${profile.energyPattern.highFocusTime}`);
  if (profile.fixedCommitments) parts.push(`Fixed: ${profile.fixedCommitments.slice(0, 200)}`);
  return parts.join(' | ');
}

export function compactBlockSummary(block: Block): string {
  const time = `${minutesToTime(block.start)}-${minutesToTime(block.end)}`;
  const repeat = block.repeat?.frequency !== 'none' ? ` (${block.repeat.frequency})` : '';
  return `[${block.id}] ${block.title} d${block.day} ${time} ${block.category}/${block.kind}${block.date ? ' ' + block.date : ''}${repeat}`;
}

export function compactGoalSummary(goal: Goal): string {
  return `[${goal.id}] ${goal.title} (${goal.status}${goal.deadline ? ', due:' + goal.deadline : ''})`;
}

export function buildCompactContext(
  plan: Plan,
  message: string,
  conversation: ChatMessage[],
  agentInstruction = '',
): string {
  const parts: string[] = [];

  if (agentInstruction) {
    parts.push(`Agent: ${agentInstruction.slice(0, 1500)}`);
  }

  parts.push(`Profile: ${compactProfileSummary(plan.profile)}`);

  if (plan.blocks.length) {
    const blockLines = plan.blocks.slice(0, 35).map(compactBlockSummary);
    parts.push(`Blocks (${plan.blocks.length}):\n${blockLines.join('\n')}`);
  }

  const activeGoals = plan.goals.filter(g => g.status === 'active');
  if (activeGoals.length) {
    const goalLines = activeGoals.slice(0, 10).map(compactGoalSummary);
    parts.push(`Goals (${activeGoals.length} active):\n${goalLines.join('\n')}`);
  }

  const recent = conversation.slice(-3);
  if (recent.length) {
    const convLines = recent.map(m => `${m.role}: ${String(m.content).slice(0, 300)}`);
    parts.push(`Recent chat:\n${convLines.join('\n')}`);
  }

  parts.push(`Now: ${new Date().toISOString()}`);
  parts.push(`User: ${message}`);

  return parts.join('\n\n');
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
