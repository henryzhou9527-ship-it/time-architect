import { useComputed } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { Shell } from './components/layout/shell';
import { AuthScreen } from './components/auth/auth-screen';
import { isAuthenticated } from './store/auth-store';
import { initApp } from './services/init';

export function App() {
  const authed = useComputed(() => isAuthenticated.value);

  useEffect(() => {
    if (authed.value) {
      initApp();
    }
  }, [authed.value]);

  if (!authed.value) {
    return <AuthScreen />;
  }

  return <Shell />;
}
