import { signal, computed } from '@preact/signals';

export interface ApiProfile {
  name: string;
  mode: 'chat' | 'responses';
  baseUrl: string;
  model: string;
  apiKey: string;
  source: 'server' | 'client';
  configured?: boolean;
  provider?: string;
}

export const serverProfiles = signal<ApiProfile[]>([]);
export const apiStatus = signal('API-only：等待在线模型。');
export const fastMode = signal(loadFastModeSetting());

function loadFastModeSetting(): boolean {
  try {
    const stored = localStorage.getItem('calendarFastMode');
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export function setFastMode(enabled: boolean) {
  fastMode.value = enabled;
  try { localStorage.setItem('calendarFastMode', String(enabled)); } catch {}
}

export function setServerProfiles(profiles: ApiProfile[]) {
  serverProfiles.value = profiles;
}

export function setApiStatus(status: string) {
  apiStatus.value = status;
}
