'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { IdentityTagPill } from '@/components/IdentityTagPill';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, ReceiptUpload, Restaurant } from '@/lib/supabase/types';

const RECENT_ACTIVITY_LIMIT = 5;
const GO_TO_LIMIT = 5;

type RestaurantLookup = {
  name: string;
};

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function HomePage() {
  const [recentActivity, setRecentActivity] = useState<ReceiptUpload[]>([]);
  const [goToDishes, setGoToDishes] = useState<DishEntry[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setRecentActivity([]);
        setGoToDishes([]);
        setRestaurantsById({});
        return;
      }

      const { data: activityData } = await supabase
        .from('receipt_uploads')
        .select('id,restaurant_id,status,visited_at,created_at')
        .eq('user_id', user.id)
        .order('visited_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(RECENT_ACTIVITY_LIMIT);

      const { data: goToData } = await supabase
        .from('dish_entries')
        .select('id,dish_name,dish_key,restaurant_id,identity_tag,eaten_at,created_at')
        .eq('user_id', user.id)
        .eq('identity_tag', 'go_to')
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(GO_TO_LIMIT);

      const activityRows = (activityData ?? []) as ReceiptUpload[];
      const goToRows = (goToData ?? []) as DishEntry[];

      const restaurantIds = Array.from(
        new Set(
          [...activityRows, ...goToRows]
            .map((row) => row.restaurant_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      let restaurantLookup: Record<string, RestaurantLookup> = {};
      if (restaurantIds.length > 0) {
        const { data: restaurantRows } = await supabase
          .from('restaurants')
          .select('id,name')
          .eq('user_id', user.id)
          .in('id', restaurantIds);

        restaurantLookup = ((restaurantRows ?? []) as Pick<Restaurant, 'id' | 'name'>[]).reduce(
          (acc, restaurant) => {
            acc[restaurant.id] = { name: restaurant.name };
            return acc;
          },
          {} as Record<string, RestaurantLookup>,
        );
      }

      setRecentActivity(activityRows);
      setGoToDishes(goToRows);
      setRestaurantsById(restaurantLookup);
    };

    void load();
  }, []);

  const hasAnyActivity = recentActivity.length > 0;

  const activityRows = useMemo(
    () =>
      recentActivity.map((row) => ({
        ...row,
        restaurantName: row.restaurant_id ? restaurantsById[row.restaurant_id]?.name ?? 'Unknown restaurant' : 'Unknown restaurant',
        dateLabel: formatDate(row.visited_at ?? row.created_at),
      })),
    [recentActivity, restaurantsById],
  );

  const goToRows = useMemo(
    () =>
      goToDishes.map((row) => ({
        ...row,
        restaurantName: row.restaurant_id ? restaurantsById[row.restaurant_id]?.name ?? 'Unknown restaurant' : 'Unknown restaurant',
      })),
    [goToDishes, restaurantsById],
  );

  return (
    <div className="space-y-5 pb-8">
      <section className="card-surface space-y-4">
        <h1 className="text-2xl font-semibold text-app-text">What did you eat today?</h1>
        <Link
          href="/add"
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-app-primary px-5 text-base font-semibold text-app-primary-text shadow-sm transition-colors duration-200 hover:bg-app-primary/90"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M10 4v12" />
            <path d="M4 10h12" />
          </svg>
          Add receipt or menu
        </Link>

        {!hasAnyActivity && (
          <p className="text-sm text-app-muted">1) Upload receipt/menu -&gt; 2) Approve dishes -&gt; 3) Build your food identity</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="section-label">Recent activity</h2>
        {activityRows.length === 0 ? (
          <p className="empty-surface">No activity yet.</p>
        ) : (
          activityRows.map((row) => (
            <Link key={row.id} href={`/uploads/${row.id}`} className="card-surface block">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-medium text-app-text">{row.restaurantName}</p>
                <StatusChip status={row.status} />
              </div>
              <p className="text-sm text-app-muted">{row.dateLabel}</p>
            </Link>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="section-label">Your GO-TOs</h2>
        {goToRows.length === 0 ? (
          <p className="empty-surface">Mark dishes as GO-TO during approval.</p>
        ) : (
          goToRows.map((row) => (
            <Link key={row.id} href={`/dishes/${row.dish_key}`} className="card-surface block">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-medium text-app-text">{row.dish_name}</p>
                <IdentityTagPill tag="go_to" />
              </div>
              <p className="text-sm text-app-muted">{row.restaurantName}</p>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}




