'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function LoginPage() {
  const router = useRouter();
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingPassword, setLoadingPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const demoAuthEnabled = useMemo(
    () => (process.env.NEXT_PUBLIC_DEMO_AUTH || '').toLowerCase() === 'true',
    [],
  );

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/');
        return;
      }
      setCheckingSession(false);
    });
  }, [router]);

  const onLoginGoogle = async () => {
    setErrorMessage(null);
    setLoadingGoogle(true);
    const supabase = getBrowserSupabaseClient();
    const origin = window.location.origin;

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin}/auth/callback` },
    });

    setLoadingGoogle(false);
  };

  const onLoginPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Enter both email and password.');
      return;
    }

    setLoadingPassword(true);
    const supabase = getBrowserSupabaseClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setErrorMessage(error.message || 'Could not sign in. Please check your credentials.');
      setLoadingPassword(false);
      return;
    }

    router.replace('/');
    router.refresh();
    setLoadingPassword(false);
  };

  if (checkingSession) {
    return <main className="mx-auto min-h-screen w-full max-w-md p-4" />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-4">
      <div className="card-surface space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-app-text">
            <span>Palate</span>
            <span className="text-brand-accent dark:text-brand-accent-dark">AI</span>
          </h1>
          <p className="text-sm text-app-text">Remember every meal you love.</p>
          <p className="text-sm text-app-muted">Drop in a receipt or photo. PalateAI builds your food memories, one meal at a time.</p>
        </div>

        <Button onClick={onLoginGoogle} disabled={loadingGoogle || loadingPassword} size="md">
          {loadingGoogle ? 'Redirecting...' : 'Continue with Google'}
        </Button>

        {demoAuthEnabled && (
          <form className="space-y-2 rounded-xl border border-app-border p-3" onSubmit={onLoginPassword}>
            <p className="text-xs uppercase tracking-wide text-app-muted">Demo sign-in</p>
            <Input
              type="email"
              placeholder="demo@palateai.local"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={loadingGoogle || loadingPassword}
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loadingGoogle || loadingPassword}
            />
            <Button type="submit" variant="secondary" size="sm" disabled={loadingGoogle || loadingPassword}>
              {loadingPassword ? 'Signing in...' : 'Sign in with email'}
            </Button>
          </form>
        )}

        {errorMessage && <p className="text-sm text-rose-600">{errorMessage}</p>}

        <p className="text-center text-xs text-app-muted">Private by default.</p>
      </div>
    </main>
  );
}
