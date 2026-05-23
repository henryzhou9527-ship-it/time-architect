import { useComputed } from '@preact/signals';
import { currentPage, navigateTo, toggleChat, type Page } from '../../store/ui-store';
import { profile } from '../../store/plan-store';

const NAV_ITEMS: { key: Page; label: string; icon: string }[] = [
  { key: 'calendar', label: '日历', icon: '📅' },
  { key: 'profile', label: '画像', icon: '👤' },
  { key: 'workflow', label: '工作流', icon: '⚙' },
  { key: 'archive', label: '存档', icon: '📦' },
  { key: 'settings', label: '设置', icon: '🔧' },
];

export function Sidebar() {
  const page = useComputed(() => currentPage.value);
  const userName = useComputed(() => profile.value.name);

  return (
    <nav class="ta-sidebar">
      <div class="ta-sidebar__logo">
        <span class="ta-sidebar__logo-text">Time Architect</span>
      </div>
      <div class="ta-sidebar__nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.key}
            class={`ta-sidebar__nav-item${page.value === item.key ? ' ta-sidebar__nav-item--active' : ''}`}
            onClick={() => navigateTo(item.key)}
          >
            <span class="ta-sidebar__nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
      <div class="ta-sidebar__profile" onClick={toggleChat}>
        <div class="ta-sidebar__avatar">{userName.value.charAt(0)}</div>
        <div class="ta-sidebar__profile-info">
          <div class="ta-sidebar__profile-name">{userName}</div>
        </div>
      </div>
    </nav>
  );
}
