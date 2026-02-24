'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FilterChips } from '@/components/FilterChips';
import { IdentityTagPill } from '@/components/IdentityTagPill';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { ensureProfile } from '@/lib/profile/ensureProfile';
import { DishEntry, DishIdentityTag, ReceiptUpload, ReceiptUploadStatus, Restaurant, VisitParticipant } from '@/lib/supabase/types';

const LIST_LIMIT = 10;

const DISH_FILTER_OPTIONS: Array<{ label: string; value: 'all' | DishIdentityTag; badge?: string }> = [
  { label: 'All', value: 'all' },
  { label: 'GO-TO', value: 'go_to', badge: 'Suggested' },
  { label: 'Hidden Gem', value: 'hidden_gem' },
  { label: 'Special Occasion', value: 'special_occasion' },
  { label: 'Try Again', value: 'try_again' },
  { label: 'Never Again', value: 'never_again' },
];

const ACTIVITY_FILTER_OPTIONS: Array<{ label: string; value: 'all' | ReceiptUploadStatus }> = [
  { label: 'All', value: 'all' },
  { label: 'Needs review', value: 'needs_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Processing', value: 'processing' },
  { label: 'Failed', value: 'failed' },
];

type RestaurantLookup = {
  name: string;
  address: string | null;
};

type InsightEvidenceType = 'dish' | 'restaurant' | 'hangout' | 'summary';

type InsightPayload = {
  insight_text: string;
  evidence_type: InsightEvidenceType;
  evidence: unknown;
  generated_at: string;
  expires_at: string;
};

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function sortByVisitDateDesc(a: ReceiptUpload, b: ReceiptUpload) {
  const aDate = new Date(a.visited_at ?? a.created_at).getTime();
  const bDate = new Date(b.visited_at ?? b.created_at).getTime();
  return bDate - aDate;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readCrewNames(evidence: Record<string, unknown>): string[] {
  const raw = evidence.crew_preview;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry) => (entry && typeof entry === 'object' ? (entry as Record<string, unknown>).display_name : null))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .slice(0, 5);
}

function resolveHangoutPath(type: InsightEvidenceType, evidence: Record<string, unknown>): string | null {
  const raw = type === 'hangout' ? evidence.hangout_id : evidence.last_hangout_id;
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  return `/uploads/${raw}`;
}

