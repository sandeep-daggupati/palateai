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
      <h1 className="text-3xl font-bold">Dish Tracker</h1>
      <p className="text-sm text-slate-600">Capture dishes from receipts and keep your own food timeline.</p>
      <Button onClick={onLogin} disabled={loading}>
        {loading ? 'Redirecting…' : 'Continue with Google'}
      </Button>
    </main>
  );
}
