'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, useSelectedLayoutSegments } from 'next/navigation';
import { FilterChips } from '@/components/FilterChips';
import { IdentityTagPill } from '@/components/IdentityTagPill';
import { cn } from '@/lib/utils';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, DishIdentityTag, Restaurant } from '@/lib/supabase/types';
import { SignedPhoto } from '@/lib/photos/types';

const LIST_LIMIT = 120;
const GRID_KEYS_STORAGE = 'palate.food.grid.keys';

const FOOD_FILTER_OPTIONS: Array<{ label: string; value: 'all' | DishIdentityTag; badge?: string }> = [
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

type GridRow = DishEntry & {
  restaurantName: string;
  photo: SignedPhoto | null;
  recencyGroupKey: string;
  recencyGroupLabel: string;
};

function parseTime(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function monthKey(value: string | null | undefined): string {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  if (key === 'unknown') return 'Unknown month';
  const [year, month] = key.split('-').map((chunk) => Number(chunk));
  const parsed = new Date(year, (month || 1) - 1, 1);
  if (Number.isNaN(parsed.getTime())) return 'Unknown month';
  return parsed.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function FoodPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modalSegments = useSelectedLayoutSegments('modal');
  const queryParam = (searchParams.get('query') ?? '').trim().toLowerCase();

  const [rows, setRows] = useState<DishEntry[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});
  const [foodFilter, setFoodFilter] = useState<'all' | DishIdentityTag>('all');
  const [photoByDishEntryId, setPhotoByDishEntryId] = useState<Record<string, SignedPhoto>>({});

  useEffect(() => {
    const load = async () => {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setRows([]);
        setRestaurantsById({});
        setPhotoByDishEntryId({});
        return;
      }

      let query = supabase
        .from('dish_entries')
        .select('id,dish_name,dish_key,restaurant_id,identity_tag,eaten_at,created_at,source_upload_id')
        .eq('user_id', user.id)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);

      if (foodFilter !== 'all') {
        query = query.eq('identity_tag', foodFilter);
      }

      const [{ data: dishRows }, sessionResult] = await Promise.all([query, supabase.auth.getSession()]);
      const parsedRows = (dishRows ?? []) as DishEntry[];

      const restaurantIds = Array.from(new Set(parsedRows.map((entry) => entry.restaurant_id).filter((id): id is string => Boolean(id))));
      if (restaurantIds.length > 0) {
        const { data: restaurantRows } = await supabase.from('restaurants').select('id,name').in('id', restaurantIds);
        const lookup = ((restaurantRows ?? []) as Pick<Restaurant, 'id' | 'name'>[]).reduce(
          (acc, row) => {
            acc[row.id] = { name: row.name };
            return acc;
          },
          {} as Record<string, RestaurantLookup>,
        );
        setRestaurantsById(lookup);
      } else {
        setRestaurantsById({});
      }

      setRows(parsedRows);

      const accessToken = sessionResult.data.session?.access_token;
      if (!accessToken || parsedRows.length === 0) {
        setPhotoByDishEntryId({});
        return;
      }

      const ids = parsedRows.map((entry) => entry.id).join(',');
      const response = await fetch(`/api/photos/list?kind=dish&dish_entry_ids=${encodeURIComponent(ids)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
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
  }, [foodFilter]);

  const filteredRows = useMemo<GridRow[]>(() => {
    const base = rows
      .map((entry) => {
        const stamp = entry.eaten_at ?? entry.created_at;
        const groupKey = monthKey(stamp);
        return {
          ...entry,
          restaurantName: entry.restaurant_id ? restaurantsById[entry.restaurant_id]?.name ?? 'Unknown restaurant' : 'Unknown restaurant',
          photo: photoByDishEntryId[entry.id] ?? null,
          recencyGroupKey: groupKey,
          recencyGroupLabel: monthLabel(groupKey),
        };
      })
      .sort((a, b) => parseTime(b.eaten_at ?? b.created_at) - parseTime(a.eaten_at ?? a.created_at));

    if (!queryParam) return base;

    return base.filter(
      (row) => row.dish_name.toLowerCase().includes(queryParam) || row.restaurantName.toLowerCase().includes(queryParam),
    );
  }, [photoByDishEntryId, queryParam, restaurantsById, rows]);

  const groupedRows = useMemo(() => {
    const map = new Map<string, { label: string; rows: GridRow[] }>();
    for (const row of filteredRows) {
      if (!map.has(row.recencyGroupKey)) {
        map.set(row.recencyGroupKey, {
          label: row.recencyGroupLabel,
          rows: [],
        });
      }
      map.get(row.recencyGroupKey)?.rows.push(row);
    }

    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, value]) => ({ key, label: value.label, rows: value.rows }));
  }, [filteredRows]);

  const visibleFoodKeys = useMemo(
    () => filteredRows.map((row) => row.dish_key).filter((value): value is string => Boolean(value)),
    [filteredRows],
  );

  const isFoodDetailOpen = modalSegments[0] === 'food' && typeof modalSegments[1] === 'string';

  return (
    <div className={cn('space-y-3 pb-5', isFoodDetailOpen && 'select-none')}>
      <section className="card-surface space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-app-text">Food</h1>
          <Link href="/" className="text-xs font-medium text-app-link">
            Back to Home
          </Link>
        </div>
        <p className="text-sm text-app-muted">Photo-first timeline of what you logged.</p>
      </section>

      <section className="space-y-2">
        <FilterChips options={FOOD_FILTER_OPTIONS} selected={foodFilter} onChange={setFoodFilter} />

        {groupedRows.length === 0 ? (
          <p className="empty-surface">No food yet.</p>
        ) : (
          groupedRows.map((group) => (
            <section key={group.key} className="space-y-1.5">
              <h2 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-app-muted">{group.label}</h2>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.rows.map((row) => {
                  const target = row.dish_key ? `/food/${row.dish_key}` : `/uploads/${row.source_upload_id}`;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        if (row.dish_key) {
                          window.sessionStorage.setItem(GRID_KEYS_STORAGE, JSON.stringify(visibleFoodKeys));
                          router.push(`/food/${row.dish_key}`, { scroll: false });
                          return;
                        }
                        router.push(target, { scroll: false });
                      }}
                      className="overflow-hidden rounded-xl border border-app-border bg-app-card text-left"
                    >
                      {row.photo?.signedUrls.thumb ? (
                        <Image
                          src={row.photo.signedUrls.thumb}
                          alt={`${row.dish_name} thumbnail`}
                          width={360}
                          height={280}
                          className="h-36 w-full object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-emerald-100 to-lime-100 text-xs font-medium text-emerald-800">
                          Add a dish photo
                        </div>
                      )}

                      <div className="space-y-1 px-2 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-app-text">{row.dish_name}</p>
                          {row.identity_tag ? <IdentityTagPill tag={row.identity_tag} /> : null}
                        </div>
                        <p className="truncate text-xs text-app-muted">{row.restaurantName}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </section>
    </div>
  );
}
