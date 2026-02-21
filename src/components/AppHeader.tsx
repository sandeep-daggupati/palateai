'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

export function AppHeader() {
  const router = useRouter();
  const [hasSession, setHasSession] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();

    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const onLogout = async () => {
    setLoggingOut(true);
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
    setLoggingOut(false);
  };

  return (
    <header className="mb-6 flex items-center justify-between gap-3">
      <Link href="/" className="text-xl tracking-tight text-app-text">
        <span className="font-semibold">Palate</span>
        <span className="font-semibold text-brand-accent dark:text-brand-accent-dark">AI</span>
      </Link>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link
          href="/add"
          className="rounded-full bg-app-primary px-4 py-2 text-sm font-semibold text-app-primary-text transition-colors duration-200 hover:opacity-95"
        >
          + Add
        </Link>
        {hasSession && (
          <Button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            className="w-auto border border-app-border bg-app-card px-3 py-2 text-sm text-app-text shadow-sm hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {loggingOut ? 'Logging out...' : 'Logout'}
          </Button>
        )}
      </div>
    </header>
  );
}
