import { applyDraft, discardDraft } from '../../store/plan-store';
import { clearConversation } from '../../store/conversation-store';

export function DraftBanner() {
  function handleApply() {
    applyDraft();
    clearConversation();
  }

  function handleDiscard() {
    discardDraft();
  }

  return (
    <div class="ta-chat__draft">
      <div class="ta-chat__draft-main">
        <span>Draft Preview</span>
        <strong>日历已更新（预览中）</strong>
        <small>点击"应用并存档"保存更改</small>
      </div>
      <div class="ta-chat__draft-actions">
        <button class="ta-chat__draft-primary" onClick={handleApply}>
          应用并存档
        </button>
        <button onClick={handleDiscard}>
          丢弃
        </button>
      </div>
    </div>
  );
}
