import type { BlockOccurrence } from '../../models/plan';
import { minutesToTime } from '../../engine/date-utils';
import { CATEGORIES } from '../../engine/constants';

interface BlockCardProps {
  block: BlockOccurrence;
  pxPerMinute: number;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

export function BlockCard({ block, pxPerMinute, isSelected, onSelect, onEdit }: BlockCardProps) {
  const top = block.start * pxPerMinute;
  const height = Math.max((block.end - block.start) * pxPerMinute, 16);
  const color = CATEGORIES[block.category]?.color || '#9ca3af';
  const compact = height < 28;

  return (
    <div
      class={`ta-block${isSelected ? ' selected' : ''}${compact ? ' compact' : ''}`}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        '--cat-color': color,
      } as any}
      onClick={onSelect}
      onDblClick={onEdit}
    >
      <div class="ta-block__title">{block.title}</div>
      {!compact && (
        <div class="ta-block__time">{minutesToTime(block.start)}-{minutesToTime(block.end)}</div>
      )}
      {block.status !== 'planned' && (
        <div class="ta-block__status">{block.status === 'done' ? '✓' : '✗'}</div>
      )}
    </div>
  );
}
