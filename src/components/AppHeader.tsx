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
    <header className="mb-3 flex items-center justify-between gap-3">
      <Link href="/" className="text-lg tracking-tight text-app-text">
        <span className="font-semibold">Palate</span>
        <span className="font-semibold text-brand-accent dark:text-brand-accent-dark">AI</span>
      </Link>

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link
          href="/add"
          aria-label="Add"
          className="inline-flex h-10 items-center justify-center rounded-xl border border-transparent bg-app-primary px-3 text-sm font-medium text-app-primary-text shadow-sm transition-colors duration-200 hover:bg-app-primary/90"
        >
          Add
        </Link>
        {hasSession && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            fullWidth={false}
            className="h-10 px-3"
            onClick={onLogout}
            disabled={loggingOut}
          >
            {loggingOut ? 'Logging out...' : 'Logout'}
          </Button>
        )}
      </div>
    </header>
  );
}
