'use client';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);

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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-app-text">PalateAI</h1>
        <p className="text-base text-app-muted">Capture dishes from receipts and keep your personal food timeline.</p>
      </div>
      <Button onClick={onLogin} disabled={loading} size="lg">
        {loading ? 'Redirecting...' : 'Continue with Google'}
      </Button>
    </main>
  );
}
