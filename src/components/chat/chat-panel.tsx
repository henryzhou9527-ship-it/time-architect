import { useComputed, useSignal } from '@preact/signals';
import { useRef, useEffect } from 'preact/hooks';
import {
  conversation, draftText, setDraftText, agentTurnRunning, agentTurnLabel,
} from '../../store/conversation-store';
import { previewDraft } from '../../store/plan-store';
import { chatOpen, toggleChat } from '../../store/ui-store';
import { ChatMessage } from './chat-message';
import { DraftBanner } from './draft-banner';
import { runAgentTurn } from '../../services/agent-service';

const QUICK_CHIPS = [
  { label: '/build-day', cmd: '/build-day' },
  { label: '/goal', cmd: '/goal' },
  { label: '/health', cmd: '/health' },
  { label: '/reflect', cmd: '/reflect' },
];

export function ChatPanel() {
  const messages = useComputed(() => conversation.value);
  const draft = useComputed(() => draftText.value);
  const running = useComputed(() => agentTurnRunning.value);
  const turnLabel = useComputed(() => agentTurnLabel.value);
  const hasDraft = useComputed(() => previewDraft.value);
  const isOpen = useComputed(() => chatOpen.value);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.value.length]);

  async function handleSend(e: Event) {
    e.preventDefault();
    const text = draftText.value.trim();
    if (!text || agentTurnRunning.value) return;
    setDraftText('');
    await runAgentTurn(text, '/api/time-architect');
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  function handleChip(cmd: string) {
    setDraftText(cmd);
  }

  return (
    <aside class={`ta-chat${isOpen.value ? '' : ' ta-chat--collapsed'}`}>
      <div class="ta-chat__header" onClick={toggleChat}>
        <div class="ta-chat__avatar">TA</div>
        <div class="ta-chat__header-info">
          <div class="ta-chat__header-title">Time Architect</div>
          {running.value
            ? <div class="ta-chat__header-status">{turnLabel.value}...</div>
            : <div class="ta-chat__header-status">在线</div>
          }
        </div>
        <span class={`ta-chat__header-toggle${isOpen.value ? '' : ' ta-chat__header-toggle--collapsed'}`}>▾</span>
      </div>

      <div class="ta-chat__body">
        {hasDraft.value && <DraftBanner />}

        <div class="ta-chat__messages" ref={listRef}>
          {messages.value.map((msg, i) => (
            <ChatMessage key={i} message={msg} />
          ))}
        </div>

        <div class="ta-chat__chips">
          {QUICK_CHIPS.map(chip => (
            <button
              key={chip.cmd}
              class="ta-chat__chip"
              onClick={() => handleChip(chip.cmd)}
              disabled={running.value}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <form class="ta-chat__input-area" onSubmit={handleSend}>
          <div class="ta-chat__input-wrap">
            <textarea
              class="ta-chat__input"
              value={draft.value}
              onInput={(e) => setDraftText((e.target as HTMLTextAreaElement).value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息或 /命令..."
              disabled={running.value}
              rows={2}
            />
          </div>
          <button type="submit" class="ta-chat__send" disabled={running.value || !draft.value.trim()}>
            ↑
          </button>
        </form>
      </div>
    </aside>
  );
}
