'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Globe, MapPinned, Phone, SlidersHorizontal } from 'lucide-react';
import { IdentityTagIcon } from '@/components/IdentityTagIcon';
import { SignedPhoto } from '@/lib/photos/types';
import { uploadDishPhoto } from '@/lib/data/photosRepo';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishCatalog, DishIdentityTag, PersonalFoodEntry } from '@/lib/supabase/types';
import { getGoogleMapsLink } from '@/lib/google/mapsLinks';

type FoodDetailContentProps = {
  foodKey: string;
  showBackLink?: boolean;
};

type CanonicalTag = DishIdentityTag | 'none';

type RestaurantMeta = {
  id: string;
  place_type: 'google' | 'pinned';
  name: string;
  place_id: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone_number: string | null;
  website: string | null;
  maps_url: string | null;
};

type FoodTimelineEntry = Pick<
  PersonalFoodEntry,
  | 'id'
  | 'dish_name'
  | 'dish_key'
  | 'restaurant_id'
  | 'reaction_tag'
  | 'note'
  | 'created_at'
  | 'updated_at'
  | 'price'
  | 'source_hangout_id'
  | 'source_dish_entry_id'
> & {
  restaurant: RestaurantMeta | null;
  photo: SignedPhoto | null;
  canonicalTag: CanonicalTag;
};

type EntryUpdatePayload = {
  tag: CanonicalTag;
  note: string;
  photoFile: File | null;
};

const TAG_ORDER: CanonicalTag[] = ['go_to', 'hidden_gem', 'special_occasion', 'try_again', 'never_again', 'none'];

const TAG_LABELS: Record<CanonicalTag, string> = {
  go_to: 'Go-to',
  hidden_gem: 'Hidden gem',
  special_occasion: 'Special occasion',
  try_again: 'Try again',
  never_again: 'Never again',
  none: 'No tag',
};

function normalizeTag(value: string | null | undefined): CanonicalTag {
  if (!value) return 'none';

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return 'none';

  const map: Record<string, CanonicalTag> = {
    go_to: 'go_to',
    goto: 'go_to',
    hidden_gem: 'hidden_gem',
    hiddengem: 'hidden_gem',
    special_occasion: 'special_occasion',
    specialoccasion: 'special_occasion',
    try_again: 'try_again',
    tryagain: 'try_again',
    never_again: 'never_again',
    neveragain: 'never_again',
    none: 'none',
    null: 'none',
  };

  return map[normalized] ?? 'none';
}

function toDbTag(value: CanonicalTag): DishIdentityTag | null {
  return value === 'none' ? null : value;
}

function entryTime(entry: Pick<FoodTimelineEntry, 'updated_at' | 'created_at'>): number {
  const parsed = new Date(entry.updated_at ?? entry.created_at).getTime();
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

function websiteHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

function directionsHref(restaurant: RestaurantMeta | null): string | null {
  if (!restaurant) return null;
  return getGoogleMapsLink(
    restaurant.place_id,
    restaurant.address,
    restaurant.lat,
    restaurant.lng,
    restaurant.name,
    restaurant.place_type,
  );
}

function telHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  return `tel:${cleaned}`;
}

