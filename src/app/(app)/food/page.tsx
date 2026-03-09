'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { DollarSign, Flame, Sparkles, UtensilsCrossed } from 'lucide-react';
import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegments } from 'next/navigation';
import { SearchControlFilterConfig, SearchControlsCard } from '@/components/controls/SearchControlsCard';
import { IdentityTagPill } from '@/components/IdentityTagPill';
import { cn } from '@/lib/utils';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishCatalog, DishEntry, DishIdentityTag, Restaurant } from '@/lib/supabase/types';
import { SignedPhoto } from '@/lib/photos/types';

const LIST_LIMIT = 120;
const GRID_KEYS_STORAGE = 'palate.food.grid.keys';

const VIBE_OPTIONS: Array<{ value: DishIdentityTag; label: string }> = [
  { value: 'go_to', label: 'Go-to' },
  { value: 'hidden_gem', label: 'Hidden gem' },
  { value: 'special_occasion', label: 'Special occasion' },
  { value: 'try_again', label: 'Try again' },
  { value: 'never_again', label: 'Never again' },
];

const PRICE_OPTIONS = [
  { value: 'under_10', label: '$ Under $10' },
  { value: '10_20', label: '$$ $10-$20' },
  { value: '20_40', label: '$$$ $20-$40' },
  { value: 'over_40', label: '$$$$ $40+' },
] as const;

type PriceBucket = (typeof PRICE_OPTIONS)[number]['value'];

type RestaurantLookup = {
  name: string;
};

type DishCatalogLookup = Pick<DishCatalog, 'dish_key' | 'cuisine' | 'flavor_tags'>;

type GridRow = DishEntry & {
  restaurantName: string;
  photo: SignedPhoto | null;
  recencyGroupKey: string;
  recencyGroupLabel: string;
};

type FilterOption = {
  value: string;
  label: string;
};

type FoodViewMode = 'grid' | 'timeline';

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

function normalizeToken(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim().toLowerCase();
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function parseListParam(searchParams: URLSearchParams, key: string): string[] {
  const raw = searchParams.get(key);
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => normalizeToken(part))
    .filter(Boolean);
}

function toggleListValue(list: string[], value: string): string[] {
  if (list.includes(value)) return list.filter((entry) => entry !== value);
  return [...list, value];
}

function serializeList(values: string[]): string {
  return values.join(',');
}

function priceBucket(value: number | null | undefined): PriceBucket | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value < 10) return 'under_10';
  if (value < 20) return '10_20';
  if (value < 40) return '20_40';
  return 'over_40';
}

