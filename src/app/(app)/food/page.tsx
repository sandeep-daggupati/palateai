'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams, useSelectedLayoutSegments } from 'next/navigation';
import { ChevronDown, Search, X } from 'lucide-react';
import { IdentityTagPill } from '@/components/IdentityTagPill';
import { cn } from '@/lib/utils';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishCatalog, DishEntry, DishIdentityTag, Restaurant } from '@/lib/supabase/types';
import { SignedPhoto } from '@/lib/photos/types';

const LIST_LIMIT = 120;
const GRID_KEYS_STORAGE = 'palate.food.grid.keys';

const IDENTITY_OPTIONS: Array<{ value: 'all' | DishIdentityTag; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'go_to', label: 'Go-to' },
  { value: 'hidden_gem', label: 'Hidden gem' },
  { value: 'special_occasion', label: 'Special occasion' },
  { value: 'try_again', label: 'Try again' },
  { value: 'never_again', label: 'Never again' },
];

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

function parseIdentityFilter(value: string | null): 'all' | DishIdentityTag {
  if (!value) return 'all';
  const normalized = normalizeToken(value);
  const valid = new Set<DishIdentityTag>(['go_to', 'hidden_gem', 'special_occasion', 'try_again', 'never_again']);
  if (valid.has(normalized as DishIdentityTag)) return normalized as DishIdentityTag;
  return 'all';
}

function FilterDropdown({
  label,
  options,
  selectedValue,
  onSelect,
}: {
  label: string;
  options: FilterOption[];
  selectedValue: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const selected = options.find((option) => option.value === selectedValue)?.label ?? 'All';
  const filteredOptions = useMemo(() => {
    const normalized = normalizeToken(query);
    if (!normalized) return options;
    return options.filter((option) => normalizeToken(option.label).includes(normalized));
  }, [options, query]);

  return (
    <div ref={rootRef} className="relative min-w-[108px]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-8 w-full items-center justify-between gap-1 rounded-lg border border-app-border bg-app-card px-2 text-[11px] font-medium text-app-text"
      >
        <span className="truncate">{label}: {selected}</span>
        <ChevronDown size={13} className="shrink-0 text-app-muted" />
      </button>

      {open ? (
        <div className="absolute left-0 top-9 z-30 w-56 max-w-[85vw] rounded-xl border border-app-border bg-app-card p-2 shadow-sm">
          <div className="relative mb-1.5">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-app-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              className="h-8 w-full rounded-lg border border-app-border bg-app-bg pl-7 pr-2 text-xs text-app-text"
            />
          </div>

          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                  setQuery('');
                }}
                className={cn(
                  'flex h-8 w-full items-center rounded-lg px-2 text-left text-xs',
                  option.value === selectedValue ? 'bg-app-primary text-app-primary-text' : 'text-app-text hover:bg-app-bg',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function FoodPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const modalSegments = useSelectedLayoutSegments('modal');
  const queryParam = (searchParams.get('query') ?? '').trim().toLowerCase();
  const identityParam = parseIdentityFilter(searchParams.get('identity'));
  const cuisineParam = normalizeToken(searchParams.get('cuisine'));
  const flavorParam = normalizeToken(searchParams.get('flavor'));
  const isFoodGridPath = pathname === '/food';

  const [rows, setRows] = useState<DishEntry[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});
  const [identityFilter, setIdentityFilter] = useState<'all' | DishIdentityTag>(identityParam);
  const [cuisineFilter, setCuisineFilter] = useState<string>(cuisineParam || 'all');
  const [flavorFilter, setFlavorFilter] = useState<string>(flavorParam || 'all');
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
        .select('id,dish_name,dish_key,restaurant_id,identity_tag,cuisine,flavor_tags,eaten_at,created_at,source_upload_id')
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
    const nextIdentity = identityParam;
    const nextCuisine = cuisineParam || 'all';
    const nextFlavor = flavorParam || 'all';

    setIdentityFilter((prev) => (prev === nextIdentity ? prev : nextIdentity));
    setCuisineFilter((prev) => (prev === nextCuisine ? prev : nextCuisine));
    setFlavorFilter((prev) => (prev === nextFlavor ? prev : nextFlavor));
  }, [cuisineParam, flavorParam, identityParam, isFoodGridPath]);

  useEffect(() => {
    if (!isFoodGridPath) return;
    const nextParams = new URLSearchParams(searchParams.toString());

    if (identityFilter === 'all') nextParams.delete('identity');
    else nextParams.set('identity', identityFilter);

    if (cuisineFilter === 'all') nextParams.delete('cuisine');
    else nextParams.set('cuisine', cuisineFilter);

    if (flavorFilter === 'all') nextParams.delete('flavor');
    else nextParams.set('flavor', flavorFilter);

    const current = searchParams.toString();
    const next = nextParams.toString();
    if (current === next) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [cuisineFilter, flavorFilter, identityFilter, isFoodGridPath, pathname, router, searchParams]);

  const cuisineOptions = useMemo<FilterOption[]>(() => {
    const values = new Set<string>();
    for (const row of rows) {
      const effectiveCuisine = row.cuisine ?? catalogByDishKey[row.dish_key]?.cuisine ?? null;
      const normalized = normalizeToken(effectiveCuisine);
      if (normalized) values.add(normalized);
    }

    return [{ value: 'all', label: 'All' }, ...Array.from(values).sort().map((value) => ({ value, label: titleCase(value) }))];
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

    return [{ value: 'all', label: 'All' }, ...Array.from(values).sort().map((value) => ({ value, label: titleCase(value) }))];
  }, [catalogByDishKey, rows]);

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

    return base.filter((row) => {
      const queryMatch =
        !queryParam || row.dish_name.toLowerCase().includes(queryParam) || row.restaurantName.toLowerCase().includes(queryParam);
      const identityMatch = identityFilter === 'all' || row.identity_tag === identityFilter;
      const effectiveCuisine = row.cuisine ?? catalogByDishKey[row.dish_key]?.cuisine ?? null;
      const effectiveFlavorTags = row.flavor_tags ?? catalogByDishKey[row.dish_key]?.flavor_tags ?? [];
      const cuisineMatch = cuisineFilter === 'all' || normalizeToken(effectiveCuisine) === cuisineFilter;
      const flavorMatch =
        flavorFilter === 'all' || (effectiveFlavorTags ?? []).some((tag) => normalizeToken(tag) === flavorFilter);

      return queryMatch && identityMatch && cuisineMatch && flavorMatch;
    });
  }, [catalogByDishKey, cuisineFilter, flavorFilter, identityFilter, photoByDishEntryId, queryParam, restaurantsById, rows]);

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
  const hasActiveFilters = identityFilter !== 'all' || cuisineFilter !== 'all' || flavorFilter !== 'all';

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
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-app-border bg-app-card p-1.5">
          <FilterDropdown
            label="Vibe"
            selectedValue={identityFilter}
            onSelect={(value) => setIdentityFilter(value as 'all' | DishIdentityTag)}
            options={IDENTITY_OPTIONS}
          />
          <FilterDropdown label="Cuisine" selectedValue={cuisineFilter} onSelect={setCuisineFilter} options={cuisineOptions} />
          <FilterDropdown label="Flavor" selectedValue={flavorFilter} onSelect={setFlavorFilter} options={flavorOptions} />
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={() => {
                setIdentityFilter('all');
                setCuisineFilter('all');
                setFlavorFilter('all');
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-app-border px-2 text-[11px] text-app-muted"
            >
              <X size={12} />
              Clear
            </button>
          ) : null}
        </div>

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
