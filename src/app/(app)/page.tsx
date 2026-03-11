'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ForYouTodayCard } from '@/components/home/ForYouTodayCard';
import { HighlightsCard } from '@/components/home/HighlightsCard';
import { RecentHangoutsCard } from '@/components/home/RecentHangoutsCard';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { ensureProfile } from '@/lib/profile/ensureProfile';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { getHighlights, HighlightCard } from '@/lib/home/getHighlights';
import { getHangoutChips, HangoutChip } from '@/lib/home/getHangoutChips';

type InsightPayload = {
  category?: 'palate' | 'explore' | 'spend' | 'wildcard';
  insight_type?: string;
  insight_text: string;
  evidence_type?: 'dish' | 'restaurant' | 'hangout' | 'summary';
  evidence?: unknown;
  metadata?: unknown;
  generated_at: string;
  expires_at?: string;
  insight_date?: string;
};

type ProfileState = {
  id: string;
  display_name: string | null;
  onboarding_completed: boolean;
};

const FALLBACK_HIGHLIGHTS: HighlightCard[] = [
  {
    key: 'standout',
    title: 'Standout this week',
    body: 'Log a hangout to unlock highlights.',
    hint: 'Start with your first recap',
    href: '/add',
    image_label: 'S',
  },
  {
    key: 'repeat',
    title: 'On repeat',
    body: 'Your repeats will show up here.',
    hint: 'Patterns update as you log',
    href: '/food',
    image_label: 'R',
  },
  {
    key: 'memory',
    title: 'Still thinking about...',
    body: 'Memories will show up here.',
    hint: 'Keep logging hangouts',
    href: '/hangouts',
    image_label: 'M',
  },
];

