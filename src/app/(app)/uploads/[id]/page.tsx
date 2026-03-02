'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { identityTagOptions } from '@/components/IdentityTagPill';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishCatalog, DishEntry, DishIdentityTag, HangoutItem, ReceiptUpload, Restaurant, VisitParticipant } from '@/lib/supabase/types';
import { toDishKey } from '@/lib/utils';
import { normalizeName } from '@/lib/extraction/normalize';
import { getGoogleMapsLink } from '@/lib/google/mapsLinks';
import { SignedPhoto } from '@/lib/photos/types';
import { listDishPhotosForHangout, listHangoutPhotos, uploadDishPhoto, uploadHangoutPhoto } from '@/lib/data/photosRepo';

const VISIT_NOTE_MAX = 140;
const IDENTITY_EMOJI: Record<DishIdentityTag, string> = {
  go_to: '⭐',
  hidden_gem: '💎',
  special_occasion: '🥂',
  try_again: '🔁',
  never_again: '🚫',
};

type UnifiedDishRow = {
  hangoutItem: HangoutItem;
  myEntry: Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'> | null;
};

type LegacyLineItem = {
  id: string;
  upload_id: string;
  name_raw: string;
  name_final: string | null;
  quantity: number | null;
  unit_price: number | null;
  price_final: number | null;
  confidence: number | null;
  included: boolean;
  created_at: string;
};

type CrewMember = VisitParticipant & {
  display_name: string | null;
  avatar_url: string | null;
};

type ShareUserSuggestion = {
  id: string;
  email: string;
};
type RestaurantDirectory = Pick<
  Restaurant,
  | 'id'
  | 'name'
  | 'address'
  | 'place_id'
  | 'phone_number'
  | 'website'
  | 'maps_url'
  | 'opening_hours'
  | 'utc_offset_minutes'
  | 'google_rating'
  | 'price_level'
  | 'business_status'
  | 'last_place_sync'
>;

function isPlaceSyncStale(value: string | null): boolean {
  if (!value) return true;
  const stamp = new Date(value).getTime();
  if (Number.isNaN(stamp)) return true;
  return Date.now() - stamp > 30 * 24 * 60 * 60 * 1000;
}

function hasDirectoryData(restaurant: RestaurantDirectory | null): boolean {
  if (!restaurant) return false;
  return Boolean(restaurant.phone_number || restaurant.website || restaurant.opening_hours || restaurant.maps_url);
}

function getTodayHours(openingHours: Restaurant['opening_hours']): string | null {
  if (!openingHours || typeof openingHours !== 'object' || Array.isArray(openingHours)) return null;
  const weekdayText = (openingHours as { weekday_text?: unknown }).weekday_text;
  if (!Array.isArray(weekdayText) || weekdayText.length === 0) return null;
  const todayIndex = (new Date().getDay() + 6) % 7;
  const line = weekdayText[todayIndex];
  return typeof line === 'string' ? line : null;
}

