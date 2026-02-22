'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { RatingStars } from '@/components/RatingStars';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, ReceiptUpload, Restaurant } from '@/lib/supabase/types';

const RECENT_DISHES_LIMIT = 10;
const RECENT_VISITS_LIMIT = 10;
const NEEDS_REVIEW_LIMIT = 10;
const INSIGHTS_WINDOW = 20;

type VisitSummary = {
  upload: ReceiptUpload;
  itemCount: number;
};

type RestaurantLookup = {
  name: string;
  address: string | null;
};

function formatPrice(entry: DishEntry): string {
  if (entry.price_usd !== null) {
    return `$${entry.price_usd.toFixed(2)} USD`;
  }

  if (entry.price_original !== null) {
    return `${entry.currency_original} ${entry.price_original.toFixed(2)}`;
  }

  return 'Price unavailable';
}

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleString();
}

function truncate(value: string, max = 90): string {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

function normalizeDishName(value: string): string {
  return value.trim().toLowerCase();
}

export default function HomePage() {
  const [uploads, setUploads] = useState<ReceiptUpload[]>([]);
  const [entrySample, setEntrySample] = useState<DishEntry[]>([]);
  const [visitSample, setVisitSample] = useState<VisitSummary[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});
  const [showWhy, setShowWhy] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUploads([]);
        setEntrySample([]);
        setVisitSample([]);
        setRestaurantsById({});
        return;
      }

      const { data: uploadData } = await supabase
        .from('receipt_uploads')
        .select('id,status,created_at')
        .eq('user_id', user.id)
        .eq('status', 'needs_review')
        .order('created_at', { ascending: false })
        .limit(NEEDS_REVIEW_LIMIT);

      const { data: entryData } = await supabase
        .from('dish_entries')
        .select('id,dish_name,dish_key,restaurant_id,price_original,currency_original,price_usd,eaten_at,created_at,rating,comment')
        .eq('user_id', user.id)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(INSIGHTS_WINDOW);

      const { data: visitData } = await supabase
        .from('receipt_uploads')
        .select('id,restaurant_id,status,visited_at,created_at,visit_rating,visit_note')
        .eq('user_id', user.id)
        .not('restaurant_id', 'is', null)
        .order('visited_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(INSIGHTS_WINDOW);

      const uploadRows = (uploadData ?? []) as ReceiptUpload[];
      const entryRows = (entryData ?? []) as DishEntry[];
      const visitRows = (visitData ?? []) as ReceiptUpload[];

      const visitIds = visitRows.map((visit) => visit.id);

      const [dishForVisits, extractedForVisits] = await Promise.all([
        visitIds.length
          ? supabase
              .from('dish_entries')
              .select('source_upload_id')
              .eq('user_id', user.id)
              .in('source_upload_id', visitIds)
          : Promise.resolve({ data: [] }),
        visitIds.length
          ? supabase
              .from('extracted_line_items')
              .select('upload_id')
              .in('upload_id', visitIds)
          : Promise.resolve({ data: [] }),
      ]);

      const dishCountByUploadId = ((dishForVisits.data ?? []) as Array<{ source_upload_id: string }>).reduce(
        (acc, row) => {
          acc[row.source_upload_id] = (acc[row.source_upload_id] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const extractedCountByUploadId = ((extractedForVisits.data ?? []) as Array<{ upload_id: string }>).reduce(
        (acc, row) => {
          acc[row.upload_id] = (acc[row.upload_id] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      const visitSummaries: VisitSummary[] = visitRows.map((visit) => ({
        upload: visit,
        itemCount: dishCountByUploadId[visit.id] ?? extractedCountByUploadId[visit.id] ?? 0,
      }));

      const restaurantIds = Array.from(
        new Set(
          [...entryRows, ...visitRows]
            .map((row) => row.restaurant_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      let restaurantLookup: Record<string, RestaurantLookup> = {};

      if (restaurantIds.length) {
        const { data: restaurantRows } = await supabase
          .from('restaurants')
          .select('id,name,address')
          .eq('user_id', user.id)
          .in('id', restaurantIds);

        restaurantLookup = ((restaurantRows ?? []) as Pick<Restaurant, 'id' | 'name' | 'address'>[]).reduce(
          (acc, restaurant) => {
            acc[restaurant.id] = {
              name: restaurant.name,
              address: restaurant.address,
            };
            return acc;
          },
          {} as Record<string, RestaurantLookup>,
        );
      }

      setUploads(uploadRows);
      setEntrySample(entryRows);
      setVisitSample(visitSummaries);
      setRestaurantsById(restaurantLookup);
    };

    void load();
  }, []);

  const entries = useMemo(() => entrySample.slice(0, RECENT_DISHES_LIMIT), [entrySample]);

  const visitsSorted = useMemo(
    () =>
      [...visitSample]
        .sort((a, b) => {
          const aDate = a.upload.visited_at ?? a.upload.created_at;
          const bDate = b.upload.visited_at ?? b.upload.created_at;
          return new Date(bDate).getTime() - new Date(aDate).getTime();
        })
        .slice(0, RECENT_VISITS_LIMIT),
    [visitSample],
  );

  const insights = useMemo(() => {
    if (entrySample.length === 0) {
      return {
        topRated: null as string | null,
        mostRepeated: null as string | null,
        mostVisited: null as string | null,
      };
    }

    const rated = entrySample.filter((entry) => entry.rating != null);
    const topRated = rated
      .slice()
      .sort((a, b) => {
        const ratingDiff = (b.rating ?? 0) - (a.rating ?? 0);
        if (ratingDiff !== 0) return ratingDiff;
        const aDate = new Date(a.eaten_at ?? a.created_at).getTime();
        const bDate = new Date(b.eaten_at ?? b.created_at).getTime();
        return bDate - aDate;
      })[0];

    const dishCounts = entrySample.reduce((acc, entry) => {
      const key = entry.dish_key || normalizeDishName(entry.dish_name);
      const current = acc[key] ?? { count: 0, label: entry.dish_name };
      acc[key] = { count: current.count + 1, label: current.label };
      return acc;
    }, {} as Record<string, { count: number; label: string }>);

    const mostRepeatedEntry = Object.values(dishCounts).sort((a, b) => b.count - a.count)[0];

    const visitCounts = visitSample.reduce((acc, visit) => {
      if (!visit.upload.restaurant_id) return acc;
      acc[visit.upload.restaurant_id] = (acc[visit.upload.restaurant_id] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const mostVisitedId = Object.entries(visitCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const mostVisitedCount = mostVisitedId ? visitCounts[mostVisitedId] : 0;

    return {
      topRated: topRated ? `${topRated.dish_name} (${topRated.rating}/5)` : null,
      mostRepeated: mostRepeatedEntry ? `${mostRepeatedEntry.label} (${mostRepeatedEntry.count}x)` : null,
      mostVisited:
        mostVisitedId && restaurantsById[mostVisitedId]
          ? `${restaurantsById[mostVisitedId].name} (${mostVisitedCount} visits)`
          : null,
    };
  }, [entrySample, visitSample, restaurantsById]);

  return (
    <div className="space-y-6 pb-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-app-muted">Needs review</h2>
        {uploads.length === 0 ? (
          <p className="empty-surface">No uploads waiting for review.</p>
        ) : (
          uploads.map((upload) => (
            <Link key={upload.id} href={`/uploads/${upload.id}`} className="card-surface block">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium">Upload {upload.id.slice(0, 8)}</p>
                <StatusChip status={upload.status} />
              </div>
              <p className="text-xs text-app-muted">{formatDate(upload.created_at)}</p>
            </Link>
          ))
        )}
      </section>

      <section className="space-y-3">
        <div className="card-surface space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Insights</p>
          <p className="text-sm text-app-muted">
            Recent dishes are your last logged items. Use them to quickly revisit what you liked and spot patterns over time.
          </p>
          <button
            type="button"
            className="w-fit text-xs font-medium text-app-text underline underline-offset-2"
            onClick={() => setShowWhy((value) => !value)}
          >
            {showWhy ? 'Hide why this matters' : 'Why this matters?'}
          </button>
          {showWhy && (
            <p className="text-xs text-app-muted">
              This helps PalateAI learn your preferences and highlight favorites.
            </p>
          )}
          <div className="space-y-1 text-sm text-app-muted">
            <p>Top rated recently: {insights.topRated ?? '--'}</p>
            <p>Most repeated dish: {insights.mostRepeated ?? '--'}</p>
            <p>Most visited recently: {insights.mostVisited ?? '--'}</p>
          </div>
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-app-muted">Recent dishes</h2>
        {entries.length === 0 ? (
          <p className="empty-surface">No dishes yet. Upload a receipt or menu to start your tasting journal.</p>
        ) : (
          entries.map((entry) => {
            const eatenAt = entry.eaten_at ?? entry.created_at;
            const restaurant = entry.restaurant_id ? restaurantsById[entry.restaurant_id] : null;

            return (
              <Link key={entry.id} href={`/dishes/${entry.dish_key}`} className="card-surface block">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="font-medium">{entry.dish_name}</p>
                  <RatingStars value={entry.rating} size="sm" showEmpty />
                </div>
                <p className="text-sm text-app-muted">{restaurant?.name ?? 'Unknown restaurant'}</p>
                <p className="text-sm text-app-muted">{formatPrice(entry)}</p>
                {entry.comment && <p className="text-xs text-app-muted">{truncate(entry.comment)}</p>}
                <p className="text-xs text-app-muted">{formatDate(eatenAt)}</p>
              </Link>
            );
          })
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-app-muted">Recent restaurant visits</h2>
        {visitsSorted.length === 0 ? (
          <p className="empty-surface">No visits recorded yet.</p>
        ) : (
          visitsSorted.map(({ upload, itemCount }) => {
            const restaurant = upload.restaurant_id ? restaurantsById[upload.restaurant_id] : null;
            const visitDate = upload.visited_at ?? upload.created_at;

            return (
              <Link key={upload.id} href={`/uploads/${upload.id}`} className="card-surface block">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-medium">{restaurant?.name ?? 'Unknown restaurant'}</p>
                  <StatusChip status={upload.status} />
                </div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-sm text-app-muted">{formatDate(visitDate)}</p>
                  <RatingStars value={upload.visit_rating} size="sm" showEmpty />
                </div>
                {restaurant?.address && <p className="text-xs text-app-muted">{restaurant.address}</p>}
                {upload.visit_note && <p className="text-xs text-app-muted">{truncate(upload.visit_note)}</p>}
                <p className="text-xs text-app-muted">{itemCount} extracted item{itemCount === 1 ? '' : 's'}</p>
              </Link>
            );
          })
        )}
      </section>
    </div>
  );
}
