import { setServerProfiles, setApiStatus } from '../store/api-store';
import type { ApiProfile } from '../store/api-store';

export async function initApp() {
  try {
    const response = await fetch('/api/time-architect', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      setApiStatus(`API 不可用 (HTTP ${response.status})`);
      return;
    }

    const data = await response.json();
    if (data.ok && Array.isArray(data.profiles)) {
      const profiles: ApiProfile[] = data.profiles.map((p: any) => ({
        name: p.name || p.model || 'Unknown',
        mode: p.mode || 'chat',
        baseUrl: p.baseUrl || '',
        model: p.model || '',
        apiKey: '',
        source: 'server' as const,
        configured: p.configured ?? true,
        provider: p.provider,
      }));
      setServerProfiles(profiles);
      setApiStatus(`已连接 — ${profiles.length} 个 API 配置`);
    } else {
      setApiStatus('API 已连接（无配置）');
    }
  } catch {
    setApiStatus('API 不可用（网络错误）');
  }
}
