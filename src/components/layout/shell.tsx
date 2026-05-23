import { useComputed } from '@preact/signals';
import { currentPage, chatOpen } from '../../store/ui-store';
import { Sidebar } from './sidebar';
import { CalendarBoard } from '../calendar/calendar-board';
import { ChatPanel } from '../chat/chat-panel';
import { SettingsPage } from '../pages/settings';
import { WorkflowPage } from '../pages/workflow';
import { ArchivePage } from '../pages/archive';
import { ProfilePage } from '../pages/profile';

export function Shell() {
  const page = useComputed(() => currentPage.value);
  const showChat = useComputed(() => chatOpen.value);

  function renderPage() {
    switch (page.value) {
      case 'settings': return <SettingsPage />;
      case 'workflow': return <WorkflowPage />;
      case 'archive': return <ArchivePage />;
      case 'profile': return <ProfilePage />;
      default: return <CalendarBoard />;
    }
  }

  return (
    <div class={`ta-shell ta-shell--no-intro${showChat.value ? '' : ' ta-shell--chat-collapsed'}`}>
      <Sidebar />
      <main class="ta-main-area">
        {renderPage()}
      </main>
      <ChatPanel />
    </div>
  );
}