function formatDate(value: string | null): string {
  if (!value) return 'Unknown date';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPrice(value: number | null): string {
  if (value == null) return 'Price unavailable';
  return `$${value.toFixed(2)}`;
}

function normalizeDish(value: string): string {
  return normalizeName(value) || value.trim().toLowerCase();
}

function EmojiRatingSelector({
  value,
  onChange,
}: {
  value: DishIdentityTag | null;
  onChange: (value: DishIdentityTag | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {identityTagOptions().map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(active ? null : option.value)}
            aria-label={`Rate as ${option.value.replace('_', ' ')}`}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-base transition-all duration-150 ${
              active
                ? 'scale-105 bg-app-primary/12 text-app-text'
                : 'text-app-text opacity-50 hover:opacity-80'
            }`}
          >
            {IDENTITY_EMOJI[option.value]}
          </button>
        );
      })}
    </div>
  );
}

export default function UploadDetailPage() {
  const params = useParams<{ id: string }>();
  const uploadId = params.id;

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [upload, setUpload] = useState<ReceiptUpload | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantDirectory | null>(null);

  const [dishes, setDishes] = useState<UnifiedDishRow[]>([]);
  const [catalogByDishKey, setCatalogByDishKey] = useState<Record<string, DishCatalog>>({});

  const [visitNote, setVisitNote] = useState('');
  const [openItemNotes, setOpenItemNotes] = useState<Record<string, boolean>>({});
  const [hiddenItemsOpen, setHiddenItemsOpen] = useState(false);

  const [participants, setParticipants] = useState<CrewMember[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSuggestions, setShareSuggestions] = useState<ShareUserSuggestion[]>([]);
  const [shareSuggestLoading, setShareSuggestLoading] = useState(false);
  const [shareFocused, setShareFocused] = useState(false);

  const [placeSyncLoading, setPlaceSyncLoading] = useState(false);
  const [hangoutPhotos, setHangoutPhotos] = useState<SignedPhoto[]>([]);
  const [dishPhotosByItemId, setDishPhotosByItemId] = useState<Record<string, SignedPhoto[]>>({});
  const [entryMetaById, setEntryMetaById] = useState<Record<string, { hangout_item_id: string | null; dish_name: string }>>({});
  const [lightboxPhotos, setLightboxPhotos] = useState<SignedPhoto[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [hangoutSheetOpen, setHangoutSheetOpen] = useState(false);
  const hangoutCameraInputRef = useRef<HTMLInputElement | null>(null);
  const hangoutUploadInputRef = useRef<HTMLInputElement | null>(null);
  const dishCameraInputRef = useRef<HTMLInputElement | null>(null);
  const dishUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [dishUploadTarget, setDishUploadTarget] = useState<{ hangoutItemId: string } | null>(null);
  const didAutoExtractRef = useRef(false);

  const isHost = Boolean(upload && currentUserId && upload.user_id === currentUserId);

  const isActiveParticipant = useMemo(
    () => Boolean(currentUserId && participants.some((row) => row.user_id === currentUserId && row.status === 'active')),
    [currentUserId, participants],
  );

  const canViewVisit = isHost || isActiveParticipant;
  const hasAnyExtractedItems = dishes.length > 0;
  const showExtractionPrompt = Boolean(isHost && upload && !hasAnyExtractedItems);

  const getAuthHeader = useCallback(async (): Promise<Record<string, string>> => {
    const supabase = getBrowserSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

  const enrichDishCatalog = useCallback(
    async (dishEntryId: string) => {
      const headers = await getAuthHeader();
      if (!headers.Authorization) return;

      await fetch('/api/dish-catalog/enrich', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({ dishEntryId }),
      });
    },
    [getAuthHeader],
  );

  const loadParticipants = useCallback(async () => {
    const headers = await getAuthHeader();
    const response = await fetch(`/api/visits/share?visitId=${encodeURIComponent(uploadId)}`, { headers });

    if (!response.ok) {
      setParticipants([]);
      return;
    }

    const payload = (await response.json()) as { participants?: CrewMember[] };
    setParticipants(payload.participants ?? []);
  }, [getAuthHeader, uploadId]);


  const loadHangoutPhotos = useCallback(async () => {
    const photos = await listHangoutPhotos(uploadId);
    setHangoutPhotos(photos);
  }, [uploadId]);

  const loadDishPhotos = useCallback(
    async (entryMap: Record<string, { hangout_item_id: string | null; dish_name: string }>) => {
      const photos = await listDishPhotosForHangout(uploadId);
      const grouped: Record<string, SignedPhoto[]> = {};
      for (const photo of photos) {
        if (!photo.dish_entry_id) continue;
        const meta = entryMap[photo.dish_entry_id];
        if (!meta) continue;
        const key = meta.hangout_item_id ?? normalizeDish(meta.dish_name);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(photo);
      }
      Object.keys(grouped).forEach((key) => {
        grouped[key] = grouped[key].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      });
      setDishPhotosByItemId(grouped);
    },
    [uploadId],
  );

  const load = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    setCurrentUserId(user?.id ?? null);

    const { data: uploadData } = await supabase.from('receipt_uploads').select('*').eq('id', uploadId).single();

    const typedUpload = uploadData as ReceiptUpload | null;
    setUpload(typedUpload);

    if (!typedUpload || !user) {
      setRestaurant(null);
      setDishes([]);
      setVisitNote('');
      setParticipants([]);
      return;
    }

    const restaurantPromise = typedUpload.restaurant_id
      ? supabase.from('restaurants').select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync').eq('id', typedUpload.restaurant_id).single()
      : Promise.resolve({ data: null });

    const hangoutItemsResult = await supabase
      .from('hangout_items')
      .select('*')
      .eq('hangout_id', uploadId)
      .eq('included', true)
      .order('created_at', { ascending: true });

    let hangoutItems = (hangoutItemsResult.data ?? []) as HangoutItem[];
    if (hangoutItemsResult.error) {
      const legacyItemsResult = await supabase
        .from('extracted_line_items')
        .select('id,upload_id,name_raw,name_final,quantity,unit_price,price_final,confidence,included,created_at')
        .eq('upload_id', uploadId)
        .eq('included', true)
        .order('created_at', { ascending: true });

      const legacyRows = (legacyItemsResult.data ?? []) as LegacyLineItem[];
      hangoutItems = legacyRows.map((row) => ({
        id: row.id,
        hangout_id: row.upload_id,
        source_id: null,
        name_raw: row.name_raw,
        name_final: row.name_final,
        quantity: Math.max(1, row.quantity ?? 1),
        unit_price: row.unit_price ?? row.price_final,
        currency: typedUpload.currency_detected ?? 'USD',
        line_total: null,
        confidence: row.confidence,
        included: row.included,
        created_at: row.created_at,
      }));
    }

    let myEntries = [] as Array<Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>>;
    const myEntriesPrimary = await supabase
      .from('dish_entries')
      .select('id,hangout_item_id,dish_name,dish_key,identity_tag,comment')
      .eq('hangout_id', uploadId)
      .eq('user_id', user.id);

    if (myEntriesPrimary.error) {
      const myEntriesFallback = await supabase
        .from('dish_entries')
        .select('id,dish_name,dish_key,identity_tag,comment')
        .eq('source_upload_id', uploadId)
        .eq('user_id', user.id);

      myEntries = ((myEntriesFallback.data ?? []) as Array<Pick<DishEntry, 'id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>>).map(
        (entry) => ({ ...entry, hangout_item_id: null }),
      );
    } else {
      myEntries = (myEntriesPrimary.data ?? []) as Array<
        Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>
      >;
    }

    const allEntriesPrimary = await supabase.from('dish_entries').select('id,hangout_item_id,dish_name').eq('hangout_id', uploadId);
    const allEntriesResult =
      allEntriesPrimary.error
        ? await supabase.from('dish_entries').select('id,dish_name').eq('source_upload_id', uploadId)
        : allEntriesPrimary;
    const entryMap: Record<string, { hangout_item_id: string | null; dish_name: string }> = {};
    for (const entry of (allEntriesResult.data ?? []) as Array<Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name'>>) {
      entryMap[entry.id] = {
        hangout_item_id: entry.hangout_item_id ?? null,
        dish_name: entry.dish_name,
      };
    }

    const restaurantData = await restaurantPromise;

    const byItemId = new Map<string, Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>>();
    const byName = new Map<string, Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>>();

    for (const entry of myEntries) {
      if (entry.hangout_item_id) {
        byItemId.set(entry.hangout_item_id, entry);
      } else {
        const key = normalizeDish(entry.dish_name);
        if (!byName.has(key)) byName.set(key, entry);
      }
    }

    const unifiedRows: UnifiedDishRow[] = hangoutItems.map((hangoutItem) => {
      const direct = byItemId.get(hangoutItem.id) ?? null;
      if (direct) return { hangoutItem, myEntry: direct };
      const key = normalizeDish(hangoutItem.name_final || hangoutItem.name_raw);
      return { hangoutItem, myEntry: byName.get(key) ?? null };
    });

    const restaurantNameForKey = ((restaurantData.data ?? null) as RestaurantDirectory | null)?.name ?? 'unknown-restaurant';
    const dishKeys = Array.from(
      new Set(
        unifiedRows.map((row) => {
          const dishName = row.hangoutItem.name_final || row.hangoutItem.name_raw;
          return toDishKey(`${restaurantNameForKey} ${dishName}`);
        }),
      ),
    );

    let nextCatalogByDishKey: Record<string, DishCatalog> = {};
    if (dishKeys.length > 0) {
      const { data: catalogRows } = await supabase
        .from('dish_catalog')
        .select('*')
        .in('dish_key', dishKeys);
      const typedRows = (catalogRows ?? []) as DishCatalog[];
      nextCatalogByDishKey = Object.fromEntries(typedRows.map((row) => [row.dish_key, row]));
    }

    setDishes(unifiedRows);
    setCatalogByDishKey(nextCatalogByDishKey);
    setEntryMetaById(entryMap);
    setRestaurant((restaurantData.data ?? null) as RestaurantDirectory | null);
    setVisitNote(typedUpload.visit_note ?? '');

    await loadParticipants();
  }, [loadParticipants, uploadId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!upload) return;
    void loadHangoutPhotos();
  }, [loadHangoutPhotos, upload]);

  useEffect(() => {
    if (!upload) return;
    void loadDishPhotos(entryMetaById);
  }, [entryMetaById, loadDishPhotos, upload]);


  useEffect(() => {
    if (!isHost || shareEmail.trim().length < 2) {
      setShareSuggestions([]);
      setShareSuggestLoading(false);
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setShareSuggestLoading(true);
        const headers = await getAuthHeader();
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(shareEmail.trim())}`, { headers });

        if (!response.ok) {
          setShareSuggestions([]);
          return;
        }

        const payload = (await response.json()) as { users?: ShareUserSuggestion[] };
        setShareSuggestions(payload.users ?? []);
      } finally {
        setShareSuggestLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [getAuthHeader, isHost, shareEmail]);

  const runExtraction = useCallback(async () => {
    await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });
    await load();
  }, [load, uploadId]);


  const syncPlaceDirectory = useCallback(async () => {
    if (!restaurant?.id || !restaurant.place_id) return;
    if (!isPlaceSyncStale(restaurant.last_place_sync) && hasDirectoryData(restaurant)) return;

    setPlaceSyncLoading(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      };

      const response = await fetch('/api/places/sync', {
        method: 'POST',
        headers,
        body: JSON.stringify({ restaurant_id: restaurant.id }),
      });

      if (!response.ok) return;

      const payload = (await response.json()) as { ok?: boolean; restaurant?: RestaurantDirectory };
      if (payload.ok && payload.restaurant) {
        setRestaurant(payload.restaurant);
      }
    } finally {
      setPlaceSyncLoading(false);
    }
  }, [getAuthHeader, restaurant]);

  useEffect(() => {
    if (!restaurant?.place_id) return;
    if (!isPlaceSyncStale(restaurant.last_place_sync) && hasDirectoryData(restaurant)) return;
    void syncPlaceDirectory();
  }, [restaurant, syncPlaceDirectory]);

  useEffect(() => {
    if (didAutoExtractRef.current) return;
    if (!isHost || !upload) return;
    if (!upload.image_paths || upload.image_paths.length === 0) return;
    if (hasAnyExtractedItems) return;

    didAutoExtractRef.current = true;
    void runExtraction();
  }, [hasAnyExtractedItems, isHost, runExtraction, upload]);

  const upsertMyDishEntry = useCallback(
    async (row: UnifiedDishRow, patch: { identity_tag?: DishIdentityTag | null; comment?: string }) => {
      if (!upload || !currentUserId) return;

      const dishName = row.hangoutItem.name_final || row.hangoutItem.name_raw;
      const dishKey = toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
      const nextIdentity = patch.identity_tag !== undefined ? patch.identity_tag : row.myEntry?.identity_tag ?? null;
      const nextComment = patch.comment !== undefined ? patch.comment : row.myEntry?.comment ?? null;

      const payload = {
        user_id: currentUserId,
        restaurant_id: upload.restaurant_id,
        hangout_id: upload.id,
        hangout_item_id: row.hangoutItem.id,
        dish_name: dishName,
        price_original: row.hangoutItem.unit_price,
        currency_original: upload.currency_detected || 'USD',
        price_usd: row.hangoutItem.unit_price,
        quantity: row.hangoutItem.quantity,
        eaten_at: upload.visited_at ?? upload.created_at,
        source_upload_id: upload.id,
        dish_key: dishKey,
        identity_tag: nextIdentity,
        comment: nextComment?.trim() ? nextComment.trim() : null,
      };

      const supabase = getBrowserSupabaseClient();
      // First, upgrade any legacy row keyed by (user_id, source_upload_id, dish_key).
      const { data: legacyExisting } = await supabase
        .from('dish_entries')
        .select('id')
        .eq('user_id', currentUserId)
        .eq('source_upload_id', upload.id)
        .eq('dish_key', dishKey)
        .maybeSingle();

      if (legacyExisting?.id) {
        const { data: updatedLegacy, error: updatedLegacyError } = await supabase
          .from('dish_entries')
          .update(payload)
          .eq('id', legacyExisting.id)
          .select('id,hangout_item_id,dish_name,dish_key,identity_tag,comment')
          .single();

        if (!updatedLegacyError && updatedLegacy) {
          const savedLegacy = updatedLegacy as Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>;
          setDishes((prev) =>
            prev.map((entry) =>
              entry.hangoutItem.id === row.hangoutItem.id
                ? {
                    ...entry,
                    myEntry: savedLegacy,
                  }
                : entry,
            ),
          );
          void enrichDishCatalog(savedLegacy.id);
          return;
        }
      }

      let saved: Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'> | null = null;
      const primaryResult = await supabase
        .from('dish_entries')
        .upsert(payload, { onConflict: 'user_id,hangout_item_id' })
        .select('id,hangout_item_id,dish_name,dish_key,identity_tag,comment')
        .single();

      if (!primaryResult.error && primaryResult.data) {
        saved = primaryResult.data as Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>;
      } else {
        const fallbackPayload = {
          ...payload,
          hangout_item_id: undefined,
        };
        const fallbackResult = await supabase
          .from('dish_entries')
          .upsert(fallbackPayload, { onConflict: 'user_id,source_upload_id,dish_key' })
          .select('id,dish_name,dish_key,identity_tag,comment')
          .single();
        if (!fallbackResult.error && fallbackResult.data) {
          const row = fallbackResult.data as Pick<DishEntry, 'id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>;
          saved = { ...row, hangout_item_id: null };
        }
      }

      if (!saved) return;
      void enrichDishCatalog(saved.id);
      setDishes((prev) =>
        prev.map((entry) =>
          entry.hangoutItem.id === row.hangoutItem.id
            ? {
                ...entry,
                myEntry: saved,
              }
            : entry,
        ),
      );
    },
    [currentUserId, enrichDishCatalog, restaurant?.name, upload],
  );

  const ensureDishEntryForRow = useCallback(
    async (row: UnifiedDishRow): Promise<Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'> | null> => {
      if (row.myEntry?.id) return row.myEntry;
      await upsertMyDishEntry(row, {});
      if (!currentUserId || !upload?.id) return null;
      const supabase = getBrowserSupabaseClient();
      const primary = await supabase
        .from('dish_entries')
        .select('id,hangout_item_id,dish_name,dish_key,identity_tag,comment')
        .eq('user_id', currentUserId)
        .eq('hangout_id', upload.id)
        .eq('hangout_item_id', row.hangoutItem.id)
        .maybeSingle();
      if (!primary.error && primary.data) {
        return primary.data as Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>;
      }

      const dishName = row.hangoutItem.name_final || row.hangoutItem.name_raw;
      const dishKey = toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
      const legacy = await supabase
        .from('dish_entries')
        .select('id,dish_name,dish_key,identity_tag,comment')
        .eq('user_id', currentUserId)
        .eq('source_upload_id', upload.id)
        .eq('dish_key', dishKey)
        .maybeSingle();
      if (!legacy.error && legacy.data) {
        const entry = legacy.data as Pick<DishEntry, 'id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>;
        return { ...entry, hangout_item_id: null };
      }
      return null;
    },
    [currentUserId, restaurant?.name, upload?.id, upsertMyDishEntry],
  );

  const handleUploadHangoutPhoto = useCallback(
    async (file: File) => {
      if (!upload?.id) return;
      const created = await uploadHangoutPhoto(upload.id, file);
      if (created) {
        await loadHangoutPhotos();
      }
    },
    [loadHangoutPhotos, upload?.id],
  );

  const handleUploadDishPhoto = useCallback(
    async (row: UnifiedDishRow, file: File) => {
      if (!upload?.id) return;
      const ensured = await ensureDishEntryForRow(row);
      if (!ensured?.id) return;
      const created = await uploadDishPhoto(upload.id, ensured.id, file);
      if (created) {
        await load();
      }
    },
    [ensureDishEntryForRow, load, upload?.id],
  );

  const addParticipant = async () => {
    const email = shareEmail.trim().toLowerCase();
    if (!email || !upload) return;

    setShareLoading(true);
    setShareError(null);

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      };

      const response = await fetch('/api/visits/share', {
        method: 'POST',
        headers,
        body: JSON.stringify({ visitId: upload.id, email }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ error: 'Could not add buddy' }))) as { error?: string };
        throw new Error(payload.error ?? 'Could not add buddy');
      }

      setShareEmail('');
      await loadParticipants();
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not add buddy');
    } finally {
      setShareLoading(false);
    }
  };

  const removeParticipant = async (participantId: string) => {
    if (!upload) return;

    setShareLoading(true);
    setShareError(null);

    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      };

      const response = await fetch('/api/visits/share', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ visitId: upload.id, participantId }),
      });

      if (!response.ok) {
        throw new Error('Could not remove buddy');
      }

      await loadParticipants();
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not remove buddy');
    } finally {
      setShareLoading(false);
    }
  };

  if (!upload) {
    return <div className="text-sm text-app-muted">Loading hangout...</div>;
  }

  if (currentUserId && !canViewVisit) {
    return <div className="card-surface text-sm text-app-muted">You do not have access to this hangout.</div>;
  }

  const visitDate = formatDate(upload.visited_at ?? upload.created_at);
  const isSharedVisit = Boolean(upload.is_shared);
  const showHostShareSection = isHost && isSharedVisit;
  const visibleDishes = dishes.filter((row) => row.hangoutItem.included);
  const hiddenDishes = dishes.filter((row) => !row.hangoutItem.included);
  const withNames = participants
    .filter((participant) => participant.status === 'active')
    .map((participant) => participant.display_name ?? 'Buddy');
  const withLabel = withNames.length > 0 ? withNames.join(', ') : 'Solo';
  const directionsHref = getGoogleMapsLink(restaurant?.place_id, restaurant?.address, restaurant?.name);
  const todayHours = getTodayHours(restaurant?.opening_hours ?? null);
  const openNow =
    restaurant?.opening_hours && typeof restaurant.opening_hours === 'object' && !Array.isArray(restaurant.opening_hours)
      ? (restaurant.opening_hours as { open_now?: boolean }).open_now
      : undefined;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 pb-4">
      <div className="card-surface p-3 space-y-2">
        <h1 className="text-2xl font-semibold leading-7 text-app-text">{restaurant?.name ?? 'Unknown restaurant'}</h1>
        <p className="text-xs leading-4 text-app-muted">
          {visitDate} · With {withLabel}
        </p>
        {visitNote && <p className="text-sm italic leading-5 text-app-text">“{visitNote}”</p>}

        <div className="flex flex-wrap gap-2">
          {directionsHref && (
            <a
              href={directionsHref}
              target="_blank"
              rel="noreferrer"
              aria-label="Open directions"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-app-border bg-app-card px-3 text-base"
            >
              🧭
            </a>
          )}
          {restaurant?.phone_number && (
            <a
              href={`tel:${restaurant.phone_number}`}
              aria-label="Call restaurant"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-app-border bg-app-card px-3 text-base"
            >
              📞
            </a>
          )}
          {restaurant?.website && (
            <a
              href={restaurant.website}
              target="_blank"
              rel="noreferrer"
              aria-label="Open website"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-app-border bg-app-card px-3 text-base"
            >
              🌐
            </a>
          )}
          {restaurant?.address && <p className="flex items-center text-xs leading-4 text-app-muted">📍 {restaurant.address}</p>}
          {openNow === true && <p className="flex items-center text-xs leading-4 text-emerald-700 dark:text-emerald-300">🟢 Open now</p>}
          {openNow === false && <p className="flex items-center text-xs leading-4 text-app-muted">🔴 Closed now</p>}
          {todayHours ? (
            <p className="flex items-center text-xs leading-4 text-app-muted">🕒 {todayHours}</p>
          ) : placeSyncLoading ? (
            <p className="flex items-center text-xs leading-4 text-app-muted">🕒 Syncing hours...</p>
          ) : (
            <p className="flex items-center text-xs leading-4 text-app-muted">🕒 Hours not available yet.</p>
          )}
        </div>
      </div>
      <input
        ref={hangoutCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleUploadHangoutPhoto(file);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={hangoutUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleUploadHangoutPhoto(file);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={dishCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && dishUploadTarget) {
            const row = dishes.find((entry) => entry.hangoutItem.id === dishUploadTarget.hangoutItemId);
            if (row) void handleUploadDishPhoto(row, file);
          }
          event.currentTarget.value = '';
          setDishUploadTarget(null);
        }}
      />
      <input
        ref={dishUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && dishUploadTarget) {
            const row = dishes.find((entry) => entry.hangoutItem.id === dishUploadTarget.hangoutItemId);
            if (row) void handleUploadDishPhoto(row, file);
          }
          event.currentTarget.value = '';
          setDishUploadTarget(null);
        }}
      />
      {hangoutPhotos.length > 0 ? (
        <div className="card-surface p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="section-label">Hangout photos</h2>
            <Button type="button" variant="secondary" size="sm" fullWidth={false} className="h-9 px-2 text-xs" onClick={() => setHangoutSheetOpen(true)}>
              Add hangout photo
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {hangoutPhotos.map((photo, index) => (
              <button
                key={photo.id}
                type="button"
                className="relative overflow-hidden rounded-lg border border-app-border"
                onClick={() => {
                  setLightboxPhotos(hangoutPhotos);
                  setLightboxIndex(index);
                }}
              >
                {photo.signedUrls.thumb ? (
                  <Image src={photo.signedUrls.thumb} alt="Hangout thumbnail" width={200} height={200} className="h-24 w-full object-cover" unoptimized />
                ) : (
                  <div className="h-24 w-full bg-app-card" />
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <Button type="button" variant="secondary" size="sm" fullWidth={false} className="h-9 px-2 text-xs" onClick={() => setHangoutSheetOpen(true)}>
            Add hangout photo
          </Button>
        </div>
      )}

      {hangoutSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setHangoutSheetOpen(false)} />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3">
            <div className="space-y-2">
              <Button type="button" onClick={() => { setHangoutSheetOpen(false); hangoutCameraInputRef.current?.click(); }}>
                Take photo
              </Button>
              <Button type="button" variant="secondary" onClick={() => { setHangoutSheetOpen(false); hangoutUploadInputRef.current?.click(); }}>
                Upload photo
              </Button>
            </div>
          </div>
        </div>
      )}

      {showHostShareSection && (
        <div className="card-surface p-3 space-y-2">
          <h2 className="section-label">Who was in your crew?</h2>
          <div className="relative">
            <div className="flex gap-2">
              <Input
                value={shareEmail}
                onFocus={() => setShareFocused(true)}
                onBlur={() => window.setTimeout(() => setShareFocused(false), 120)}
                onChange={(event) => setShareEmail(event.target.value)}
                placeholder="Search by email or type full email"
                type="email"
              />
              <Button type="button" variant="secondary" fullWidth={false} onClick={addParticipant} disabled={shareLoading}>
                Invite a buddy
              </Button>
            </div>
            {shareFocused && shareEmail.trim().length >= 2 && (
              <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-app-border bg-app-card shadow-sm">
                {shareSuggestLoading && <p className="p-3 text-xs text-app-muted">Searching users...</p>}
                {!shareSuggestLoading && shareSuggestions.length === 0 && (
                  <p className="p-3 text-xs text-app-muted">No user match. You can still invite this email.</p>
                )}
                {!shareSuggestLoading &&
                  shareSuggestions.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setShareEmail(user.email);
                        setShareSuggestions([]);
                        setShareFocused(false);
                      }}
                      className="w-full border-b border-app-border px-3 py-2 text-left last:border-b-0"
                    >
                      <p className="text-sm text-app-text">{user.email}</p>
                    </button>
                  ))}
              </div>
            )}
          </div>
          {shareError && <p className="text-xs text-rose-700 dark:text-rose-300">{shareError}</p>}
          <div className="space-y-1.5">
            {participants.length === 0 ? (
              <p className="text-xs text-app-muted">No crew yet. Add your buddies.</p>
            ) : (
              participants.map((participant) => (
                <div key={participant.id} className="flex items-center justify-between gap-2 rounded-xl border border-app-border bg-app-card px-2.5 py-2">
                  <div>
                    <p className="text-sm font-semibold leading-5 text-app-text">{participant.display_name ?? 'Crew member'}</p>
                    <p className="text-xs leading-4 text-app-muted">In your crew</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    className="h-11 px-3 text-xs"
                    onClick={() => removeParticipant(participant.id)}
                    disabled={shareLoading}
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div className="card-surface p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-label">Dishes</h2>
          {isHost &&
            (showExtractionPrompt ? (
              <Button type="button" onClick={runExtraction}>
                Scan receipt
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => void runExtraction()}
                className="inline-flex h-11 items-center text-xs font-medium text-app-link underline underline-offset-2"
              >
                Re-scan receipt
              </button>
            ))}
        </div>

        {visibleDishes.length > 0 ? (
          <div className="divide-y divide-app-border/60">
            {visibleDishes.map((row) => {
              const dishName = row.hangoutItem.name_final || row.hangoutItem.name_raw;
              const quantity = Math.max(1, row.hangoutItem.quantity ?? 1);
              const unitPrice = row.hangoutItem.unit_price;
              const noteOpen = openItemNotes[row.hangoutItem.id] || Boolean(row.myEntry?.comment);
              const identityValue = row.myEntry?.identity_tag ?? null;
              const isNeverAgain = identityValue === 'never_again';
              const rowPhotos = dishPhotosByItemId[row.hangoutItem.id] ?? dishPhotosByItemId[normalizeDish(dishName)] ?? [];
              const dishKey = row.myEntry?.dish_key ?? toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
              const catalog = catalogByDishKey[dishKey] ?? null;

              return (
                <div key={row.hangoutItem.id} className={`space-y-1.5 p-2 ${isNeverAgain ? 'opacity-60' : ''}`}>
                  <div className="flex min-h-11 items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-semibold leading-5 text-app-text ${isNeverAgain ? 'line-through' : ''}`}>
                        {dishName}
                        {quantity > 1 ? ` ×${quantity}` : ''}
                      </p>
                      {catalog?.description ? (
                        <p className="line-clamp-2 text-xs leading-4 text-app-muted">{catalog.description}</p>
                      ) : null}
                      {catalog?.cuisine || (catalog?.flavor_tags && catalog.flavor_tags.length > 0) ? (
                        <p className="text-[11px] leading-4 text-app-muted">
                          {catalog.cuisine ? `${catalog.cuisine}` : ''}
                          {catalog.cuisine && catalog.flavor_tags && catalog.flavor_tags.length > 0 ? ' · ' : ''}
                          {catalog.flavor_tags?.join(' · ')}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-sm font-medium leading-5 text-app-text">{formatPrice(unitPrice)}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-app-border text-sm"
                      onClick={() => {
                        setDishUploadTarget({ hangoutItemId: row.hangoutItem.id });
                        dishUploadInputRef.current?.click();
                      }}
                      aria-label="Add dish photo"
                    >
                      📷
                    </button>
                    {rowPhotos.slice(0, 2).map((photo, index) => (
                      <button
                        key={photo.id}
                        type="button"
                        className="h-9 w-9 overflow-hidden rounded-md border border-app-border"
                        onClick={() => {
                          setLightboxPhotos(rowPhotos);
                          setLightboxIndex(index);
                        }}
                        aria-label="Open dish photo"
                      >
                        {photo.signedUrls.thumb ? (
                          <Image src={photo.signedUrls.thumb} alt="Dish photo" width={40} height={40} className="h-full w-full object-cover" unoptimized />
                        ) : (
                          <span className="text-[10px] text-app-muted">img</span>
                        )}
                      </button>
                    ))}
                    {rowPhotos.length > 2 && <span className="text-xs text-app-muted">+{rowPhotos.length - 2}</span>}
                  </div>

                  <EmojiRatingSelector
                    value={identityValue}
                    onChange={(value) => {
                      setDishes((prev) =>
                        prev.map((entry) =>
                          entry.hangoutItem.id === row.hangoutItem.id
                            ? {
                                ...entry,
                                myEntry: {
                                  id: entry.myEntry?.id ?? `tmp-${entry.hangoutItem.id}`,
                                  hangout_item_id: entry.hangoutItem.id,
                                  dish_name: dishName,
                                  dish_key: entry.myEntry?.dish_key ?? toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`),
                                  identity_tag: value,
                                  comment: entry.myEntry?.comment ?? null,
                                },
                              }
                            : entry,
                        ),
                      );
                      void upsertMyDishEntry(row, { identity_tag: value });
                    }}
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setOpenItemNotes((prev) => ({
                        ...prev,
                        [row.hangoutItem.id]: !noteOpen,
                      }))
                    }
                    className="inline-flex h-11 items-center text-xs font-medium text-app-link underline underline-offset-2"
                  >
                    {noteOpen ? 'Hide note' : 'Add note…'}
                  </button>

                  {noteOpen && (
                    <Input
                      value={row.myEntry?.comment ?? ''}
                      maxLength={140}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDishes((prev) =>
                          prev.map((entry) =>
                            entry.hangoutItem.id === row.hangoutItem.id
                              ? {
                                  ...entry,
                                  myEntry: {
                                    id: entry.myEntry?.id ?? `tmp-${entry.hangoutItem.id}`,
                                    hangout_item_id: entry.hangoutItem.id,
                                    dish_name: dishName,
                                    dish_key: entry.myEntry?.dish_key ?? toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`),
                                    identity_tag: entry.myEntry?.identity_tag ?? null,
                                    comment: value,
                                  },
                                }
                              : entry,
                          ),
                        );
                        void upsertMyDishEntry(row, { comment: value });
                      }}
                      placeholder="Add note…"
                    />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-app-muted">
            {hiddenDishes.length > 0 ? 'All extracted lines are hidden (fees/tax/tip).' : 'No dishes yet. Scan the receipt to start your recap.'}
          </p>
        )}

        {hiddenDishes.length > 0 && (
          <div className="pt-1">
            <button
              type="button"
              className="inline-flex h-9 items-center text-xs font-medium text-app-link underline underline-offset-2"
              onClick={() => setHiddenItemsOpen((prev) => !prev)}
            >
              {hiddenItemsOpen ? 'Hide hidden items' : `Hidden items (${hiddenDishes.length})`}
            </button>
            {hiddenItemsOpen && (
              <div className="mt-1 divide-y divide-app-border/50 rounded-lg border border-app-border/70 bg-app-card/50">
                {hiddenDishes.map((row) => {
                  const name = row.hangoutItem.name_final || row.hangoutItem.name_raw;
                  const qty = Math.max(1, row.hangoutItem.quantity ?? 1);
                  return (
                    <div key={`hidden-${row.hangoutItem.id}`} className="flex items-center justify-between p-2 text-xs text-app-muted">
                      <span className="truncate">
                        {name}
                        {qty > 1 ? ` ×${qty}` : ''}
                      </span>
                      <span>{formatPrice(row.hangoutItem.unit_price)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {isHost && (
        <div className="card-surface p-3 space-y-2">
          <h2 className="section-label">Overall vibe</h2>
          <Input
            value={visitNote}
            maxLength={VISIT_NOTE_MAX}
            onChange={(e) => setVisitNote(e.target.value.slice(0, VISIT_NOTE_MAX))}
            placeholder="Share the vibe in one line"
          />
          <p className="text-xs text-app-muted">{visitNote.length}/{VISIT_NOTE_MAX}</p>
        </div>
      )}

      {lightboxPhotos.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => {
              setLightboxPhotos([]);
              setLightboxIndex(0);
            }}
          />
          <div className="relative z-10 w-full max-w-3xl p-3">
            <div className="relative overflow-hidden rounded-xl bg-black">
              {lightboxPhotos[lightboxIndex]?.signedUrls.original || lightboxPhotos[lightboxIndex]?.signedUrls.medium ? (
                <Image
                  src={lightboxPhotos[lightboxIndex].signedUrls.original ?? lightboxPhotos[lightboxIndex].signedUrls.medium ?? ''}
                  alt="Photo"
                  width={1600}
                  height={1200}
                  className="max-h-[75vh] w-full object-contain"
                  unoptimized
                />
              ) : (
                <div className="h-72 w-full" />
              )}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fullWidth={false}
                className="h-9 px-2 text-xs"
                onClick={() => setLightboxIndex((prev) => (prev - 1 + lightboxPhotos.length) % lightboxPhotos.length)}
              >
                Prev
              </Button>
              <span className="text-xs text-white">
                {lightboxIndex + 1} / {lightboxPhotos.length}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fullWidth={false}
                className="h-9 px-2 text-xs"
                onClick={() => setLightboxIndex((prev) => (prev + 1) % lightboxPhotos.length)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
