import { signal, computed } from '@preact/signals';

export type Page = 'calendar' | 'settings' | 'workflow' | 'archive' | 'profile';
export type CalendarMode = 'plan' | 'review';

export const currentPage = signal<Page>('calendar');
export const chatOpen = signal(true);
export const calendarMode = signal<CalendarMode>('plan');
export const slotSize = signal(30);
export const archiveFilter = signal('all');
export const expandedArchiveId = signal<string | null>(null);
export const editingMemoryId = signal<string | null>(null);

export const selectedBlockId = signal<string | null>(null);
export const selectedOccurrenceDate = signal('');
export const editingBlockId = signal<string | null>(null);
export const editingOccurrenceDate = signal('');

export const dragState = signal<{
  blockId: string;
  startY: number;
  originalStart: number;
  originalEnd: number;
  mode: 'move' | 'resize-top' | 'resize-bottom';
} | null>(null);

export function selectBlock(blockId: string | null, occurrenceDate = '') {
  selectedBlockId.value = blockId;
  selectedOccurrenceDate.value = occurrenceDate;
}

export function startEditing(blockId: string, occurrenceDate = '') {
  editingBlockId.value = blockId;
  editingOccurrenceDate.value = occurrenceDate;
}

export function stopEditing() {
  editingBlockId.value = null;
  editingOccurrenceDate.value = '';
}

export function navigateTo(page: Page) {
  currentPage.value = page;
}

export function toggleChat() {
  chatOpen.value = !chatOpen.value;
}
