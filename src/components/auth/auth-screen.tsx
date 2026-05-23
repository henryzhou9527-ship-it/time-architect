import { useState } from 'preact/hooks';
import { setAuth } from '../../store/auth-store';

export function AuthScreen() {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleLogin(e: Event) {
    e.preventDefault();
    const trimmedUser = user.trim();
    if (!trimmedUser) { setError('请输入用户名'); return; }

    try {
      let key: CryptoKey | null = null;
      if (password) {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
          'raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'],
        );
        key = await crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: encoder.encode(`ta-${trimmedUser}`), iterations: 310000, hash: 'SHA-256' },
          keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
        );
      }
      setAuth(trimmedUser, key);
    } catch {
      setError('密钥生成失败');
    }
  }

  return (
    <div class="ta-auth">
      <div class="ta-auth__card">
        <div class="ta-auth__brand">
          <div class="ta-auth__title">Time Architect</div>
          <div class="ta-auth__subtitle">目标驱动的智能日历</div>
        </div>
        <form onSubmit={handleLogin}>
          <div class="ta-auth__field">
            <label>用户名</label>
            <input
              type="text"
              class="ta-auth__input"
              value={user}
              onInput={(e) => setUser((e.target as HTMLInputElement).value)}
              autoFocus
            />
          </div>
          <div class="ta-auth__field">
            <label>加密密码（可选）</label>
            <input
              type="password"
              class="ta-auth__input"
              value={password}
              onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            />
          </div>
          {error && <div class="ta-auth__error">{error}</div>}
          <button type="submit" class="ta-auth__btn">进入</button>
        </form>
      </div>
    </div>
  );
}
