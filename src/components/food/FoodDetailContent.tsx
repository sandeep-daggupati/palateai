'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IdentityTagPill, identityTagLabel } from '@/components/IdentityTagPill';
import { SignedPhoto } from '@/lib/photos/types';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishCatalog, DishEntry, DishIdentityTag } from '@/lib/supabase/types';

type FoodDetailContentProps = {
  foodKey: string;
  showBackLink?: boolean;
};

type FoodTimelineEntry = Pick<
  DishEntry,
  'id' | 'dish_name' | 'dish_key' | 'restaurant_id' | 'identity_tag' | 'comment' | 'created_at' | 'eaten_at' | 'price_original' | 'currency_original' | 'source_upload_id'
> & {
  restaurantName: string;
  photo: SignedPhoto | null;
};

const TAG_OPTIONS: Array<{ label: string; value: DishIdentityTag }> = [
  { label: 'GO-TO', value: 'go_to' },
  { label: 'Hidden Gem', value: 'hidden_gem' },
  { label: 'Special Occasion', value: 'special_occasion' },
  { label: 'Try Again', value: 'try_again' },
  { label: 'Never Again', value: 'never_again' },
];

function entryTime(entry: Pick<FoodTimelineEntry, 'eaten_at' | 'created_at'>): number {
  const parsed = new Date(entry.eaten_at ?? entry.created_at).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Unknown date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown date';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function monthKey(value: string | null | undefined): string {
  if (!value) return 'unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelFromKey(key: string): string {
  if (key === 'unknown') return 'Unknown month';
  const [year, month] = key.split('-').map((chunk) => Number(chunk));
  const parsed = new Date(year, (month || 1) - 1, 1);
  if (Number.isNaN(parsed.getTime())) return 'Unknown month';
  return parsed.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

export function FoodDetailContent({ foodKey, showBackLink = false }: FoodDetailContentProps) {
  const [entries, setEntries] = useState<FoodTimelineEntry[]>([]);
  const [catalog, setCatalog] = useState<DishCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingTagEntryId, setSavingTagEntryId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setEntries([]);
      setCatalog(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    const [entriesResponse, catalogResponse, sessionResponse] = await Promise.all([
      supabase
        .from('dish_entries')
        .select('id,dish_name,dish_key,restaurant_id,identity_tag,comment,created_at,eaten_at,price_original,currency_original,source_upload_id')
        .eq('user_id', user.id)
        .eq('dish_key', foodKey)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('dish_catalog').select('*').eq('dish_key', foodKey).maybeSingle(),
      supabase.auth.getSession(),
    ]);

    const parsedEntries = ((entriesResponse.data ?? []) as DishEntry[]).sort((a, b) => entryTime(b) - entryTime(a));
    setCatalog((catalogResponse.data ?? null) as DishCatalog | null);

    const restaurantIds = Array.from(new Set(parsedEntries.map((row) => row.restaurant_id).filter((id): id is string => Boolean(id))));
    const restaurantLookup = new Map<string, string>();

    if (restaurantIds.length > 0) {
      const { data: restaurantRows } = await supabase.from('restaurants').select('id,name').in('id', restaurantIds);
      for (const row of (restaurantRows ?? []) as Array<{ id: string; name: string }>) {
        restaurantLookup.set(row.id, row.name);
      }
    }

    const byEntryId: Record<string, SignedPhoto> = {};
    const accessToken = sessionResponse.data.session?.access_token;
    if (accessToken && parsedEntries.length > 0) {
      const ids = parsedEntries.map((row) => row.id).join(',');
      const response = await fetch(`/api/photos/list?kind=dish&dish_entry_ids=${encodeURIComponent(ids)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (response.ok) {
        const payload = (await response.json()) as { photos?: SignedPhoto[] };
        for (const photo of payload.photos ?? []) {
          if (!photo.dish_entry_id) continue;
          if (!byEntryId[photo.dish_entry_id]) {
            byEntryId[photo.dish_entry_id] = photo;
          }
        }
      }
    }

    setEntries(
      parsedEntries.map((entry) => ({
        ...entry,
        restaurantName: entry.restaurant_id ? restaurantLookup.get(entry.restaurant_id) ?? 'Unknown restaurant' : 'Unknown restaurant',
        photo: byEntryId[entry.id] ?? null,
      })),
    );

    setLoading(false);
  }, [foodKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedTimeline = useMemo(() => {
    const groups = new Map<string, FoodTimelineEntry[]>();

    for (const entry of entries) {
      const key = monthKey(entry.eaten_at ?? entry.created_at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(entry);
    }

    return Array.from(groups.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, rows]) => ({
        key,
        label: monthLabelFromKey(key),
        rows: rows.sort((a, b) => entryTime(b) - entryTime(a)),
      }));
  }, [entries]);

  const tagCounts = useMemo(() => {
    const counts = new Map<DishIdentityTag, number>();
    for (const entry of entries) {
      if (!entry.identity_tag) continue;
      counts.set(entry.identity_tag, (counts.get(entry.identity_tag) ?? 0) + 1);
    }
    return counts;
  }, [entries]);

  const setTag = async (entryId: string, value: DishIdentityTag | null) => {
    const previous = entries;
    setEntries((current) => current.map((entry) => (entry.id === entryId ? { ...entry, identity_tag: value } : entry)));
    setSavingTagEntryId(entryId);

    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase.from('dish_entries').update({ identity_tag: value }).eq('id', entryId);

    if (error) {
      setEntries(previous);
    }

    setSavingTagEntryId(null);
  };

  if (loading) {
    return <p className="empty-surface">Loading food details...</p>;
  }

  if (entries.length === 0) {
    return <p className="empty-surface">No food logs yet.</p>;
  }

  const title = catalog?.name_canonical ?? entries[0]?.dish_name ?? 'Food detail';

  return (
    <div className="space-y-3 pb-2">
      {showBackLink ? (
        <Link href="/food" className="inline-flex text-xs font-medium text-app-link">
          Back to Food
        </Link>
      ) : null}

      <header data-food-detail-header className="card-surface space-y-1.5">
        <h1 className="text-xl font-semibold text-app-text">{title}</h1>
        {catalog?.description ? <p className="text-sm text-app-muted">{catalog.description}</p> : null}
        <p className="text-xs text-app-muted">{entries.length} logged instance{entries.length === 1 ? '' : 's'}</p>
      </header>

      <section className="card-surface space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-app-text">Tags</p>
          <p className="text-xs text-app-muted">Edit per entry below</p>
        </div>

        {tagCounts.size === 0 ? (
          <p className="text-xs text-app-muted">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {Array.from(tagCounts.entries()).map(([tag, count]) => (
              <span key={tag} className="inline-flex items-center gap-1">
                <IdentityTagPill tag={tag} />
                <span className="text-xs text-app-muted">x{count}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Timeline</p>

        {groupedTimeline.map((group) => (
          <div key={group.key} className="space-y-1.5">
            <h2 className="text-sm font-semibold text-app-text">{group.label}</h2>

            <div className="divide-y divide-app-border rounded-2xl border border-app-border bg-app-card">
              {group.rows.map((entry) => (
                <article key={entry.id} className="space-y-2 px-3 py-3">
                  <div className="flex items-start gap-3">
                    {entry.photo?.signedUrls.thumb ? (
                      <Image
                        src={entry.photo.signedUrls.thumb}
                        alt={`${entry.dish_name} photo`}
                        width={72}
                        height={72}
                        className="h-16 w-16 rounded-lg object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-100 to-lime-100 text-[10px] font-medium text-emerald-800">
                        No photo
                      </div>
                    )}

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-app-text">{entry.dish_name}</p>
                          <p className="truncate text-xs text-app-muted">{entry.restaurantName}</p>
                          <p className="text-xs text-app-muted">{formatTimestamp(entry.eaten_at ?? entry.created_at)}</p>
                        </div>
                        {entry.identity_tag ? <IdentityTagPill tag={entry.identity_tag} /> : null}
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="text-xs text-app-muted" htmlFor={`tag-${entry.id}`}>
                          Tag
                        </label>
                        <select
                          id={`tag-${entry.id}`}
                          value={entry.identity_tag ?? ''}
                          onChange={(event) => {
                            const nextValue = event.target.value as DishIdentityTag | '';
                            void setTag(entry.id, nextValue || null);
                          }}
                          className="h-8 rounded-lg border border-app-border bg-app-bg px-2 text-xs text-app-text"
                          disabled={savingTagEntryId === entry.id}
                        >
                          <option value="">No tag</option>
                          {TAG_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {identityTagLabel(option.value)} {option.label}
                            </option>
                          ))}
                        </select>
                        {savingTagEntryId === entry.id ? <span className="text-xs text-app-muted">Saving...</span> : null}
                      </div>

                      {entry.comment ? <p className="text-xs text-app-muted">{entry.comment}</p> : null}

                      <div className="flex items-center justify-between gap-2 text-xs text-app-muted">
                        <span>
                          {entry.price_original != null ? `${entry.currency_original} ${entry.price_original.toFixed(2)}` : 'Price unavailable'}
                        </span>
                        <Link href={`/uploads/${entry.source_upload_id}`} className="font-medium text-app-link">
                          Edit entry
                        </Link>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