export default function HomePage() {
  const [hasAnyVisits, setHasAnyVisits] = useState(false);
  const [dishes, setDishes] = useState<DishEntry[]>([]);
  const [visits, setVisits] = useState<ReceiptUpload[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});
  const [insight, setInsight] = useState<InsightPayload | null>(null);
  const [insightOpen, setInsightOpen] = useState(false);

  const [dishFilter, setDishFilter] = useState<'all' | DishIdentityTag>('all');
  const [activityFilter, setActivityFilter] = useState<'all' | ReceiptUploadStatus>('all');

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setHasAnyVisits(false);
        setDishes([]);
        setVisits([]);
        setRestaurantsById({});
        setInsight(null);
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

      let dishQuery = supabase
        .from('dish_entries')
        .select('id,dish_name,dish_key,restaurant_id,identity_tag,eaten_at,created_at,source_upload_id')
        .eq('user_id', user.id)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);

      if (dishFilter !== 'all') {
        dishQuery = dishQuery.eq('identity_tag', dishFilter);
      }

      let ownVisitQuery = supabase
        .from('receipt_uploads')
        .select('id,user_id,restaurant_id,status,visited_at,created_at,visit_note')
        .eq('user_id', user.id)
        .order('visited_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);

      if (activityFilter !== 'all') {
        ownVisitQuery = ownVisitQuery.eq('status', activityFilter);
      }

      const [{ data: dishRows }, { data: ownVisitRows }, { data: participantRows }] = await Promise.all([
        dishQuery,
        ownVisitQuery,
        supabase
          .from('visit_participants')
          .select('visit_id,status')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .limit(200),
      ]);

      const participantVisitIds = ((participantRows ?? []) as Pick<VisitParticipant, 'visit_id' | 'status'>[])
        .map((row) => row.visit_id)
        .filter((value, index, self) => self.indexOf(value) === index);

      let sharedVisitRows: ReceiptUpload[] = [];
      if (participantVisitIds.length > 0) {
        let sharedVisitQuery = supabase
          .from('receipt_uploads')
          .select('id,user_id,restaurant_id,status,visited_at,created_at,visit_note')
          .in('id', participantVisitIds)
          .order('visited_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(LIST_LIMIT);

        if (activityFilter !== 'all') {
          sharedVisitQuery = sharedVisitQuery.eq('status', activityFilter);
        }

        const { data: sharedRows } = await sharedVisitQuery;
        sharedVisitRows = (sharedRows ?? []) as ReceiptUpload[];
      }

      const mergedVisits = [...((ownVisitRows ?? []) as ReceiptUpload[]), ...sharedVisitRows]
        .filter((row, index, self) => self.findIndex((entry) => entry.id === row.id) === index)
        .sort(sortByVisitDateDesc)
        .slice(0, LIST_LIMIT);

      const parsedDishes = (dishRows ?? []) as DishEntry[];

      const restaurantIds = Array.from(
        new Set(
          [...parsedDishes, ...mergedVisits]
            .map((row) => row.restaurant_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      let restaurantLookup: Record<string, RestaurantLookup> = {};
      if (restaurantIds.length > 0) {
        const { data: restaurantRows } = await supabase
          .from('restaurants')
          .select('id,name,address')
          .in('id', restaurantIds);

        restaurantLookup = ((restaurantRows ?? []) as Pick<Restaurant, 'id' | 'name' | 'address'>[]).reduce(
          (acc, row) => {
            acc[row.id] = {
              name: row.name,
              address: row.address,
            };
            return acc;
          },
          {} as Record<string, RestaurantLookup>,
        );
      }

      setHasAnyVisits(mergedVisits.length > 0);
      setDishes(parsedDishes);
      setVisits(mergedVisits);
      setRestaurantsById(restaurantLookup);
    };

    void load();
  }, [activityFilter, dishFilter]);

  const dishRows = useMemo(
    () =>
      dishes.map((dish) => ({
        ...dish,
        restaurantName: dish.restaurant_id ? restaurantsById[dish.restaurant_id]?.name ?? 'Unknown restaurant' : 'Unknown restaurant',
        dateLabel: formatDate(dish.eaten_at ?? dish.created_at),
      })),
    [dishes, restaurantsById],
  );

  const hangoutRows = useMemo(
    () =>
      visits.map((visit) => ({
        ...visit,
        restaurantName: visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.name ?? 'Unknown restaurant' : 'Unknown restaurant',
        address: visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.address ?? null : null,
        dateLabel: formatDate(visit.visited_at ?? visit.created_at),
      })),
    [restaurantsById, visits],
  );

  const evidence = insight ? asRecord(insight.evidence) : {};
  const crewNames = readCrewNames(evidence);
  const hangoutPath = insight ? resolveHangoutPath(insight.evidence_type, evidence) : null;

  return (
    <div className="space-y-4 pb-6">
      <section className="card-surface space-y-3">
        <h1 className="text-xl font-semibold text-app-text">What did you eat today?</h1>
        <Link
          href="/add"
          className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-transparent bg-app-primary px-4 text-sm font-semibold text-app-primary-text shadow-sm transition-colors duration-200 hover:bg-app-primary/90"
        >
          Add
        </Link>

        {!hasAnyVisits && <p className="text-sm text-app-muted">Upload a receipt, review your dishes, and save the hangout.</p>}
      </section>

      {insight && (
        <button type="button" className="card-surface w-full space-y-2 text-left" onClick={() => setInsightOpen(true)}>
          <p className="section-label">For you today</p>
          <p className="text-xs text-app-muted">Based on your logs</p>
          <p className="text-sm text-app-text">{insight.insight_text}</p>
        </button>
      )}

      {insightOpen && insight && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setInsightOpen(false)} />

          <div className="relative w-full max-w-3xl rounded-t-2xl border border-app-border bg-app-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-app-text">Why this?</h2>
              <button type="button" className="rounded-lg border border-app-border px-2 py-1 text-xs text-app-text" onClick={() => setInsightOpen(false)}>
                Close
              </button>
            </div>

            <p className="mb-3 text-sm text-app-text">{insight.insight_text}</p>

            {insight.evidence_type === 'dish' && (
              <div className="space-y-2 rounded-xl border border-app-border p-3 text-sm text-app-text">
                <p><span className="text-app-muted">Dish:</span> {typeof evidence.dish_name === 'string' ? evidence.dish_name : 'Unknown dish'}</p>
                <p><span className="text-app-muted">Frequency:</span> {typeof evidence.frequency === 'number' ? evidence.frequency : 0} times in 30 days</p>
                <p><span className="text-app-muted">Last hangout:</span> {typeof evidence.last_hangout_date === 'string' ? evidence.last_hangout_date : 'Unknown date'}</p>
                {crewNames.length > 0 && <p><span className="text-app-muted">Crew:</span> {crewNames.join(', ')}</p>}
              </div>
            )}

            {insight.evidence_type === 'restaurant' && (
              <div className="space-y-2 rounded-xl border border-app-border p-3 text-sm text-app-text">
                <p><span className="text-app-muted">Restaurant:</span> {typeof evidence.restaurant_name === 'string' ? evidence.restaurant_name : 'Unknown restaurant'}</p>
                <p><span className="text-app-muted">Hangouts:</span> {typeof evidence.hangout_count === 'number' ? evidence.hangout_count : 0} in 30 days</p>
                <p><span className="text-app-muted">Last hangout:</span> {typeof evidence.last_hangout_date === 'string' ? evidence.last_hangout_date : 'Unknown date'}</p>
                {crewNames.length > 0 && <p><span className="text-app-muted">Crew:</span> {crewNames.join(', ')}</p>}
              </div>
            )}

            {insight.evidence_type === 'hangout' && (
              <div className="space-y-2 rounded-xl border border-app-border p-3 text-sm text-app-text">
                <p><span className="text-app-muted">Restaurant:</span> {typeof evidence.restaurant_name === 'string' ? evidence.restaurant_name : 'Unknown restaurant'}</p>
                <p><span className="text-app-muted">Date:</span> {typeof evidence.hangout_date === 'string' ? evidence.hangout_date : 'Unknown date'}</p>
                {typeof evidence.top_dish === 'string' && <p><span className="text-app-muted">Top dish:</span> {evidence.top_dish}</p>}
                {crewNames.length > 0 && <p><span className="text-app-muted">Crew:</span> {crewNames.join(', ')}</p>}
              </div>
            )}

            {insight.evidence_type === 'summary' && (
              <div className="space-y-2 rounded-xl border border-app-border p-3 text-sm text-app-text">
                {Array.isArray(evidence.metrics) &&
                  evidence.metrics.slice(0, 3).map((entry, index) => {
                    const row = asRecord(entry);
                    const label = typeof row.label === 'string' ? row.label : `Metric ${index + 1}`;
                    const value = typeof row.value === 'number' || typeof row.value === 'string' ? row.value : 0;
                    return (
                      <p key={`${label}-${index}`}>
                        <span className="text-app-muted">{label}:</span> {value}
                      </p>
                    );
                  })}
              </div>
            )}

            {hangoutPath && (
              <div className="mt-3">
                <Link
                  href={hangoutPath}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-transparent bg-app-primary px-4 text-sm font-semibold text-app-primary-text"
                  onClick={() => setInsightOpen(false)}
                >
                  Open hangout
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="section-label">Recent Dishes</h2>
        <FilterChips options={DISH_FILTER_OPTIONS} selected={dishFilter} onChange={setDishFilter} />
        {dishRows.length === 0 ? (
          <p className="empty-surface">No dishes yet.</p>
        ) : (
          <div className="divide-y divide-app-border rounded-2xl border border-app-border bg-app-card">
            {dishRows.map((dish) => (
              <Link key={dish.id} href={dish.dish_key ? `/dishes/${dish.dish_key}` : `/uploads/${dish.source_upload_id}`} className="block px-3 py-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="font-medium text-app-text">{dish.dish_name}</p>
                  {dish.identity_tag && <IdentityTagPill tag={dish.identity_tag} />}
                </div>
                <p className="text-sm text-app-muted">{dish.restaurantName}</p>
                <p className="text-xs text-app-muted">{dish.dateLabel}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="section-label">Recent Hangouts</h2>
        <FilterChips options={ACTIVITY_FILTER_OPTIONS} selected={activityFilter} onChange={setActivityFilter} />
        {hangoutRows.length === 0 ? (
          <p className="empty-surface">No hangouts yet.</p>
        ) : (
          <div className="divide-y divide-app-border rounded-2xl border border-app-border bg-app-card">
            {hangoutRows.map((visit) => (
              <Link key={visit.id} href={`/uploads/${visit.id}`} className="block px-3 py-3">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="font-medium text-app-text">{visit.restaurantName}</p>
                  <StatusChip status={visit.status} />
                </div>
                {visit.address && <p className="text-xs text-app-muted">{visit.address}</p>}
                <p className="text-xs text-app-muted">{visit.dateLabel}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