function DisplayNameGate({
  open,
  loading,
  initialValue,
  onContinue,
  onSkip,
}: {
  open: boolean;
  loading: boolean;
  initialValue: string;
  onContinue: (value: string) => Promise<void>;
  onSkip: () => void;
}) {
  const [displayName, setDisplayName] = useState(initialValue);

  useEffect(() => {
    setDisplayName(initialValue);
  }, [initialValue]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/45" />
      <section className="relative z-10 w-full rounded-t-2xl border border-app-border bg-app-card p-4 sm:max-w-md sm:rounded-2xl">
        <p className="text-base font-semibold text-app-text">Welcome to PalateAI</p>
        <p className="mt-1 text-sm text-app-muted">What should your friends call you here?</p>
        <div className="mt-3 space-y-2">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={60}
            placeholder="Display name"
          />
          <p className="text-xs text-app-muted">This is how you&apos;ll appear in hangouts and when friends search for you.</p>
          <Button type="button" disabled={loading || displayName.trim().length === 0} onClick={() => void onContinue(displayName)}>
            {loading ? 'Saving...' : 'Continue'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={onSkip}
          >
            Skip for now
          </Button>
        </div>
      </section>
    </div>
  );
}

export default function HomePage() {
  const [loadingHome, setLoadingHome] = useState(true);
  const [hasFoodEntries, setHasFoodEntries] = useState(false);
  const [hasCreatedHangouts, setHasCreatedHangouts] = useState(false);
  const [insight, setInsight] = useState<InsightPayload | null>(null);
  const [highlights, setHighlights] = useState<HighlightCard[]>(FALLBACK_HIGHLIGHTS);
  const [hangoutChips, setHangoutChips] = useState<HangoutChip[]>([]);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [googleNameSuggestion, setGoogleNameSuggestion] = useState('');
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [savingDisplayName, setSavingDisplayName] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const supabase = getBrowserSupabaseClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setHasFoodEntries(false);
          setHasCreatedHangouts(false);
          setInsight(null);
          setHighlights(FALLBACK_HIGHLIGHTS);
          setHangoutChips([]);
          setProfile(null);
          setGoogleNameSuggestion('');
          setSetupDismissed(false);
          return;
        }

        const metadataNameCandidates = [user.user_metadata?.full_name, user.user_metadata?.name, user.user_metadata?.user_name]
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0);
        setGoogleNameSuggestion(metadataNameCandidates[0] ?? '');

        await ensureProfile();

        const { data: profileRow } = await supabase
          .from('profiles')
          .select('id,display_name,onboarding_completed,onboarded')
          .eq('id', user.id)
          .maybeSingle();

        const nextProfile = profileRow
          ? {
              id: profileRow.id,
              display_name: profileRow.display_name,
              onboarding_completed: Boolean(
                (profileRow as { onboarding_completed?: boolean | null }).onboarding_completed ??
                  (profileRow as { onboarded?: boolean | null }).onboarded ??
                  false,
              ),
            }
          : {
              id: user.id,
              display_name: null,
              onboarding_completed: false,
            };

        setProfile(nextProfile);

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (session?.access_token) {
          await fetch('/api/visits/claim', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }).catch(() => undefined);

          const insightResponse = await fetch('/api/insight', {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }).catch(() => null);

          if (insightResponse?.ok) {
            const payload = (await insightResponse.json().catch(() => null)) as { insight?: InsightPayload } | null;
            setInsight(payload?.insight ?? null);
          }
        }

        const [highlightCards, chipPayload, entryProbe, createdHangoutProbe] = await Promise.all([
          getHighlights(supabase, user.id),
          getHangoutChips(supabase, user.id),
          supabase.from('dish_entries').select('id').eq('user_id', user.id).limit(1),
          supabase.from('receipt_uploads').select('id').eq('user_id', user.id).limit(1),
        ]);

        const foodCount = ((entryProbe.data ?? []) as Array<{ id: string }>).length;
        const createdHangoutCount = ((createdHangoutProbe.data ?? []) as Array<{ id: string }>).length;

        setHighlights(highlightCards.slice(0, 3));
        setHangoutChips(chipPayload.chips);
        setHasFoodEntries(foodCount > 0);
        setHasCreatedHangouts(createdHangoutCount > 0);

        if (nextProfile && !nextProfile.onboarding_completed && (createdHangoutCount > 0 || foodCount > 0)) {
          const { error } = await supabase
            .from('profiles')
            .update({ onboarding_completed: true, onboarded: true, updated_at: new Date().toISOString() })
            .eq('id', nextProfile.id);

          if (!error) {
            setProfile((current) => (current ? { ...current, onboarding_completed: true } : current));
          }
        }
      } catch {
        setHasFoodEntries(false);
        setHasCreatedHangouts(false);
        setInsight(null);
        setHighlights(FALLBACK_HIGHLIGHTS);
        setHangoutChips([]);
      } finally {
        setLoadingHome(false);
      }
    };

    void load();
  }, []);

  const saveDisplayName = async (value: string) => {
    if (!profile) return;

    const next = value.trim();
    if (!next) return;

    setSavingDisplayName(true);
    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: next, onboarding_completed: true, onboarded: true, updated_at: new Date().toISOString() })
      .eq('id', profile.id);

    if (!error) {
      setProfile((current) => (current ? { ...current, display_name: next, onboarding_completed: true } : current));
    }
    setSavingDisplayName(false);
  };

  const skipDisplayNameSetup = () => {
    setSetupDismissed(true);
  };

  const displayName = profile?.display_name?.trim() ?? '';
  const setupInitialValue = displayName || googleNameSuggestion;
  const showDisplayNameGate = Boolean(profile) && !setupDismissed && (!displayName || !(profile?.onboarding_completed ?? false));
  const isFirstTimeUser = Boolean(profile) && !(profile?.onboarding_completed ?? false) && !hasCreatedHangouts && !hasFoodEntries;
  const showZeroStateHome = isFirstTimeUser;

  const heroHeading = useMemo(() => {
    if (hasFoodEntries && displayName) return `Welcome back, ${displayName}.`;
    if (hasFoodEntries) return 'Welcome back.';
    return 'Welcome to PalateAI';
  }, [displayName, hasFoodEntries]);

  if (loadingHome) {
    return (
      <div className="space-y-3 pb-4">
        <section className="card-surface h-24 animate-pulse" />
        <section className="card-surface h-40 animate-pulse" />
        <section className="card-surface h-24 animate-pulse" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2 pb-4">
        {showZeroStateHome ? (
          <>
            <section className="space-y-1.5 py-1">
              <h1 className="text-xl font-semibold text-app-text">Welcome to PalateAI</h1>
              <p className="text-sm text-app-muted">Your personal food memory.</p>
            </section>

            <section className="card-surface space-y-3">
              <p className="text-base font-semibold text-app-text">What did you eat today?</p>
              <div className="space-y-2">
                <Link
                  href="/add?mode=receipt"
                  className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-transparent bg-app-primary px-4 text-sm font-semibold text-app-primary-text"
                >
                  Scan receipt
                </Link>
                <Link
                  href="/add?mode=food_photo"
                  className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-app-border bg-app-card px-4 text-sm font-semibold text-app-text"
                >
                  Add food photo
                </Link>
              </div>
            </section>

            <section className="grid gap-2">
              <article className="card-surface space-y-1.5">
                <p className="text-sm font-semibold text-app-text">Scan receipts to log hangouts.</p>
              </article>
              <article className="card-surface space-y-1.5">
                <p className="text-sm font-semibold text-app-text">Save food you loved.</p>
              </article>
              <article className="card-surface space-y-1.5">
                <p className="text-sm font-semibold text-app-text">Tag friends and remember great meals.</p>
              </article>
            </section>
          </>
        ) : (
          <>
            <section className="space-y-1.5 py-1">
              <h1 className="text-xl font-semibold text-app-text">{heroHeading}</h1>
              <p className="text-sm text-app-muted">{hasFoodEntries ? 'What did you eat today?' : 'Start building your food story.'}</p>
              <div className="pt-1">
                <Link
                  href="/add"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-transparent bg-app-primary px-4 text-sm font-semibold text-app-primary-text"
                >
                  {hasFoodEntries ? 'Add a meal' : 'Add your first meal'}
                </Link>
              </div>
              {!hasFoodEntries ? <p className="text-xs text-app-muted">Log a dish, scan a receipt, or add a photo.</p> : null}
            </section>

            <ForYouTodayCard insight={insight} />

            <HighlightsCard highlights={highlights} />

            <RecentHangoutsCard chips={hangoutChips} />
          </>
        )}
      </div>

      <DisplayNameGate
        open={showDisplayNameGate}
        loading={savingDisplayName}
        initialValue={setupInitialValue}
        onContinue={saveDisplayName}
        onSkip={skipDisplayNameSetup}
      />
    </>
  );
}
