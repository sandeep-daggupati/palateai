'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
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
    <header className="mb-4 flex items-center justify-between gap-3">
      <Link href="/" className="text-lg font-bold">
        Dish Tracker
      </Link>

      <div className="flex items-center gap-2">
        <Link
          href="/add"
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          + Add
        </Link>
        {hasSession && (
          <Button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            className="w-auto bg-slate-200 px-3 py-2 text-sm text-slate-900 hover:bg-slate-300"
          >
            {loggingOut ? 'Logging out...' : 'Logout'}
          </Button>
        )}
      </div>
    </header>
  );
}