export default function FoodPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const modalSegments = useSelectedLayoutSegments('modal');
  const isFoodGridPath = pathname === '/food';

  const parsedParams = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    const query = normalizeToken(params.get('query'));
    const cuisine = parseListParam(params, 'cuisine');
    const flavor = parseListParam(params, 'flavor');
    const price = parseListParam(params, 'price');
    const vibe = parseListParam(params, 'vibe');
    const legacyIdentityValue = normalizeToken(params.get('identity'));
    const mergedVibe = vibe.length > 0 ? vibe : legacyIdentityValue ? [legacyIdentityValue] : [];
    return { query, cuisine, flavor, price, mergedVibe };
  }, [searchParams]);

  const [rows, setRows] = useState<DishEntry[]>([]);
  const [view, setView] = useState<FoodViewMode>('grid');
  const [searchText, setSearchText] = useState(parsedParams.query);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});
  const [cuisineFilters, setCuisineFilters] = useState<string[]>(parsedParams.cuisine);
  const [flavorFilters, setFlavorFilters] = useState<string[]>(parsedParams.flavor);
  const [priceFilters, setPriceFilters] = useState<PriceBucket[]>(
    parsedParams.price.filter((value): value is PriceBucket => PRICE_OPTIONS.some((entry) => entry.value === value)),
  );
  const [vibeFilters, setVibeFilters] = useState<DishIdentityTag[]>(
    parsedParams.mergedVibe.filter((value): value is DishIdentityTag => VIBE_OPTIONS.some((entry) => entry.value === value)),
  );
  const [photoByDishEntryId, setPhotoByDishEntryId] = useState<Record<string, SignedPhoto>>({});
  const [catalogByDishKey, setCatalogByDishKey] = useState<Record<string, DishCatalogLookup>>({});

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
        setCatalogByDishKey({});
        return;
      }

      const query = supabase
        .from('dish_entries')
        .select('id,dish_name,dish_key,restaurant_id,identity_tag,cuisine,flavor_tags,comment,price_original,eaten_at,created_at,source_upload_id')
        .eq('user_id', user.id)
        .not('hangout_id', 'is', null)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(LIST_LIMIT);

      const [{ data: dishRows }, sessionResult] = await Promise.all([query, supabase.auth.getSession()]);
      const parsedRows = (dishRows ?? []) as DishEntry[];
      const dishKeys = Array.from(new Set(parsedRows.map((row) => row.dish_key).filter(Boolean)));

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

      if (dishKeys.length > 0) {
        const { data: catalogRows } = await supabase.from('dish_catalog').select('dish_key,cuisine,flavor_tags').in('dish_key', dishKeys);
        const nextCatalog = ((catalogRows ?? []) as DishCatalogLookup[]).reduce(
          (acc, row) => {
            acc[row.dish_key] = row;
            return acc;
          },
          {} as Record<string, DishCatalogLookup>,
        );
        setCatalogByDishKey(nextCatalog);
      } else {
        setCatalogByDishKey({});
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
  }, []);

  useEffect(() => {
    if (!isFoodGridPath) return;

    setSearchText(parsedParams.query);
    setCuisineFilters(parsedParams.cuisine);
    setFlavorFilters(parsedParams.flavor);
    setPriceFilters(parsedParams.price.filter((value): value is PriceBucket => PRICE_OPTIONS.some((entry) => entry.value === value)));
    setVibeFilters(parsedParams.mergedVibe.filter((value): value is DishIdentityTag => VIBE_OPTIONS.some((entry) => entry.value === value)));
  }, [isFoodGridPath, parsedParams]);

  useEffect(() => {
    if (!isFoodGridPath) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    const normalizedSearch = normalizeToken(searchText);

    if (!normalizedSearch) nextParams.delete('query');
    else nextParams.set('query', normalizedSearch);

    if (cuisineFilters.length === 0) nextParams.delete('cuisine');
    else nextParams.set('cuisine', serializeList(cuisineFilters));

    if (flavorFilters.length === 0) nextParams.delete('flavor');
    else nextParams.set('flavor', serializeList(flavorFilters));

    if (priceFilters.length === 0) nextParams.delete('price');
    else nextParams.set('price', serializeList(priceFilters));

    if (vibeFilters.length === 0) {
      nextParams.delete('vibe');
      nextParams.delete('identity');
    } else {
      nextParams.set('vibe', serializeList(vibeFilters));
      if (vibeFilters.length === 1) nextParams.set('identity', vibeFilters[0]);
      else nextParams.delete('identity');
    }

    const current = searchParams.toString();
    const next = nextParams.toString();
    if (current === next) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [cuisineFilters, flavorFilters, isFoodGridPath, pathname, priceFilters, router, searchParams, searchText, vibeFilters]);

  const cuisineOptions = useMemo<FilterOption[]>(() => {
    const values = new Set<string>();
    for (const row of rows) {
      const effectiveCuisine = row.cuisine ?? catalogByDishKey[row.dish_key]?.cuisine ?? null;
      const normalized = normalizeToken(effectiveCuisine);
      if (normalized) values.add(normalized);
    }

    return Array.from(values)
      .sort()
      .map((value) => ({ value, label: titleCase(value) }));
  }, [catalogByDishKey, rows]);

  const flavorOptions = useMemo<FilterOption[]>(() => {
    const values = new Set<string>();
    for (const row of rows) {
      const effectiveFlavorTags = row.flavor_tags ?? catalogByDishKey[row.dish_key]?.flavor_tags ?? [];
      for (const tag of effectiveFlavorTags ?? []) {
        const normalized = normalizeToken(tag);
        if (normalized) values.add(normalized);
      }
    }

    return Array.from(values)
      .sort()
      .map((value) => ({ value, label: titleCase(value) }));
  }, [catalogByDishKey, rows]);

  const filterConfigs = useMemo<SearchControlFilterConfig[]>(() => {
    return [
      {
        key: 'cuisine',
        label: 'Cuisine',
        icon: <UtensilsCrossed size={12} className="text-app-muted" />,
        options: cuisineOptions,
        selectedValues: cuisineFilters,
        onToggle: (value) => setCuisineFilters((current) => toggleListValue(current, value)),
      },
      {
        key: 'flavor',
        label: 'Flavor',
        icon: <Flame size={12} className="text-app-muted" />,
        options: flavorOptions,
        selectedValues: flavorFilters,
        onToggle: (value) => setFlavorFilters((current) => toggleListValue(current, value)),
      },
      {
        key: 'price',
        label: 'Price',
        icon: <DollarSign size={12} className="text-app-muted" />,
        options: PRICE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label })),
        selectedValues: priceFilters,
        onToggle: (value) => setPriceFilters((current) => toggleListValue(current, value) as PriceBucket[]),
      },
      {
        key: 'vibe',
        label: 'Vibe',
        icon: <Sparkles size={12} className="text-app-muted" />,
        options: VIBE_OPTIONS.map((entry) => ({ value: entry.value, label: entry.label })),
        selectedValues: vibeFilters,
        onToggle: (value) => setVibeFilters((current) => toggleListValue(current, value) as DishIdentityTag[]),
      },
    ];
  }, [cuisineFilters, cuisineOptions, flavorFilters, flavorOptions, priceFilters, vibeFilters]);

  const filteredRows = useMemo<GridRow[]>(() => {
    const searchQuery = normalizeToken(searchText);

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

    return base.filter((row) => {
      const effectiveCuisine = row.cuisine ?? catalogByDishKey[row.dish_key]?.cuisine ?? null;
      const effectiveFlavorTags = row.flavor_tags ?? catalogByDishKey[row.dish_key]?.flavor_tags ?? [];
      const bucket = priceBucket(row.price_original);

      const searchMatch =
        !searchQuery ||
        [
          row.dish_name,
          row.restaurantName,
          effectiveCuisine,
          ...(effectiveFlavorTags ?? []),
          row.comment,
        ]
          .map((value) => normalizeToken(value))
          .filter(Boolean)
          .some((value) => value.includes(searchQuery));

      const cuisineMatch = cuisineFilters.length === 0 || cuisineFilters.includes(normalizeToken(effectiveCuisine));
      const flavorMatch =
        flavorFilters.length === 0 || (effectiveFlavorTags ?? []).some((tag) => flavorFilters.includes(normalizeToken(tag)));
      const priceMatch = priceFilters.length === 0 || (bucket !== null && priceFilters.includes(bucket));
      const vibeMatch = vibeFilters.length === 0 || (row.identity_tag !== null && vibeFilters.includes(row.identity_tag));

      return searchMatch && cuisineMatch && flavorMatch && priceMatch && vibeMatch;
    });
  }, [catalogByDishKey, cuisineFilters, flavorFilters, photoByDishEntryId, priceFilters, restaurantsById, rows, searchText, vibeFilters]);

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
  const hasActiveFilters =
    Boolean(searchText.trim()) || cuisineFilters.length > 0 || flavorFilters.length > 0 || priceFilters.length > 0 || vibeFilters.length > 0;

  return (
    <div className={cn('space-y-3 pb-5', isFoodDetailOpen && 'select-none')}>
      <SearchControlsCard
        view={view}
        onViewChange={(next) => setView(next as FoodViewMode)}
        searchValue={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Search dishes, cuisines, or restaurants"
        filters={filterConfigs}
        hasActiveFilters={hasActiveFilters}
        onClearAll={() => {
          setSearchText('');
          setCuisineFilters([]);
          setFlavorFilters([]);
          setPriceFilters([]);
          setVibeFilters([]);
        }}
      />

      {filteredRows.length === 0 ? (
        <p className="empty-surface">No food yet.</p>
      ) : view === 'grid' ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filteredRows.map((row) => {
            const target = row.dish_key ? `/food/${row.dish_key}` : `/uploads/${row.source_upload_id}`;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  if (row.dish_key) {
                    window.sessionStorage.setItem(GRID_KEYS_STORAGE, JSON.stringify(visibleFoodKeys));
                    const currentParams = searchParams.toString();
                    const nextHref = currentParams ? `/food/${row.dish_key}?${currentParams}` : `/food/${row.dish_key}`;
                    router.push(nextHref, { scroll: false });
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
                    Add a food photo
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
      ) : (
        groupedRows.map((group) => (
          <section key={group.key} className="space-y-1.5">
            <h2 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-app-muted">{group.label}</h2>
            <div className="space-y-1.5">
              {group.rows.map((row) => {
                const target = row.dish_key ? `/food/${row.dish_key}` : `/uploads/${row.source_upload_id}`;
                return (
                  <button
                    key={`timeline-${row.id}`}
                    type="button"
                    onClick={() => {
                      if (row.dish_key) {
                        window.sessionStorage.setItem(GRID_KEYS_STORAGE, JSON.stringify(visibleFoodKeys));
                        const currentParams = searchParams.toString();
                        const nextHref = currentParams ? `/food/${row.dish_key}?${currentParams}` : `/food/${row.dish_key}`;
                        router.push(nextHref, { scroll: false });
                        return;
                      }
                      router.push(target, { scroll: false });
                    }}
                    className="w-full rounded-xl border border-app-border bg-app-card p-3 text-left"
                  >
                    <div className="flex items-start gap-2">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-app-border bg-app-bg">
                        {row.photo?.signedUrls.thumb ? (
                          <Image src={row.photo.signedUrls.thumb} alt={`${row.dish_name} thumbnail`} width={56} height={56} className="h-full w-full object-cover" unoptimized />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[10px] text-app-muted">No photo</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-app-text">{row.dish_name}</p>
                          {row.identity_tag ? <IdentityTagPill tag={row.identity_tag} /> : null}
                        </div>
                        <p className="truncate text-xs text-app-muted">{row.restaurantName}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
