'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Food', href: '/food' },
  { label: 'Hangouts', href: '/hangouts' },
  { label: 'Profile', href: '/profile' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
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
    <header className="mb-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="text-lg tracking-tight text-app-text">
          <span className="font-semibold">Palate</span>
          <span className="font-semibold text-brand-accent dark:text-brand-accent-dark">AI</span>
        </Link>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/add"
            aria-label="Add"
            data-onboarding-target="add-button"
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
      </div>

      <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-onboarding-target={item.href === '/food' ? 'food-tab' : undefined}
              className={cn(
                'inline-flex h-9 items-center rounded-lg border px-3 text-xs font-medium transition-colors duration-200',
                active
                  ? 'border-app-primary bg-app-primary text-app-primary-text'
                  : 'border-app-border bg-app-card text-app-muted hover:text-app-text',
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
