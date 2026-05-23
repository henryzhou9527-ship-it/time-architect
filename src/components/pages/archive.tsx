import { useComputed } from '@preact/signals';
import { activePlan } from '../../store/plan-store';

export function ArchivePage() {
  const archives = useComputed(() => activePlan.value.archives);

  return (
    <div class="ta-page">
      <h2 class="ta-page__title">存档</h2>
      {archives.value.length === 0 && (
        <div class="ta-page__card">
          <p>暂无存档。对话完成后点击「应用并存档」保存。</p>
        </div>
      )}
      {archives.value.map((archive: any, i: number) => (
        <div key={i} class="ta-page__card">
          <h3>{archive.title || archive.type || '未命名存档'}</h3>
          {archive.at && <p style={{ fontSize: '12px', color: 'var(--ta-text-muted)' }}>{archive.at}</p>}
        </div>
      ))}
    </div>
  );
}