function FoodEntryEditorSheet({
  entry,
  open,
  saving,
  onClose,
  onSave,
}: {
  entry: FoodTimelineEntry | null;
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (entryId: string, payload: EntryUpdatePayload) => Promise<void>;
}) {
  const [tag, setTag] = useState<CanonicalTag>('none');
  const [note, setNote] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!entry || !open) return;
    setTag(entry.canonicalTag);
    setNote(entry.note ?? '');
    setPhotoFile(null);
  }, [entry, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open || !entry) return null;
  const canUploadPhoto = Boolean(entry.source_hangout_id && entry.source_dish_entry_id);

  return (
    <div className="fixed inset-0 z-[70] flex items-end">
      <button
        type="button"
        aria-label="Close editor"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />

      <section
        className="relative z-10 w-full rounded-t-2xl border border-app-border bg-app-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        onTouchStart={(event) => {
          touchStartY.current = event.touches[0]?.clientY ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStartY.current == null) return;
          const touchEnd = event.changedTouches[0]?.clientY;
          if (touchEnd == null) return;
          if (touchEnd - touchStartY.current > 70) {
            onClose();
          }
        }}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <button type="button" className="text-xs font-medium text-app-link" onClick={onClose}>
            Cancel
          </button>
          <div className="h-1.5 w-12 rounded-full bg-app-border" />
          <button
            type="button"
            onClick={() => void onSave(entry.id, { tag, note, photoFile })}
            className="text-xs font-semibold text-app-link"
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-app-text">Edit entry</p>

          <div className="space-y-1">
            <label className="text-xs text-app-muted">
              Tag
            </label>
            <div className="mb-1 inline-flex items-center gap-1 text-xs text-app-muted">
              <IdentityTagIcon tag={tag} showNone />
              <span>{TAG_LABELS[tag]}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-app-border bg-app-bg p-1.5">
              {TAG_ORDER.map((value) => {
                const active = tag === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-label={`Set tag ${TAG_LABELS[value]}`}
                    onClick={() => setTag(value)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                      active
                        ? 'border-app-primary bg-app-primary/10 text-app-primary'
                        : 'border-app-border bg-app-card text-app-muted'
                    }`}
                  >
                    <IdentityTagIcon tag={value} showNone className="h-5 w-5" />
                    <span>{TAG_LABELS[value]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-app-muted" htmlFor="entry-note">
              Note
            </label>
            <textarea
              id="entry-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={220}
              placeholder="Add a quick note"
              className="w-full rounded-lg border border-app-border bg-app-bg px-2 py-1.5 text-xs text-app-text"
            />
          </div>

          <div className="space-y-1">
            <p className="text-xs text-app-muted">Photo</p>
            <div className="flex items-center gap-2">
              {entry.photo?.signedUrls.thumb ? (
                <Image
                  src={entry.photo.signedUrls.thumb}
                  alt="Current dish photo"
                  width={56}
                  height={56}
                  className="h-12 w-12 rounded-lg object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-app-bg text-[10px] text-app-muted">None</div>
              )}
              <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-app-border px-2 text-xs text-app-text">
                {canUploadPhoto ? (photoFile ? 'Replace selected' : 'Add or replace') : 'Photo locked'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={!canUploadPhoto}
                  onChange={(event) => {
                    setPhotoFile(event.target.files?.[0] ?? null);
                  }}
                />
              </label>
              {!canUploadPhoto ? <span className="text-xs text-app-muted">Original hangout was deleted.</span> : null}
              {photoFile ? <span className="text-xs text-app-muted">{photoFile.name}</span> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function FoodDetailContent({ foodKey, showBackLink = false }: FoodDetailContentProps) {
  const [entries, setEntries] = useState<FoodTimelineEntry[]>([]);
  const [catalog, setCatalog] = useState<DishCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [savingEntryId, setSavingEntryId] = useState<string | null>(null);

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

    const [personalResult, catalogResponse, sessionResponse] = await Promise.all([
      supabase
        .from('personal_food_entries')
        .select('id,dish_name,dish_key,restaurant_id,reaction_tag,note,created_at,updated_at,price,source_hangout_id,source_dish_entry_id')
        .eq('user_id', user.id)
        .or('had_it.eq.true,rating.not.is.null,reaction_tag.not.is.null,note.not.is.null,photo_path.not.is.null')
        .eq('dish_key', foodKey)
        .order('updated_at', { ascending: false })
        .limit(200),
      supabase.from('dish_catalog').select('*').eq('dish_key', foodKey).maybeSingle(),
      supabase.auth.getSession(),
    ]);
    const parsedEntries = ((personalResult.data ?? []) as PersonalFoodEntry[]).sort((a, b) => entryTime(b) - entryTime(a));
    setCatalog((catalogResponse.data ?? null) as DishCatalog | null);

    const restaurantIds = Array.from(new Set(parsedEntries.map((row) => row.restaurant_id).filter((id): id is string => Boolean(id))));
    const restaurantLookup = new Map<string, RestaurantMeta>();

    if (restaurantIds.length > 0) {
      const { data: restaurantRows } = await supabase
        .from('restaurants')
        .select('id,place_type,name,place_id,address,lat,lng,phone_number,website,maps_url')
        .in('id', restaurantIds);
      for (const row of (restaurantRows ?? []) as RestaurantMeta[]) {
        restaurantLookup.set(row.id, row);
      }
    }

    const byEntryId: Record<string, SignedPhoto> = {};
    const accessToken = sessionResponse.data.session?.access_token;
    if (accessToken && parsedEntries.length > 0) {
      const sourceDishEntryIds = Array.from(
        new Set(parsedEntries.map((row) => row.source_dish_entry_id).filter((id): id is string => Boolean(id))),
      );
      const ids = sourceDishEntryIds.join(',');
      if (!ids) {
        setEntries(
          parsedEntries.map((entry) => ({
            ...entry,
            canonicalTag: normalizeTag(entry.reaction_tag),
            restaurant: entry.restaurant_id ? restaurantLookup.get(entry.restaurant_id) ?? null : null,
            photo: null,
          })),
        );
        setLoading(false);
        return;
      }
      const response = await fetch(`/api/photos/list?kind=dish&dish_entry_ids=${encodeURIComponent(ids)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (response.ok) {
        const payload = (await response.json()) as { photos?: SignedPhoto[] };
        const bySourceDishEntryId: Record<string, SignedPhoto> = {};
        for (const photo of payload.photos ?? []) {
          if (!photo.dish_entry_id) continue;
          if (!bySourceDishEntryId[photo.dish_entry_id]) {
            bySourceDishEntryId[photo.dish_entry_id] = photo;
          }
        }
        for (const entry of parsedEntries) {
          const sourceDishEntryId = entry.source_dish_entry_id;
          if (!sourceDishEntryId) continue;
          const photo = bySourceDishEntryId[sourceDishEntryId];
          if (photo) byEntryId[entry.id] = photo;
        }
      }
    }

    setEntries(
      parsedEntries.map((entry) => ({
        ...entry,
        canonicalTag: normalizeTag(entry.reaction_tag),
        restaurant: entry.restaurant_id ? restaurantLookup.get(entry.restaurant_id) ?? null : null,
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
      const key = monthKey(entry.updated_at ?? entry.created_at);
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

  const uniqueHeaderTags = useMemo(() => {
    const tags = new Set<CanonicalTag>();
    for (const entry of entries) {
      const canonical = normalizeTag(entry.canonicalTag);
      if (canonical === 'none') continue;
      tags.add(canonical);
    }
    return TAG_ORDER.filter((tag) => tag !== 'none' && tags.has(tag));
  }, [entries]);

  const latestEntry = entries[0] ?? null;
  const editingEntry = entries.find((entry) => entry.id === editingEntryId) ?? null;

  const saveEntry = async (entryId: string, payload: EntryUpdatePayload) => {
    const previous = entries;
    const nextIdentityTag = toDbTag(payload.tag);
    const nextNote = payload.note.trim() || null;

    setEntries((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              reaction_tag: nextIdentityTag,
              canonicalTag: payload.tag,
              note: nextNote,
            }
          : entry,
      ),
    );

    setSavingEntryId(entryId);

    const supabase = getBrowserSupabaseClient();
    const { error } = await supabase
      .from('personal_food_entries')
      .update({
        reaction_tag: nextIdentityTag,
        note: nextNote,
      })
      .eq('id', entryId);

    if (error) {
      setEntries(previous);
      setSavingEntryId(null);
      return;
    }

    if (payload.photoFile) {
      const targetEntry = previous.find((entry) => entry.id === entryId);
      if (targetEntry?.source_hangout_id && targetEntry.source_dish_entry_id) {
        const uploaded = await uploadDishPhoto(targetEntry.source_hangout_id, targetEntry.source_dish_entry_id, payload.photoFile);
        if (uploaded) {
          setEntries((current) => current.map((entry) => (entry.id === entryId ? { ...entry, photo: uploaded } : entry)));
        }
      }
    }

    setSavingEntryId(null);
    setEditingEntryId(null);
  };

  if (loading) {
    return <p className="empty-surface">Loading food details...</p>;
  }

  if (entries.length === 0) {
    return <p className="empty-surface">No food logs yet.</p>;
  }

  const title = catalog?.name_canonical ?? entries[0]?.dish_name ?? 'Food detail';

  return (
    <>
      <div className="space-y-2 pb-2">
        {showBackLink ? (
          <Link href="/food" className="inline-flex text-xs font-medium text-app-link">
            Back to Food
          </Link>
        ) : null}

        <header data-food-detail-header className="card-surface space-y-1 p-2.5">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-lg font-semibold leading-tight text-app-text">{title}</h1>
            <button
              type="button"
              aria-label="Edit tags"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-app-border text-app-muted"
              onClick={() => {
                if (latestEntry) setEditingEntryId(latestEntry.id);
              }}
            >
              <SlidersHorizontal size={14} />
            </button>
          </div>

          {catalog?.description ? <p className="text-xs leading-5 text-app-muted">{catalog.description}</p> : null}

            <div className="flex items-center gap-2 text-xs text-app-muted">
              <span>{entries.length} logged</span>
            </div>

          {uniqueHeaderTags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {uniqueHeaderTags.map((tag) => (
                <IdentityTagIcon key={tag} tag={tag} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-app-muted">No tags yet</p>
          )}
        </header>

        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Timeline</p>

          {groupedTimeline.map((group) => (
            <div key={group.key} className="space-y-1">
              <h2 className="text-sm font-semibold text-app-text">{group.label}</h2>

              <div className="divide-y divide-app-border rounded-2xl border border-app-border bg-app-card">
                {group.rows.map((entry) => {
                  const directions = directionsHref(entry.restaurant);
                  const call = telHref(entry.restaurant?.phone_number);
                  const website = websiteHref(entry.restaurant?.website);

                  return (
                    <article key={entry.id} className="space-y-1.5 px-3 py-2.5">
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
                            Add photo
                          </div>
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold leading-5 text-app-text">{entry.dish_name}</p>
                              <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs text-app-muted">{entry.restaurant?.name ?? 'Unknown restaurant'} · {formatTimestamp(entry.updated_at ?? entry.created_at)}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              {directions ? (
                                <a
                                  href={directions}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="Directions"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-app-border text-app-muted"
                                >
                                  <MapPinned size={14} />
                                </a>
                              ) : null}
                              {call ? (
                                <a href={call} aria-label="Call" className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-app-border text-app-muted">
                                  <Phone size={14} />
                                </a>
                              ) : null}
                              {website ? (
                                <a
                                  href={website}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="Website"
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-app-border text-app-muted"
                                >
                                  <Globe size={14} />
                                </a>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-app-muted">
                            <IdentityTagIcon tag={entry.canonicalTag} showNone />
                          </div>

                          {entry.note ? <p className="text-xs leading-5 text-app-muted">{entry.note}</p> : null}

                          <div className="flex items-center justify-between gap-2 text-xs text-app-muted">
                            <span>{entry.price != null ? `USD ${entry.price.toFixed(2)}` : 'Price unavailable'}</span>
                            <button
                              type="button"
                              className="font-medium text-app-link"
                              onClick={() => setEditingEntryId(entry.id)}
                            >
                              Edit entry
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </div>

      <FoodEntryEditorSheet
        entry={editingEntry}
        open={Boolean(editingEntry)}
        saving={Boolean(editingEntry && savingEntryId === editingEntry.id)}
        onClose={() => setEditingEntryId(null)}
        onSave={saveEntry}
      />
    </>
  );
}
