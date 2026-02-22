'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FilterChips } from '@/components/FilterChips';
import { IdentityTagPill } from '@/components/IdentityTagPill';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, DishIdentityTag, ReceiptUpload, ReceiptUploadStatus, Restaurant } from '@/lib/supabase/types';

const LIST_LIMIT = 10;

const DISH_FILTER_OPTIONS: Array<{ label: string; value: 'all' | DishIdentityTag; badge?: string }> = [
  { label: 'All', value: 'all' },
  { label: 'GO-TO', value: 'go_to', badge: 'Your Favorites' },
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

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function HomePage() {
  const [hasAnyUploads, setHasAnyUploads] = useState(false);
  const [dishes, setDishes] = useState<DishEntry[]>([]);
  const [visits, setVisits] = useState<ReceiptUpload[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});

  const [dishFilter, setDishFilter] = useState<'all' | DishIdentityTag>('all');
  const [activityFilter, setActivityFilter] = useState<'all' | ReceiptUploadStatus>('all');

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setHasAnyUploads(false);
        setDishes([]);
        setVisits([]);
        setRestaurantsById({});
        return;
      }

      const uploadsExistQuery = await supabase.from('receipt_uploads').select('id').eq('user_id', user.id).limit(1);
      setHasAnyUploads((uploadsExistQuery.data ?? []).length > 0);

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

      let visitQuery = supabase
        .from('receipt_uploads')
        .select('id,restaurant_id,status,visited_at,created_at,visit_note')
        .eq('user_id', user.id)
        .order('visited_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);

      if (activityFilter !== 'all') {
        visitQuery = visitQuery.eq('status', activityFilter);
      }

      const [{ data: dishRows }, { data: visitRows }] = await Promise.all([dishQuery, visitQuery]);

      const parsedDishes = (dishRows ?? []) as DishEntry[];
      const parsedVisits = (visitRows ?? []) as ReceiptUpload[];

      const restaurantIds = Array.from(
        new Set(
          [...parsedDishes, ...parsedVisits]
            .map((row) => row.restaurant_id)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      let restaurantLookup: Record<string, RestaurantLookup> = {};
      if (restaurantIds.length > 0) {
        const { data: restaurantRows } = await supabase
          .from('restaurants')
          .select('id,name,address')
          .eq('user_id', user.id)
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

      setDishes(parsedDishes);
      setVisits(parsedVisits);
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

  const visitRows = useMemo(
    () =>
      visits.map((visit) => ({
        ...visit,
        restaurantName: visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.name ?? 'Unknown restaurant' : 'Unknown restaurant',
        address: visit.restaurant_id ? restaurantsById[visit.restaurant_id]?.address ?? null : null,
        dateLabel: formatDate(visit.visited_at ?? visit.created_at),
      })),
    [restaurantsById, visits],
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

        {!hasAnyUploads && (
          <p className="text-sm text-app-muted">1) Upload receipt/menu -&gt; 2) Approve dishes -&gt; 3) Build your food identity</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="section-label">Recent Dishes</h2>
        <FilterChips options={DISH_FILTER_OPTIONS} selected={dishFilter} onChange={setDishFilter} />
        {dishRows.length === 0 ? (
          <p className="empty-surface">No dishes yet.</p>
        ) : (
          dishRows.map((dish) => (
            <Link key={dish.id} href={dish.dish_key ? `/dishes/${dish.dish_key}` : `/uploads/${dish.source_upload_id}`} className="card-surface block">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-medium text-app-text">{dish.dish_name}</p>
                {dish.identity_tag && <IdentityTagPill tag={dish.identity_tag} />}
              </div>
              <p className="text-sm text-app-muted">{dish.restaurantName}</p>
              <p className="text-xs text-app-muted">{dish.dateLabel}</p>
            </Link>
          ))
        )}
      </section>

      <section className="space-y-2">
        <h2 className="section-label">Recent Activity</h2>
        <FilterChips options={ACTIVITY_FILTER_OPTIONS} selected={activityFilter} onChange={setActivityFilter} />
        {visitRows.length === 0 ? (
          <p className="empty-surface">No activity yet.</p>
        ) : (
          visitRows.map((visit) => (
            <Link key={visit.id} href={`/uploads/${visit.id}`} className="card-surface block">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-medium text-app-text">{visit.restaurantName}</p>
                <StatusChip status={visit.status} />
              </div>
              {visit.address && <p className="text-xs text-app-muted">{visit.address}</p>}
              <p className="text-xs text-app-muted">{visit.dateLabel}</p>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}

