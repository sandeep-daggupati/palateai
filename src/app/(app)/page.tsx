'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { IdentityTagPill, identityTagLabel, identityTagOptions } from '@/components/IdentityTagPill';
import { StatusChip } from '@/components/StatusChip';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, DishIdentityTag, ReceiptUpload, Restaurant } from '@/lib/supabase/types';

const RECENT_DISHES_LIMIT = 10;
const RECENT_VISITS_LIMIT = 10;
const NEEDS_REVIEW_LIMIT = 10;
const INSIGHTS_WINDOW = 200;

const FILTER_WINDOWS = [
  { value: 'all', label: 'All', days: null },
  { value: '7d', label: '7d', days: 7 },
  { value: '30d', label: '30d', days: 30 },
  { value: '90d', label: '90d', days: 90 },
] as const;

const IDENTITY_FILTERS = [{ value: 'all', label: 'Any identity' }, ...identityTagOptions()] as const;

type FilterWindow = (typeof FILTER_WINDOWS)[number]['value'];
type IdentityFilter = (typeof IDENTITY_FILTERS)[number]['value'];

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

function isWithinWindow(dateValue: string | null, filter: FilterWindow): boolean {
  if (filter === 'all') return true;
  if (!dateValue) return false;

  const days = FILTER_WINDOWS.find((window) => window.value === filter)?.days;
  if (!days) return true;

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;

  const now = Date.now();
  return now - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function matchesSearch(search: string, values: Array<string | null | undefined>): boolean {
  if (!search.trim()) return true;
  const normalizedSearch = search.trim().toLowerCase();
  return values.some((value) => value?.toLowerCase().includes(normalizedSearch));
}

function matchesIdentityFilter(value: DishIdentityTag | null, filter: IdentityFilter): boolean {
  if (filter === 'all') return true;
  return value === filter;
}

function FilterButtons({
  value,
  onChange,
}: {
  value: FilterWindow;
  onChange: (next: FilterWindow) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {FILTER_WINDOWS.map((window) => (
        <button
          key={window.value}
          type="button"
          onClick={() => onChange(window.value)}
          className={
            value === window.value
              ? 'inline-flex h-10 items-center rounded-xl border border-app-primary bg-app-primary px-3 text-xs font-medium text-app-primary-text transition-colors duration-200'
              : 'inline-flex h-10 items-center rounded-xl border border-app-border bg-app-card px-3 text-xs font-medium text-app-muted transition-colors duration-200 hover:border-app-primary/30 hover:text-app-text'
          }
        >
          {window.label}
        </button>
      ))}
    </div>
  );
}

function SearchAndIdentityFilters({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  identityValue,
  onIdentityChange,
}: {
  searchValue: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder: string;
  identityValue: IdentityFilter;
  onIdentityChange: (next: IdentityFilter) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
      <input
        type="search"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={searchPlaceholder}
        className="h-11 rounded-xl border border-app-border bg-app-card px-3 text-base leading-6 text-app-text placeholder:text-app-muted focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-accent/60"
      />
      <select
        value={identityValue}
        onChange={(event) => onIdentityChange(event.target.value as IdentityFilter)}
        className="h-11 rounded-xl border border-app-border bg-app-card px-3 text-base leading-6 text-app-text focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-accent/60"
      >
        {IDENTITY_FILTERS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function SearchOnlyFilter({
  searchValue,
  onSearchChange,
  searchPlaceholder,
}: {
  searchValue: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder: string;
}) {
  return (
    <input
      type="search"
      value={searchValue}
      onChange={(event) => onSearchChange(event.target.value)}
      placeholder={searchPlaceholder}
      className="h-11 w-full rounded-xl border border-app-border bg-app-card px-3 text-base leading-6 text-app-text placeholder:text-app-muted focus:border-app-primary focus:outline-none focus:ring-2 focus:ring-app-accent/60"
    />
  );
}

export default function HomePage() {
  const [uploads, setUploads] = useState<ReceiptUpload[]>([]);
  const [entrySample, setEntrySample] = useState<DishEntry[]>([]);
  const [visitSample, setVisitSample] = useState<VisitSummary[]>([]);
  const [restaurantsById, setRestaurantsById] = useState<Record<string, RestaurantLookup>>({});
  const [showWhy, setShowWhy] = useState(false);

  const [dishFilter, setDishFilter] = useState<FilterWindow>('30d');
  const [visitFilter, setVisitFilter] = useState<FilterWindow>('30d');
  const [dishSearch, setDishSearch] = useState('');
  const [visitSearch, setVisitSearch] = useState('');
  const [dishIdentityFilter, setDishIdentityFilter] = useState<IdentityFilter>('all');

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
        .select('id,dish_name,dish_key,restaurant_id,price_original,currency_original,price_usd,eaten_at,created_at,identity_tag,comment')
        .eq('user_id', user.id)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(INSIGHTS_WINDOW);

      const { data: visitData } = await supabase
        .from('receipt_uploads')
        .select('id,restaurant_id,status,visited_at,created_at,visit_note')
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

  const entries = useMemo(
    () =>
      entrySample
        .filter((entry) => isWithinWindow(entry.eaten_at ?? entry.created_at, dishFilter))
        .filter((entry) => matchesIdentityFilter(entry.identity_tag, dishIdentityFilter))
        .filter((entry) => {
          const restaurant = entry.restaurant_id ? restaurantsById[entry.restaurant_id] : null;
          return matchesSearch(dishSearch, [entry.dish_name, restaurant?.name, restaurant?.address]);
        })
        .slice(0, RECENT_DISHES_LIMIT),
    [dishFilter, dishIdentityFilter, dishSearch, entrySample, restaurantsById],
  );

  const visitsSorted = useMemo(
    () =>
      [...visitSample]
        .filter((visit) => isWithinWindow(visit.upload.visited_at ?? visit.upload.created_at, visitFilter))
        .filter((visit) => {
          const restaurant = visit.upload.restaurant_id ? restaurantsById[visit.upload.restaurant_id] : null;
          return matchesSearch(visitSearch, [restaurant?.name, restaurant?.address, visit.upload.visit_note]);
        })
        .sort((a, b) => {
          const aDate = a.upload.visited_at ?? a.upload.created_at;
          const bDate = b.upload.visited_at ?? b.upload.created_at;
          return new Date(bDate).getTime() - new Date(aDate).getTime();
        })
        .slice(0, RECENT_VISITS_LIMIT),
    [visitFilter, visitSearch, visitSample, restaurantsById],
  );

  const insights = useMemo(() => {
    if (entrySample.length === 0) {
      return {
        topIdentity: null as string | null,
        mostRepeated: null as string | null,
        mostVisited: null as string | null,
      };
    }

    const identityCounts = entrySample.reduce((acc, entry) => {
      if (!entry.identity_tag) return acc;
      acc[entry.identity_tag] = (acc[entry.identity_tag] ?? 0) + 1;
      return acc;
    }, {} as Record<DishIdentityTag, number>);

    const topIdentity = Object.entries(identityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] as DishIdentityTag | undefined;

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
      topIdentity: topIdentity ? `${identityTagLabel(topIdentity)}` : null,
      mostRepeated: mostRepeatedEntry ? `${mostRepeatedEntry.label} (${mostRepeatedEntry.count}x)` : null,
      mostVisited:
        mostVisitedId && restaurantsById[mostVisitedId]
          ? `${restaurantsById[mostVisitedId].name} (${mostVisitedCount} visits)`
          : null,
    };
  }, [entrySample, visitSample, restaurantsById]);

  const identitySnapshot = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const counts = entrySample.reduce((acc, entry) => {
      if (!entry.identity_tag) return acc;
      const date = new Date(entry.eaten_at ?? entry.created_at).getTime();
      if (Number.isNaN(date) || date < thirtyDaysAgo) return acc;
      acc[entry.identity_tag] = (acc[entry.identity_tag] ?? 0) + 1;
      return acc;
    }, {} as Record<DishIdentityTag, number>);

    return identityTagOptions().map((option) => ({
      tag: option.value,
      label: option.label,
      count: counts[option.value] ?? 0,
    }));
  }, [entrySample]);

  return (
    <div className="space-y-5 pb-8">
      {uploads.length > 0 && (
        <section className="space-y-3">
          <h2 className="section-label">Needs review</h2>
          {uploads.map((upload) => (
            <Link key={upload.id} href={`/uploads/${upload.id}`} className="card-surface block">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-medium">Upload {upload.id.slice(0, 8)}</p>
                <StatusChip status={upload.status} />
              </div>
              <p className="text-xs text-app-muted">{formatDate(upload.created_at)}</p>
            </Link>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div className="card-surface space-y-2">
          <p className="section-label">Insights</p>
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
            <p>Top identity recently: {insights.topIdentity ?? '--'}</p>
            <p>Most repeated dish: {insights.mostRepeated ?? '--'}</p>
            <p>Most visited recently: {insights.mostVisited ?? '--'}</p>
          </div>
        </div>

        <div className="card-surface space-y-2">
          <h2 className="section-label">Your identity snapshot</h2>
          <p className="text-xs text-app-muted">Last 30 days</p>
          <div className="flex flex-wrap gap-2">
            {identitySnapshot.map((entry) => (
              <div key={entry.tag} className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-card px-3 py-1">
                <IdentityTagPill tag={entry.tag} />
                <span className="text-xs font-medium text-app-text">{entry.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-label">Recent dishes</h2>
          <FilterButtons value={dishFilter} onChange={setDishFilter} />
        </div>
        <SearchAndIdentityFilters
          searchValue={dishSearch}
          onSearchChange={setDishSearch}
          searchPlaceholder="Search dish, restaurant, city, state, county"
          identityValue={dishIdentityFilter}
          onIdentityChange={setDishIdentityFilter}
        />
        {entries.length === 0 ? (
          <p className="empty-surface">No matching dishes. Try a different search or filter.</p>
        ) : (
          entries.map((entry) => {
            const eatenAt = entry.eaten_at ?? entry.created_at;
            const restaurant = entry.restaurant_id ? restaurantsById[entry.restaurant_id] : null;

            return (
              <Link key={entry.id} href={`/dishes/${entry.dish_key}`} className="card-surface block">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <p className="font-medium">{entry.dish_name}</p>
                  <IdentityTagPill tag={entry.identity_tag} />
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-label">Recent restaurant visits</h2>
          <FilterButtons value={visitFilter} onChange={setVisitFilter} />
        </div>
        <SearchOnlyFilter
          searchValue={visitSearch}
          onSearchChange={setVisitSearch}
          searchPlaceholder="Search restaurant, city, state, county"
        />
        {visitsSorted.length === 0 ? (
          <p className="empty-surface">No matching visits. Try a different search or filter.</p>
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


