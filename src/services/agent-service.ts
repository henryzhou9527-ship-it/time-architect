import { plan, setDraft } from '../store/plan-store';
import { conversation, addUserMessage, addAssistantMessage, startAgentTurn, endAgentTurn, recentConversation } from '../store/conversation-store';
import { fastMode } from '../store/api-store';
import { requestRoute } from '../engine/intent-classifier';
import { validateToolCalls } from '../tools/validator';
import { executeToolCalls } from '../tools/executor';
import type { ValidatedToolCall } from '../models/tools';
import type { AgentRole } from '../tools/schema';

export interface AgentTurnResult {
  messages: string[];
  draftApplied: boolean;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; valid: boolean; error?: string }>;
  route: { agentKey: string; reason: string; outputMode: string };
  apiProfile?: string;
}

export async function runAgentTurn(
  userMessage: string,
  apiEndpoint: string,
  clientConfig?: { apiKey: string; baseUrl: string; model: string; mode: string },
): Promise<AgentTurnResult> {
  const route = requestRoute(userMessage);
  const agentRole = route.agentKey as AgentRole;

  startAgentTurn(`${route.agentKey}: ${route.reason}`);
  addUserMessage(userMessage);

  try {
    const body: Record<string, unknown> = {
      toolUse: true,
      message: userMessage,
      agentRole,
      plan: plan.value,
      conversation: recentConversation(6).map(m => ({ role: m.role, content: m.content })),
      agentInstruction: '',
    };

    if (clientConfig?.apiKey) {
      body.clientConfig = clientConfig;
    }

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ error: 'API request failed' }));
      throw new Error(errData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.ok || !data.toolUse) {
      throw new Error(data.error || 'Unexpected API response');
    }

    const toolCalls: Array<{ name: string; args: Record<string, unknown>; valid: boolean; error?: string }> = data.toolCalls || [];
    const validCalls = toolCalls.filter(tc => tc.valid) as unknown as ValidatedToolCall[];
    const rejectedCalls = toolCalls.filter(tc => !tc.valid);

    const messages: string[] = [...(data.messages || [])];
    let draftApplied = false;

    if (validCalls.length > 0) {
      const result = executeToolCalls(plan.value, validCalls);
      messages.push(...result.messages);

      const hasCalendarChanges = result.blocksAdded.length > 0
        || result.blocksRemoved.length > 0
        || result.blocksModified.length > 0
        || result.goalsAdded.length > 0
        || result.profileUpdated;

      if (hasCalendarChanges && route.draftMode) {
        setDraft(result.plan);
        draftApplied = true;
      } else if (hasCalendarChanges) {
        setDraft(result.plan);
        draftApplied = true;
      }
    }

    if (rejectedCalls.length > 0) {
      const errors = rejectedCalls.map(tc => `${tc.name}: ${(tc as any).error}`);
      messages.push(`⚠ Rejected tool calls: ${errors.join('; ')}`);
    }

    const responseText = messages.join('\n\n') || 'Done.';
    addAssistantMessage(responseText, {
      agentKey: route.agentKey,
      toolCalls,
      workflowTrace: {
        routerDecision: `${route.agentKey} (${route.reason})`,
        activeSkill: route.outputMode,
        contextSummary: `${plan.value.blocks.length} blocks, ${plan.value.goals.length} goals`,
        apiResult: `${validCalls.length} tool calls executed, ${rejectedCalls.length} rejected`,
        outputHandling: draftApplied ? 'draft preview' : 'text response',
      },
    });

    return {
      messages,
      draftApplied,
      toolCalls,
      route: { agentKey: route.agentKey, reason: route.reason, outputMode: route.outputMode },
      apiProfile: data.api?.name,
    };
  } catch (error) {
    const errMsg = `API Error: ${error instanceof Error ? error.message : String(error)}`;
    addAssistantMessage(errMsg, { agentKey: route.agentKey });
    return {
      messages: [errMsg],
      draftApplied: false,
      toolCalls: [],
      route: { agentKey: route.agentKey, reason: route.reason, outputMode: route.outputMode },
    };
  } finally {
    endAgentTurn();
  }
}
