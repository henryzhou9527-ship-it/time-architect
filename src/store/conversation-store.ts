import { signal, computed } from '@preact/signals';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  agentKey?: string;
  agentLabel?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; valid?: boolean }>;
  workflowTrace?: WorkflowTrace;
}

export interface WorkflowTrace {
  routerDecision?: string;
  activeSkill?: string;
  contextSummary?: string;
  apiResult?: string;
  outputHandling?: string;
}

export const conversation = signal<ChatMessage[]>([]);
export const draftText = signal('');
export const agentTurnRunning = signal(false);
export const agentTurnLabel = signal('');
export const agentTurnStartedAt = signal<number | null>(null);

export const hasMessages = computed(() => conversation.value.length > 0);

export function addMessage(msg: ChatMessage) {
  conversation.value = [...conversation.value, {
    ...msg,
    timestamp: msg.timestamp || new Date().toISOString(),
  }];
}

export function addUserMessage(content: string) {
  addMessage({ role: 'user', content });
}

export function addAssistantMessage(content: string, extra: Partial<ChatMessage> = {}) {
  addMessage({ role: 'assistant', content, ...extra });
}

export function clearConversation() {
  conversation.value = [];
  draftText.value = '';
}

export function setDraftText(text: string) {
  draftText.value = text;
}

export function startAgentTurn(label: string) {
  agentTurnRunning.value = true;
  agentTurnLabel.value = label;
  agentTurnStartedAt.value = Date.now();
}

export function endAgentTurn() {
  agentTurnRunning.value = false;
  agentTurnLabel.value = '';
  agentTurnStartedAt.value = null;
}

export function recentConversation(limit = 6): ChatMessage[] {
  return conversation.value.slice(-limit);
}
