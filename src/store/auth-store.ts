import { signal } from '@preact/signals';

const STORAGE_KEY = 'calendarUser';

function loadUser(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch { return ''; }
}

export const authUser = signal(loadUser());
export const encKey = signal<CryptoKey | null>(null);
export const isAuthenticated = signal(Boolean(loadUser()));

export function setAuth(user: string, key: CryptoKey | null) {
  authUser.value = user;
  encKey.value = key;
  isAuthenticated.value = Boolean(user);
  try {
    if (user) {
      localStorage.setItem(STORAGE_KEY, user);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* storage unavailable */ }
}

export function clearAuth() {
  authUser.value = '';
  encKey.value = null;
  isAuthenticated.value = false;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
