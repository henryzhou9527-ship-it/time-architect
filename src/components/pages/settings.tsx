import { useComputed } from '@preact/signals';
import { serverProfiles, apiStatus, fastMode, setFastMode } from '../../store/api-store';

export function SettingsPage() {
  const profiles = useComputed(() => serverProfiles.value);
  const status = useComputed(() => apiStatus.value);
  const fast = useComputed(() => fastMode.value);

  return (
    <div class="ta-page">
      <h2 class="ta-page__title">API 设置</h2>
      <div class="ta-page__card">
        <h3>状态</h3>
        <p>{status.value || '未连接'}</p>
      </div>
      <div class="ta-page__card">
        <h3>Fast Mode</h3>
        <div class="ta-form-grid">
          <label>
            <input
              type="checkbox"
              checked={fast.value}
              onChange={(e) => setFastMode((e.target as HTMLInputElement).checked)}
            />
            智能路由（自动选择 Agent）
          </label>
        </div>
      </div>
      <div class="ta-page__card">
        <h3>Server Profiles</h3>
        {profiles.value.length === 0 && <p>暂无服务端 API 配置</p>}
        {profiles.value.length > 0 && (
          <ul>
            {profiles.value.map((p, i) => (
              <li key={i}>{p.name} — {p.model} ({p.source})</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
