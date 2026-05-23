import type { ChatMessage as ChatMessageType } from '../../store/conversation-store';

interface Props {
  message: ChatMessageType;
}

export function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const trace = message.workflowTrace;

  const bubbleClass = isUser
    ? 'ta-chat__bubble ta-chat__bubble--user'
    : isSystem
      ? 'ta-chat__bubble ta-chat__bubble--system'
      : message.agentKey
        ? 'ta-chat__bubble ta-chat__bubble--agent'
        : 'ta-chat__bubble ta-chat__bubble--ai';

  return (
    <div class={bubbleClass}>
      {!isUser && message.agentKey && (
        <div class="ta-chat__agent-head">
          <span>{message.agentLabel || message.agentKey}</span>
          {message.timestamp && <em>{new Date(message.timestamp).toLocaleTimeString()}</em>}
        </div>
      )}
      <div>{message.content}</div>
      {message.timestamp && !message.agentKey && (
        <div class="ta-chat__bubble-time">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      )}
      {trace && (
        <details class="ta-chat__bubble ta-chat__bubble--workflow" style={{ marginTop: '8px', padding: '8px 12px' }}>
          <summary style={{ cursor: 'pointer', fontSize: '11px' }}>workflow trace</summary>
          <div style={{ fontSize: '11px', marginTop: '4px', lineHeight: '1.5' }}>
            {trace.routerDecision && <div>Router: {trace.routerDecision}</div>}
            {trace.activeSkill && <div>Skill: {trace.activeSkill}</div>}
            {trace.contextSummary && <div>Context: {trace.contextSummary}</div>}
            {trace.apiResult && <div>Result: {trace.apiResult}</div>}
            {trace.outputHandling && <div>Output: {trace.outputHandling}</div>}
          </div>
        </details>
      )}
    </div>
  );
}
