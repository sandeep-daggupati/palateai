'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ForYouTodayCard } from '@/components/home/ForYouTodayCard';
import { HighlightsCard } from '@/components/home/HighlightsCard';
import { RecentHangoutsCard } from '@/components/home/RecentHangoutsCard';
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

export default function HomePage() {
  const [hasAnyHangouts, setHasAnyHangouts] = useState(false);
  const [insight, setInsight] = useState<InsightPayload | null>(null);
  const [highlights, setHighlights] = useState<HighlightCard[]>(FALLBACK_HIGHLIGHTS);
  const [hangoutChips, setHangoutChips] = useState<HangoutChip[]>([]);

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
        return;
      }

      await ensureProfile();

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

  return (
    <div className="space-y-2 pb-4">
      <section className="card-surface p-3 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-app-text">What did you eat today?</h1>
          <Link
            href="/add"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-transparent bg-app-primary px-4 text-sm font-semibold text-app-primary-text"
          >
            Add
          </Link>
        </div>
        {!hasAnyHangouts && <p className="text-sm text-app-muted">Upload a receipt, review your dishes, and save the hangout.</p>}
      </section>

      <ForYouTodayCard insight={insight} />

      <HighlightsCard highlights={highlights} />

      <RecentHangoutsCard chips={hangoutChips} />
    </div>
  );
}
