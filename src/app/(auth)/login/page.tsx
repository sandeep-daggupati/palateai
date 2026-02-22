'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

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

  const onLogin = async () => {
    setLoading(true);
    const supabase = getBrowserSupabaseClient();
    const origin = window.location.origin;

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${origin}/auth/callback` },
    });

    setLoading(false);
  };

  if (checkingSession) {
    return <main className="mx-auto min-h-screen w-full max-w-md p-6" />;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center p-6">
      <div className="card-surface space-y-5">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-app-text">
            <span>Palate</span>
            <span className="text-brand-accent dark:text-brand-accent-dark">AI</span>
          </h1>
          <p className="text-base text-app-text">Remember every plate you love.</p>
          <p className="text-sm text-app-muted">Upload a receipt or menu. PalateAI pulls your Palate picks in seconds.</p>
        </div>

        <Button onClick={onLogin} disabled={loading} size="lg">
          {loading ? 'Redirecting...' : 'Continue with Google'}
        </Button>

        <p className="text-center text-xs text-app-muted">Private by default.</p>
      </div>
    </main>
  );
}
