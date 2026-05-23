import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Block, Repeat } from '../../models/plan';
import { CATEGORIES, TASK_KINDS, REPEAT_OPTIONS } from '../../engine/constants';
import { minutesToTime, timeToMinutes } from '../../engine/date-utils';
import { updateBlock, removeBlock, activePlan } from '../../store/plan-store';
import { editingBlockId, stopEditing } from '../../store/ui-store';

export function BlockEditor() {
  const blockId = editingBlockId.value;
  if (!blockId) return null;

  const block = activePlan.value.blocks.find(b => b.id === blockId);
  if (!block) return null;

  const title = useSignal(block.title);
  const date = useSignal(block.date);
  const startTime = useSignal(minutesToTime(block.start));
  const endTime = useSignal(minutesToTime(block.end));
  const category = useSignal(block.category);
  const kind = useSignal(block.kind);
  const repeatFreq = useSignal<Repeat['frequency']>(block.repeat.frequency);
  const note = useSignal(block.note || '');

  useEffect(() => {
    title.value = block.title;
    date.value = block.date;
    startTime.value = minutesToTime(block.start);
    endTime.value = minutesToTime(block.end);
    category.value = block.category;
    kind.value = block.kind;
    repeatFreq.value = block.repeat.frequency;
    note.value = block.note || '';
  }, [blockId]);

  function handleSave() {
    updateBlock(blockId!, {
      title: title.value,
      date: date.value,
      start: timeToMinutes(startTime.value),
      end: timeToMinutes(endTime.value),
      category: category.value as Block['category'],
      kind: kind.value as Block['kind'],
      repeat: { ...block!.repeat, frequency: repeatFreq.value as Block['repeat']['frequency'] },
      note: note.value,
    });
    stopEditing();
  }

  function handleDelete() {
    removeBlock(blockId!);
    stopEditing();
  }

  function handleCancel() {
    stopEditing();
  }

  const top = block.start * (1536 / 1440);

  return (
    <div class="ta-block-editor" style={{ top: `${top}px` }}>
      <div class="ta-block-form">
        <input
          class="ta-block-form__title"
          value={title.value}
          onInput={(e) => title.value = (e.target as HTMLInputElement).value}
          placeholder="标题"
        />
        <div class="ta-block-form__grid">
          <label>
            日期
            <input type="date" value={date.value} onInput={(e) => date.value = (e.target as HTMLInputElement).value} />
          </label>
          <label>
            类别
            <select value={category.value} onChange={(e) => category.value = (e.target as HTMLSelectElement).value as Block['category']}>
              {Object.entries(CATEGORIES).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </label>
          <label>
            开始
            <input type="time" value={startTime.value} onInput={(e) => startTime.value = (e.target as HTMLInputElement).value} />
          </label>
          <label>
            结束
            <input type="time" value={endTime.value} onInput={(e) => endTime.value = (e.target as HTMLInputElement).value} />
          </label>
          <label>
            类型
            <select value={kind.value} onChange={(e) => kind.value = (e.target as HTMLSelectElement).value as Block['kind']}>
              {Object.entries(TASK_KINDS).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </label>
          <label>
            重复
            <select value={repeatFreq.value} onChange={(e) => repeatFreq.value = (e.target as HTMLSelectElement).value as Repeat['frequency']}>
              {Object.entries(REPEAT_OPTIONS).map(([key, val]) => (
                <option key={key} value={key}>{val.label}</option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          class="ta-block-form__note"
          value={note.value}
          onInput={(e) => note.value = (e.target as HTMLTextAreaElement).value}
          placeholder="备注..."
        />
        <div class="ta-block-form__actions">
          <button class="ta-block-form__danger" onClick={handleDelete}>删除</button>
          <button onClick={handleCancel}>取消</button>
          <button class="ta-block-form__primary" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
