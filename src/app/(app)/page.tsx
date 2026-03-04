'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  onboarded: boolean;
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
  onSave,
}: {
  open: boolean;
  loading: boolean;
  initialValue: string;
  onSave: (value: string) => Promise<void>;
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
        <p className="mt-1 text-sm text-app-muted">Set your display name to continue.</p>
        <div className="mt-3 space-y-2">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={60}
            placeholder="Your display name"
          />
          <Button
            type="button"
            disabled={loading || displayName.trim().length === 0}
            onClick={() => void onSave(displayName)}
          >
            {loading ? 'Saving...' : 'Continue'}
          </Button>
        </div>
      </section>
    </div>
  );
}

function OnboardingOverlay({
  open,
  step,
  onNext,
  onFinish,
}: {
  open: boolean;
  step: 1 | 2 | 3 | 4 | 5;
  onNext: () => void;
  onFinish: () => Promise<void>;
}) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      setTargetRect(null);
      return;
    }

    const selectorByStep: Partial<Record<1 | 2 | 3 | 4 | 5, string>> = {
      2: '[data-onboarding-target="add-button"]',
      3: '[data-onboarding-target="home-tab"]',
      4: '[data-onboarding-target="food-tab"]',
      5: '[data-onboarding-target="hangouts-tab"]',
    };

    const selector = selectorByStep[step];
    if (!selector) {
      setTargetRect(null);
      return;
    }

    const updateRect = () => {
      const target = document.querySelector(selector) as HTMLElement | null;
      setTargetRect(target?.getBoundingClientRect() ?? null);
    };

    updateRect();
    const raf = window.requestAnimationFrame(updateRect);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [open, step]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65]">
      <div className="absolute inset-0 bg-black/45" />
      {targetRect ? (
        <div
          className="pointer-events-none absolute rounded-xl border-2 border-app-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
          style={{
            left: `${targetRect.left}px`,
            top: `${targetRect.top}px`,
            width: `${targetRect.width}px`,
            height: `${targetRect.height}px`,
          }}
        />
      ) : null}

      <section className="absolute bottom-3 left-3 right-3 rounded-2xl border border-app-border bg-app-card p-3 sm:left-auto sm:right-4 sm:w-[360px]">
        {step === 1 ? (
          <>
            <p className="text-base font-semibold text-app-text">Welcome</p>
            <p className="mt-1 text-sm text-app-muted">
              PalateAI helps you capture meals, spot patterns, and revisit your best food moments.
            </p>
            <Button type="button" className="mt-3" onClick={onNext}>
              Next
            </Button>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="text-base font-semibold text-app-text">Start with Add</p>
            <p className="mt-1 text-sm text-app-muted">Tap Add to log your next meal or hangout.</p>
            <Button type="button" className="mt-3" onClick={onNext}>
              Next
            </Button>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <p className="text-base font-semibold text-app-text">Home tab</p>
            <p className="mt-1 text-sm text-app-muted">Your Home tab is where highlights and insights live.</p>
            <Button type="button" className="mt-3" onClick={onNext}>
              Next
            </Button>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <p className="text-base font-semibold text-app-text">Food tab</p>
            <p className="mt-1 text-sm text-app-muted">Use Food to explore your logged dishes and patterns.</p>
            <Button type="button" className="mt-3" onClick={onNext}>
              Next
            </Button>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <p className="text-base font-semibold text-app-text">Hangouts tab</p>
            <p className="mt-1 text-sm text-app-muted">Hangouts helps you revisit each meal session with context.</p>
            <Button type="button" className="mt-3" onClick={() => void onFinish()}>
              Finish
            </Button>
          </>
        ) : null}
      </section>
    </div>
  );
}

export default function HomePage() {
  const [hasAnyHangouts, setHasAnyHangouts] = useState(false);
  const [insight, setInsight] = useState<InsightPayload | null>(null);
  const [highlights, setHighlights] = useState<HighlightCard[]>(FALLBACK_HIGHLIGHTS);
  const [hangoutChips, setHangoutChips] = useState<HangoutChip[]>([]);
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const onboardingStepRef = useRef<1 | 2 | 3 | 4 | 5>(1);

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setHasAnyHangouts(false);
        setInsight(null);
        setHighlights(FALLBACK_HIGHLIGHTS);
        setHangoutChips([]);
        setProfile(null);
        return;
      }

      await ensureProfile();

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('id,display_name,onboarded')
        .eq('id', user.id)
        .maybeSingle();

      setProfile((profileRow ?? null) as ProfileState | null);

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

      const [highlightCards, chipPayload] = await Promise.all([
        getHighlights(supabase, user.id),
        getHangoutChips(supabase, user.id),
      ]);

      setHighlights(highlightCards.slice(0, 3));
      setHangoutChips(chipPayload.chips);
      setHasAnyHangouts(chipPayload.hasHangouts);
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
      .update({ display_name: next, updated_at: new Date().toISOString() })
      .eq('id', profile.id);

    if (!error) {
      setProfile((current) => (current ? { ...current, display_name: next } : current));
    }
    setSavingDisplayName(false);
  };

  const finishOnboarding = async () => {
    if (!profile) return;

    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase
      .from('profiles')
      .update({ onboarded: true, updated_at: new Date().toISOString() })
      .eq('id', profile.id);

    if (!error) {
      setProfile((current) => (current ? { ...current, onboarded: true } : current));
    }
  };

  const displayName = profile?.display_name?.trim() ?? '';
  const showDisplayNameGate = Boolean(profile) && !displayName;
  const showOnboarding = Boolean(profile) && !showDisplayNameGate && !(profile?.onboarded ?? true);

  useEffect(() => {
    if (showOnboarding) {
      setOnboardingStep(1);
    }
  }, [showOnboarding]);

  useEffect(() => {
    onboardingStepRef.current = onboardingStep;
  }, [onboardingStep]);

  useEffect(() => {
    if (!showOnboarding || typeof window === 'undefined') return;

    const marker = { onboarding: true };
    window.history.pushState(marker, '');

    const onPopState = () => {
      const current = onboardingStepRef.current;
      if (current > 1) {
        setOnboardingStep((prev) => (prev > 1 ? ((prev - 1) as 1 | 2 | 3 | 4 | 5) : prev));
      }
      window.history.pushState(marker, '');
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [showOnboarding]);

  const heading = useMemo(() => {
    if (displayName) return `Welcome back, ${displayName}.`;
    return 'What did you eat today?';
  }, [displayName]);

  return (
    <>
      <div className="space-y-2 pb-4">
        <section className="card-surface p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-app-text">{heading}</h1>
              {displayName ? <p className="text-sm text-app-muted">What did you eat today?</p> : null}
            </div>
            <Link
              href="/add"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-transparent bg-app-primary px-4 text-sm font-semibold text-app-primary-text"
            >
              Add
            </Link>
          </div>
          {!hasAnyHangouts && <p className="text-sm text-app-muted">Upload a receipt, review your food items, and save the hangout.</p>}
        </section>

        <ForYouTodayCard insight={insight} />

        <HighlightsCard highlights={highlights} />

        <RecentHangoutsCard chips={hangoutChips} />
      </div>

      <DisplayNameGate
        open={showDisplayNameGate}
        loading={savingDisplayName}
        initialValue={displayName}
        onSave={saveDisplayName}
      />

      <OnboardingOverlay
        open={showOnboarding}
        step={onboardingStep}
        onNext={() => setOnboardingStep((prev) => (prev < 5 ? ((prev + 1) as 1 | 2 | 3 | 4 | 5) : prev))}
        onFinish={finishOnboarding}
      />
    </>
  );
}
