'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, ReceiptUpload, Restaurant } from '@/lib/supabase/types';

const RECENT_DISHES_LIMIT = 10;
const RECENT_VISITS_LIMIT = 10;
const NEEDS_REVIEW_LIMIT = 10;

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

export default function HomePage() {
  const [uploads, setUploads] = useState<ReceiptUpload[]>([]);
  const [entries, setEntries] = useState<DishEntry[]>([]);
  const [visits, setVisits] = useState<VisitSummary[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setUploads([]);
        setEntries([]);
        setVisits([]);
        setRestaurantsById({});
        return;
      }

      const { data: uploadData } = await supabase
        .from('receipt_uploads')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'needs_review')
        .order('created_at', { ascending: false })
        .limit(NEEDS_REVIEW_LIMIT);

      const { data: entryData } = await supabase
        .from('dish_entries')
        .select('*')
        .eq('user_id', user.id)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(RECENT_DISHES_LIMIT);

      const { data: visitData } = await supabase
        .from('receipt_uploads')
        .select('*')
        .eq('user_id', user.id)
        .not('restaurant_id', 'is', null)
        .order('visited_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(RECENT_VISITS_LIMIT);

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
      setEntries(entryRows);
      setVisits(visitSummaries);
      setRestaurantsById(restaurantLookup);
    };

    void load();
  }, []);

  const visitsSorted = useMemo(
    () =>
      [...visits].sort((a, b) => {
        const aDate = a.upload.visited_at ?? a.upload.created_at;
        const bDate = b.upload.visited_at ?? b.upload.created_at;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      }),
    [visits],
  );

  return (
    <div className="space-y-6 pb-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Needs review</h2>
        {uploads.length === 0 ? (
          <p className="empty-surface">No uploads waiting for review.</p>
        ) : (
          uploads.map((upload) => (
            <Link key={upload.id} href={`/uploads/${upload.id}`} className="card-surface block">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium">Upload {upload.id.slice(0, 8)}</p>
                <StatusChip status={upload.status} />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(upload.created_at)}</p>
            </Link>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent dishes</h2>
        {entries.length === 0 ? (
          <p className="empty-surface">No dishes logged yet.</p>
        ) : (
          entries.map((entry) => {
            const eatenAt = entry.eaten_at ?? entry.created_at;
            const restaurant = entry.restaurant_id ? restaurantsById[entry.restaurant_id] : null;

            return (
              <Link key={entry.id} href={`/dishes/${entry.dish_key}`} className="card-surface block">
                <p className="font-medium">{entry.dish_name}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">{restaurant?.name ?? 'Unknown restaurant'}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">{formatPrice(entry)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(eatenAt)}</p>
              </Link>
            );
          })
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Recent restaurant visits</h2>
        {visitsSorted.length === 0 ? (
          <p className="empty-surface">No visits recorded yet.</p>
        ) : (
          visitsSorted.map(({ upload, itemCount }) => {
            const restaurant = upload.restaurant_id ? restaurantsById[upload.restaurant_id] : null;
            const visitDate = upload.visited_at ?? upload.created_at;

            return (
              <Link key={upload.id} href={`/uploads/${upload.id}`} className="card-surface block">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium">{restaurant?.name ?? 'Unknown restaurant'}</p>
                  <StatusChip status={upload.status} />
                </div>
                {restaurant?.address && <p className="text-xs text-slate-500 dark:text-slate-400">{restaurant.address}</p>}
                <p className="text-sm text-slate-600 dark:text-slate-300">{formatDate(visitDate)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{itemCount} extracted item{itemCount === 1 ? '' : 's'}</p>
              </Link>
            );
          })
        )}
      </section>
    </div>
  );
}
