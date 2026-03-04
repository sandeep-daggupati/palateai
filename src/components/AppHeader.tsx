'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { cn } from '@/lib/utils';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

const NAV_ITEMS = [
  { label: 'Home', href: '/' },
  { label: 'Food', href: '/food' },
  { label: 'Hangouts', href: '/hangouts' },
  { label: 'Add', href: '/add' },
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

type HeaderProfile = {
  displayName: string | null;
  avatarUrl: string | null;
  email: string | null;
};

export function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const [hasSession, setHasSession] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profile, setProfile] = useState<HeaderProfile>({ displayName: null, avatarUrl: null, email: null });
  const menuRef = useRef<HTMLDivElement | null>(null);

  const initial = useMemo(() => {
    const seed = profile.displayName?.trim() || profile.email?.trim() || 'P';
    return seed.charAt(0).toUpperCase();
  }, [profile.displayName, profile.email]);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();

    const hydrateUserState = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setHasSession(Boolean(session));

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setProfile({ displayName: null, avatarUrl: null, email: null });
        return;
      }

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('display_name,avatar_url,email')
        .eq('id', user.id)
        .maybeSingle();

      setProfile({
        displayName: profileRow?.display_name ?? user.user_metadata?.display_name ?? null,
        avatarUrl: profileRow?.avatar_url ?? user.user_metadata?.avatar_url ?? null,
        email: profileRow?.email ?? user.email ?? null,
      });
    };

    void hydrateUserState();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
      void hydrateUserState();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!menuRef.current || !target) return;
      if (!menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const onLogout = async () => {
    setMenuOpen(false);
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
          {hasSession && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                aria-label="Open account menu"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((prev) => !prev)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-app-border bg-app-card text-app-text transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {profile.avatarUrl ? (
                  <Image src={profile.avatarUrl} alt="Avatar" width={40} height={40} className="h-10 w-10 rounded-full object-cover" unoptimized />
                ) : (
                  <span className="text-sm font-semibold">{initial}</span>
                )}
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-app-border bg-app-card p-2 shadow-lg"
                >
                  <div className="px-2 py-1.5">
                    <p className="truncate text-sm font-semibold text-app-text">{profile.displayName?.trim() || 'Your profile'}</p>
                    <p className="truncate text-xs text-app-muted">{profile.email || 'No email available'}</p>
                  </div>
                  <div className="my-1 border-t border-app-border" />
                  <Link
                    href="/profile"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-app-text transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <User size={16} />
                    <span>Profile</span>
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void onLogout()}
                    disabled={loggingOut}
                    className="mt-1 flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm text-app-text transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:hover:bg-neutral-800"
                  >
                    <LogOut size={16} />
                    <span>{loggingOut ? 'Logging out...' : 'Logout'}</span>
                  </button>
                </div>
              ) : null}
            </div>
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
              data-onboarding-target={
                item.href === '/'
                  ? 'home-tab'
                  : item.href === '/food'
                    ? 'food-tab'
                    : item.href === '/hangouts'
                      ? 'hangouts-tab'
                      : item.href === '/add'
                        ? 'add-button'
                      : undefined
              }
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
