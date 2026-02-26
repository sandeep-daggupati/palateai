'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FilterChips } from '@/components/FilterChips';
import { IdentityTagPill } from '@/components/IdentityTagPill';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, DishIdentityTag, Restaurant } from '@/lib/supabase/types';
import { SignedPhoto } from '@/lib/photos/types';

const LIST_LIMIT = 20;

const DISH_FILTER_OPTIONS: Array<{ label: string; value: 'all' | DishIdentityTag; badge?: string }> = [
  { label: 'All', value: 'all' },
  { label: 'GO-TO', value: 'go_to', badge: 'Suggested' },
  { label: 'Hidden Gem', value: 'hidden_gem' },
  { label: 'Special Occasion', value: 'special_occasion' },
  { label: 'Try Again', value: 'try_again' },
  { label: 'Never Again', value: 'never_again' },
];

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

export default function DishesPage() {
  const searchParams = useSearchParams();
  const queryParam = (searchParams.get('query') ?? '').trim().toLowerCase();

  const [dishes, setDishes] = useState<DishEntry[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});
  const [dishFilter, setDishFilter] = useState<'all' | DishIdentityTag>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [photoByDishEntryId, setPhotoByDishEntryId] = useState<Record<string, SignedPhoto>>({});

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setDishes([]);
        setRestaurantsById({});
        setPhotoByDishEntryId({});
        return;
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

      const { data: dishRows } = await dishQuery;
      const parsedDishes = (dishRows ?? []) as DishEntry[];

      const restaurantIds = Array.from(new Set(parsedDishes.map((row) => row.restaurant_id).filter((id): id is string => Boolean(id))));

      let restaurantLookup: Record<string, RestaurantLookup> = {};
      if (restaurantIds.length > 0) {
        const { data: restaurantRows } = await supabase.from('restaurants').select('id,name').in('id', restaurantIds);

        restaurantLookup = ((restaurantRows ?? []) as Pick<Restaurant, 'id' | 'name'>[]).reduce(
          (acc, row) => {
            acc[row.id] = { name: row.name };
            return acc;
          },
          {} as Record<string, RestaurantLookup>,
        );
      }

      setDishes(parsedDishes);
      setRestaurantsById(restaurantLookup);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token || parsedDishes.length === 0) {
        setPhotoByDishEntryId({});
        return;
      }

      const ids = parsedDishes.map((row) => row.id).join(',');
      const response = await fetch(`/api/photos/list?kind=dish&dish_entry_ids=${encodeURIComponent(ids)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!response.ok) {
        setPhotoByDishEntryId({});
        return;
      }

      const payload = (await response.json()) as { photos?: SignedPhoto[] };
      const map: Record<string, SignedPhoto> = {};
      for (const photo of payload.photos ?? []) {
        if (!photo.dish_entry_id) continue;
        if (!map[photo.dish_entry_id]) {
          map[photo.dish_entry_id] = photo;
        }
      }
      setPhotoByDishEntryId(map);
    };

    void load();
  }, [dishFilter]);

  const filteredRows = useMemo(() => {
    const base = dishes.map((dish) => ({
      ...dish,
      restaurantName: dish.restaurant_id ? restaurantsById[dish.restaurant_id]?.name ?? 'Unknown restaurant' : 'Unknown restaurant',
      dateLabel: formatDate(dish.eaten_at ?? dish.created_at),
      photo: photoByDishEntryId[dish.id] ?? null,
    }));

    if (!queryParam) return base;
    return base.filter((row) => row.dish_name.toLowerCase().includes(queryParam) || row.restaurantName.toLowerCase().includes(queryParam));
  }, [dishes, photoByDishEntryId, queryParam, restaurantsById]);

  return (
    <div className="space-y-3 pb-6">
      <section className="card-surface space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-app-text">Dishes</h1>
          <Link href="/" className="text-xs font-medium text-app-link">
            Back to Home
          </Link>
        </div>
        <p className="text-sm text-app-muted">Your dish history with identity filters.</p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <FilterChips options={DISH_FILTER_OPTIONS} selected={dishFilter} onChange={setDishFilter} />
          <div className="inline-flex rounded-lg border border-app-border p-1">
            <button
              type="button"
              className={`h-8 rounded-md px-3 text-xs ${viewMode === 'list' ? 'bg-app-primary text-app-primary-text' : 'text-app-muted'}`}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
            <button
              type="button"
              className={`h-8 rounded-md px-3 text-xs ${viewMode === 'grid' ? 'bg-app-primary text-app-primary-text' : 'text-app-muted'}`}
              onClick={() => setViewMode('grid')}
            >
              Grid
            </button>
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <p className="empty-surface">No dishes yet.</p>
        ) : viewMode === 'list' ? (
          <div className="divide-y divide-app-border rounded-2xl border border-app-border bg-app-card">
            {filteredRows.map((dish) => (
              <Link key={dish.id} href={dish.dish_key ? `/dishes/${dish.dish_key}` : `/uploads/${dish.source_upload_id}`} className="block px-3 py-3">
                <div className="flex items-start gap-3">
                  {dish.photo?.signedUrls.thumb ? (
                    <Image
                      src={dish.photo.signedUrls.thumb}
                      alt={`${dish.dish_name} thumbnail`}
                      width={64}
                      height={64}
                      className="h-14 w-14 rounded-lg object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-100 to-lime-100 text-[10px] font-medium text-emerald-800">
                      No photo
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <p className="font-medium text-app-text">{dish.dish_name}</p>
                      {dish.identity_tag && <IdentityTagPill tag={dish.identity_tag} />}
                    </div>
                    <p className="text-sm text-app-muted">{dish.restaurantName}</p>
                    <p className="text-xs text-app-muted">{dish.dateLabel}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredRows.map((dish) => (
              <Link
                key={dish.id}
                href={dish.dish_key ? `/dishes/${dish.dish_key}` : `/uploads/${dish.source_upload_id}`}
                className="overflow-hidden rounded-xl border border-app-border bg-app-card"
              >
                {dish.photo?.signedUrls.thumb ? (
                  <Image
                    src={dish.photo.signedUrls.thumb}
                    alt={`${dish.dish_name} thumbnail`}
                    width={320}
                    height={240}
                    className="h-36 w-full object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-emerald-100 to-lime-100 text-xs font-medium text-emerald-800">
                    Add a dish photo
                  </div>
                )}
                <div className="space-y-1 px-2 py-2">
                  <p className="truncate text-sm font-medium text-app-text">{dish.dish_name}</p>
                  <p className="truncate text-xs text-app-muted">{dish.restaurantName}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
