import { useComputed, useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { blocksForDayIndex, activePlan } from '../../store/plan-store';
import { selectedBlockId, editingBlockId, selectBlock, startEditing } from '../../store/ui-store';
import { BlockCard } from './block-card';
import { BlockEditor } from './block-editor';
import { nowMinutes } from '../../engine/date-utils';
import { dayIndexForDate } from '../../engine/date-utils';

const BOARD_HEIGHT = 1536;
const PX_PER_MINUTE = BOARD_HEIGHT / 1440;

interface DayColumnProps {
  dayIndex: number;
  weekStart: string;
  isToday: boolean;
}

export function DayColumn({ dayIndex, weekStart, isToday }: DayColumnProps) {
  const dayBlocks = useComputed(() => blocksForDayIndex(dayIndex));
  const selected = useComputed(() => selectedBlockId.value);
  const editing = useComputed(() => {
    const eid = editingBlockId.value;
    if (!eid) return false;
    const block = activePlan.value.blocks.find(b => b.id === eid);
    if (!block) return false;
    return dayIndexForDate(block.date, weekStart) === dayIndex;
  });
  const currentMinute = useSignal(nowMinutes());

  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => {
      currentMinute.value = nowMinutes();
    }, 60000);
    return () => clearInterval(id);
  }, [isToday]);

  return (
    <div class={`ta-calendar__day-col${isToday ? ' ta-calendar__day-col--today' : ''}`}>
      {isToday && (
        <div
          class="ta-calendar__now-line"
          style={{ top: `${currentMinute.value * PX_PER_MINUTE}px` }}
        />
      )}
      {dayBlocks.value.map(block => (
        <BlockCard
          key={`${block.id}-${block.occurrenceDate}`}
          block={block}
          pxPerMinute={PX_PER_MINUTE}
          isSelected={selected.value === block.id}
          onSelect={() => selectBlock(block.id, block.occurrenceDate)}
          onEdit={() => startEditing(block.id, block.occurrenceDate)}
        />
      ))}
      {editing.value && <BlockEditor />}
    </div>
  );
}
