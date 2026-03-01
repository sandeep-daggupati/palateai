'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { IdentityTagPill, identityTagOptions } from '@/components/IdentityTagPill';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishEntry, DishIdentityTag, Hangout, HangoutItem, Restaurant } from '@/lib/supabase/types';
import { toDishKey } from '@/lib/utils';
import { buildGroupKey, normalizeName } from '@/lib/extraction/normalize';
import { getGoogleMapsLink } from '@/lib/google/mapsLinks';
import { SignedPhoto } from '@/lib/photos/types';
import { uploadOriginalPhotoDirect } from '@/lib/photos/clientUpload';

const QUICK_NOTE_CHIPS = ['Great value', 'Would repeat', 'Too salty', 'Spicy', 'Slow service', 'Amazing dessert'];
const VISIT_NOTE_MAX = 140;

type ReviewItem = {
  id: string;
  upload_id: string;
  name_raw: string;
  name_final: string | null;
  price_raw: number | null;
  price_final: number | null;
  confidence: number | null;
  included: boolean;
  quantity: number | null;
  unit_price: number | null;
  group_key: string | null;
  grouped: boolean | null;
  duplicate_of: string | null;
  rating: number | null;
  comment: string | null;
  created_at: string;
  identity_tag: DishIdentityTag | null;
};

type VisitDish = Pick<DishEntry, 'id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment' | 'created_at' | 'eaten_at' | 'user_id'>;

type PersonalDishDraft = {
  dish_key: string;
  dish_name: string;
  price: number | null;
  quantity: number;
  identity_tag: DishIdentityTag | null;
  comment: string;
  had_it: boolean;
};

type ReviewRenderRow = {
  key: string;
  baseGroupKey: string;
  itemIndexes: number[];
  quantity: number;
  split: boolean;
};

type CrewMember = {
  id: string;
  visit_id: string;
  user_id: string | null;
  role: 'host' | 'participant';
  invited_email: string | null;
  status: 'active';
  created_at: string;
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

function getReviewGroupKey(item: ReviewItem, fallbackCurrency: string | null): string {
  if (item.group_key) return item.group_key;
  const normalized = normalizeName(item.name_final || item.name_raw);
  const unitPrice = item.unit_price ?? item.price_final;
  return buildGroupKey({
    normalizedName: normalized || (item.name_final || item.name_raw).toLowerCase(),
    unitPrice,
    currency: fallbackCurrency,
  });
}

function IdentitySelector({
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
              aria-label={`Set identity to ${option.value.replace('_', ' ')}`}
              className={`inline-flex h-10 items-center gap-1 rounded-full border px-3 text-xs font-semibold tracking-wide transition-colors duration-200 ${
                active
                  ? option.value === 'never_again'
                    ? 'border-rose-500 bg-rose-100 text-rose-800 outline outline-2 outline-offset-2 outline-rose-500 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-200 dark:outline-rose-400'
                    : 'border-2 border-app-primary bg-app-card text-app-text shadow-sm ring-2 ring-app-accent/50 ring-offset-1 ring-offset-transparent'
                  : 'border-app-border bg-app-card text-app-muted hover:bg-app-card/80 hover:text-app-text'
              }`}
            >
              {option.label}
            </button>
          );
        })}
    </div>
  );
}

export default function UploadDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const uploadId = params.id;

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [upload, setUpload] = useState<Hangout | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantDirectory | null>(null);
  const [receiptSourceId, setReceiptSourceId] = useState<string | null>(null);

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [visitDishes, setVisitDishes] = useState<VisitDish[]>([]);
  const [personalDrafts, setPersonalDrafts] = useState<PersonalDishDraft[]>([]);

  const [visitNote, setVisitNote] = useState('');
  const [openItemNotes, setOpenItemNotes] = useState<Record<string, boolean>>({});
  const [splitGroupKeys, setSplitGroupKeys] = useState<Record<string, boolean>>({});

  const [participants, setParticipants] = useState<CrewMember[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSuggestions, setShareSuggestions] = useState<ShareUserSuggestion[]>([]);
  const [shareSuggestLoading, setShareSuggestLoading] = useState(false);
  const [shareFocused, setShareFocused] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savingExperience, setSavingExperience] = useState(false);
  const [placeSyncLoading, setPlaceSyncLoading] = useState(false);
  const [hangoutPhotos, setHangoutPhotos] = useState<SignedPhoto[]>([]);
  const [selectedHangoutPhotoId, setSelectedHangoutPhotoId] = useState<string | null>(null);
  const [dishPhotoByEntryId, setDishPhotoByEntryId] = useState<Record<string, SignedPhoto>>({});
  const [photoUploadLoading, setPhotoUploadLoading] = useState<string | null>(null);
  const hangoutCameraInputRef = useRef<HTMLInputElement | null>(null);
  const hangoutUploadInputRef = useRef<HTMLInputElement | null>(null);
  const dishUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [dishUploadTargetId, setDishUploadTargetId] = useState<string | null>(null);
  const didAutoExtractRef = useRef(false);

  const isHost = Boolean(upload && currentUserId && upload.owner_user_id === currentUserId);

  const isActiveParticipant = useMemo(
    () => Boolean(currentUserId && participants.some((row) => row.user_id === currentUserId && row.status === 'active')),
    [currentUserId, participants],
  );

  const canViewVisit = isHost || isActiveParticipant;
  const hasAnyExtractedItems = items.some((item) => item.included);
  const hasAnySavedVisitDishes = visitDishes.length > 0;
  const showExtractionPrompt = Boolean(isHost && receiptSourceId && !hasAnyExtractedItems && !hasAnySavedVisitDishes);

  const reviewRows = useMemo<ReviewRenderRow[]>(() => {
    const buckets = new Map<string, number[]>();

    items.forEach((item, index) => {
      const key = getReviewGroupKey(item, null);
      const existing = buckets.get(key);
      if (existing) {
        existing.push(index);
      } else {
        buckets.set(key, [index]);
      }
    });

    const rows: ReviewRenderRow[] = [];
    buckets.forEach((indexes, key) => {
      const shouldSplit = splitGroupKeys[key];
      if (indexes.length <= 1 || shouldSplit) {
        indexes.forEach((itemIndex) => {
          rows.push({
            key: `${key}-${itemIndex}`,
            baseGroupKey: key,
            itemIndexes: [itemIndex],
            quantity: Math.max(1, items[itemIndex].quantity ?? 1),
            split: shouldSplit,
          });
        });
        return;
      }

      const totalQty = indexes.reduce((sum, itemIndex) => sum + Math.max(1, items[itemIndex].quantity ?? 1), 0);
      rows.push({ key, baseGroupKey: key, itemIndexes: indexes, quantity: totalQty, split: false });
    });

    return rows;
  }, [items, splitGroupKeys]);

  const getAuthHeader = useCallback(async (): Promise<Record<string, string>> => {
    const supabase = getBrowserSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) return {};
    return { Authorization: `Bearer ${session.access_token}` };
  }, []);

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
    const headers = await getAuthHeader();
    const response = await fetch(`/api/photos/list?kind=hangout&hangout_id=${encodeURIComponent(uploadId)}`, { headers });
    if (!response.ok) {
      setHangoutPhotos([]);
      return;
    }

    const payload = (await response.json()) as { photos?: SignedPhoto[] };
    const photos = payload.photos ?? [];
    setHangoutPhotos(photos);
    setSelectedHangoutPhotoId((prev) => prev ?? photos[0]?.id ?? null);
  }, [getAuthHeader, uploadId]);

  const loadDishPhotos = useCallback(
    async (dishEntryIds: string[]) => {
      if (dishEntryIds.length === 0) {
        setDishPhotoByEntryId({});
        return;
      }

      const headers = await getAuthHeader();
      const response = await fetch(`/api/photos/list?kind=dish&dish_entry_ids=${encodeURIComponent(dishEntryIds.join(','))}`, { headers });

      if (!response.ok) {
        setDishPhotoByEntryId({});
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
      setDishPhotoByEntryId(map);
    },
    [getAuthHeader],
  );

  const uploadPhoto = useCallback(
    async (file: File, kind: 'hangout' | 'dish', targetId: string) => {
      setPhotoUploadLoading(`${kind}:${targetId}`);
      try {
        const storageOriginal = await uploadOriginalPhotoDirect({ file, kind });
        const headers = {
          'Content-Type': 'application/json',
          ...(await getAuthHeader()),
        };

        const response = await fetch('/api/photos/upload', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            kind,
            hangout_id: kind === 'hangout' ? targetId : null,
            dish_entry_id: kind === 'dish' ? targetId : null,
            storage_original: storageOriginal,
          }),
        });

        if (!response.ok) {
          return;
        }

        await loadHangoutPhotos();
        await loadDishPhotos(visitDishes.map((dish) => dish.id));
      } finally {
        setPhotoUploadLoading(null);
      }
    },
    [getAuthHeader, loadDishPhotos, loadHangoutPhotos, visitDishes],
  );

  const openHangoutViewer = useCallback(() => {
    const active = selectedHangoutPhotoId ? hangoutPhotos.find((row) => row.id === selectedHangoutPhotoId) ?? null : hangoutPhotos[0] ?? null;
    const target = active?.signedUrls.medium ?? active?.signedUrls.thumb ?? null;
    if (target) {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }, [hangoutPhotos, selectedHangoutPhotoId]);

  const load = useCallback(async () => {
    const supabase = getBrowserSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    setCurrentUserId(user?.id ?? null);

    const { data: uploadData } = await supabase.from('hangouts').select('*').eq('id', uploadId).single();

    const typedUpload = uploadData as Hangout | null;
    setUpload(typedUpload);

    if (!typedUpload || !user) {
      setRestaurant(null);
      setItems([]);
      setVisitDishes([]);
      setPersonalDrafts([]);
      setVisitNote('');
      setParticipants([]);
      return;
    }

    const [itemData, dishData, personalEntryData, restaurantData, sourceData] = await Promise.all([
      supabase.from('hangout_items').select('*').eq('hangout_id', uploadId),
      supabase
        .from('dish_entries')
        .select('id,user_id,dish_name,dish_key,identity_tag,comment,created_at,eaten_at')
        .eq('hangout_id', uploadId)
        .order('eaten_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('dish_entries')
        .select('dish_name,dish_key,identity_tag,comment,had_it,price_original,quantity')
        .eq('hangout_id', uploadId)
        .eq('user_id', user.id),
      supabase.from('hangout_sources').select('id,type').eq('hangout_id', uploadId).order('created_at', { ascending: false }),
      typedUpload.restaurant_id
        ? supabase.from('restaurants').select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync').eq('id', typedUpload.restaurant_id).single()
        : Promise.resolve({ data: null }),
    ]);

    const typedItems = (itemData.data ?? []) as HangoutItem[];
    const typedVisitDishes = (dishData.data ?? []) as VisitDish[];
    const personalEntries = (personalEntryData.data ?? []) as Array<
      Pick<DishEntry, 'dish_name' | 'dish_key' | 'identity_tag' | 'comment' | 'had_it' | 'price_original' | 'quantity'>
    >;
    const receiptSource = ((sourceData.data ?? []) as Array<{ id: string; type: string }>).find((row) => row.type === 'receipt') ?? null;
    setReceiptSourceId(receiptSource?.id ?? null);

    const restaurantName = (restaurantData.data as RestaurantDirectory | null)?.name ?? 'unknown-restaurant';

    const baseDishMap = new Map<string, { dish_name: string; dish_key: string; price: number | null; quantity: number }>();
    typedItems
      .filter((item) => item.included)
      .forEach((item) => {
        const dishName = item.name_final || item.name_raw;
        const dishKey = toDishKey(`${restaurantName} ${dishName}`);
        const quantity = Math.max(1, item.quantity ?? 1);
        const existing = baseDishMap.get(dishKey);

        if (!existing) {
          baseDishMap.set(dishKey, {
            dish_name: dishName,
            dish_key: dishKey,
            price: item.unit_price,
            quantity,
          });
          return;
        }

        existing.quantity += quantity;
      });

    const fallbackFromVisitDishes = typedVisitDishes
      .filter((dish) => dish.user_id === typedUpload.owner_user_id)
      .map((dish) => ({
        dish_name: dish.dish_name,
        dish_key: dish.dish_key,
        price: null as number | null,
        quantity: 1,
      }));

    const mergedBase = baseDishMap.size > 0 ? Array.from(baseDishMap.values()) : fallbackFromVisitDishes;

    const drafts: PersonalDishDraft[] = mergedBase.map((base) => {
      const existing = personalEntries.find((entry) => entry.dish_key === base.dish_key);
      return {
        dish_key: base.dish_key,
        dish_name: base.dish_name,
        price: existing?.price_original ?? base.price,
        quantity: existing?.quantity ?? base.quantity,
        identity_tag: existing?.identity_tag ?? null,
        comment: existing?.comment ?? '',
        had_it: existing?.had_it ?? true,
      };
    });

    setSplitGroupKeys({});
    setItems(
      typedItems.map((item) => ({
        id: item.id,
        upload_id: item.hangout_id,
        name_raw: item.name_raw,
        name_final: item.name_final,
        price_raw: item.unit_price,
        price_final: item.unit_price,
        confidence: item.confidence,
        included: item.included,
        quantity: item.quantity ?? 1,
        unit_price: item.unit_price,
        grouped: false,
        group_key: null,
        duplicate_of: null,
        rating: null,
        comment: null,
        created_at: item.created_at,
        identity_tag: null,
      })),
    );
    setVisitDishes(typedVisitDishes);
    setPersonalDrafts(drafts);
    setRestaurant((restaurantData.data ?? null) as RestaurantDirectory | null);
    setVisitNote(typedUpload.note ?? '');

    await loadParticipants();
  }, [loadParticipants, uploadId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!upload) return;
    void loadHangoutPhotos();
    void loadDishPhotos(visitDishes.map((dish) => dish.id));
  }, [loadDishPhotos, loadHangoutPhotos, upload, visitDishes]);


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
      body: JSON.stringify({ hangoutId: uploadId }),
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
    if (!receiptSourceId) return;
    if (hasAnyExtractedItems || hasAnySavedVisitDishes) return;

    didAutoExtractRef.current = true;
    void runExtraction();
  }, [hasAnyExtractedItems, hasAnySavedVisitDishes, isHost, receiptSourceId, runExtraction, upload]);

  const addRow = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `tmp-${Date.now()}`,
        upload_id: uploadId,
        name_raw: '',
        name_final: '',
        price_raw: null,
        price_final: null,
        confidence: 1,
        included: true,
        quantity: 1,
        unit_price: null,
        group_key: null,
        grouped: false,
        duplicate_of: null,
        rating: null,
        comment: null,
        identity_tag: null,
        created_at: new Date().toISOString(),
      },
    ]);
  };

  const saveNewRows = async () => {
    const supabase = getBrowserSupabaseClient();
    const unsaved = items.filter((item) => item.id.startsWith('tmp-'));

    if (!unsaved.length) return;

    await supabase.from('hangout_items').insert(
      unsaved.map((item) => ({
        hangout_id: uploadId,
        source_id: receiptSourceId,
        name_raw: item.name_final ?? item.name_raw,
        name_final: item.name_final,
        confidence: item.confidence,
        included: item.included,
        quantity: Math.max(1, item.quantity ?? 1),
        unit_price: item.unit_price ?? item.price_final,
        currency: 'USD',
      })),
    );

    await load();
  };

  const approve = async () => {
    if (saving) return;
    setSaving(true);

    try {
      const supabase = getBrowserSupabaseClient();
      const persisted = items.filter((item) => !item.id.startsWith('tmp-'));
      const unsaved = items.filter((item) => item.id.startsWith('tmp-'));

      await supabase
        .from('hangouts')
        .update({
          note: visitNote.trim() ? visitNote.trim() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', uploadId);

      const insertedReviewItems: ReviewItem[] = [];
      for (const item of unsaved) {
        const { data: inserted, error } = await supabase
          .from('hangout_items')
          .insert({
            hangout_id: uploadId,
            source_id: receiptSourceId,
            name_raw: item.name_final ?? item.name_raw,
            name_final: item.name_final,
            confidence: item.confidence,
            included: item.included,
            quantity: Math.max(1, item.quantity ?? 1),
            unit_price: item.unit_price ?? item.price_final,
            currency: 'USD',
          })
          .select('*')
          .single();

        if (error) throw error;
        const row = inserted as HangoutItem;
        insertedReviewItems.push({
          id: row.id,
          upload_id: row.hangout_id,
          name_raw: row.name_raw,
          name_final: row.name_final,
          price_raw: row.unit_price,
          price_final: row.unit_price,
          confidence: row.confidence,
          included: row.included,
          quantity: row.quantity,
          unit_price: row.unit_price,
          group_key: null,
          grouped: false,
          duplicate_of: null,
          rating: null,
          comment: null,
          created_at: row.created_at,
          identity_tag: item.identity_tag,
        });
      }

      await Promise.all(
        persisted.map((item) =>
          supabase
            .from('hangout_items')
            .update({
              name_final: item.name_final,
              quantity: Math.max(1, item.quantity ?? 1),
              unit_price: item.unit_price ?? item.price_final,
              included: item.included,
            })
            .eq('id', item.id),
        ),
      );

      const finalItems = [...persisted, ...insertedReviewItems];

      const approveResponse = await fetch('/api/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hangoutId: uploadId,
          identities: finalItems.map((item) => ({
            lineItemId: item.id,
            identityTag: item.identity_tag,
          })),
        }),
      });

      if (!approveResponse.ok) {
        throw new Error('Could not save approved dishes for this hangout.');
      }

      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const saveExperience = async () => {
    if (!upload || !currentUserId || personalDrafts.length === 0) return;

    setSavingExperience(true);

    try {
      const supabase = getBrowserSupabaseClient();
      const rows = personalDrafts.map((dish) => ({
        user_id: currentUserId,
        restaurant_id: upload.restaurant_id,
        hangout_id: upload.id,
        dish_name: dish.dish_name,
        price_original: dish.price,
        currency_original: 'USD',
        price_usd: dish.price,
        quantity: dish.quantity,
        eaten_at: upload.occurred_at ?? upload.created_at,
        source_upload_id: upload.id,
        dish_key: dish.dish_key,
        identity_tag: dish.identity_tag,
        comment: dish.comment.trim() || null,
        had_it: dish.had_it,
      }));

      await supabase.from('dish_entries').upsert(rows, {
        onConflict: 'user_id,source_upload_id,dish_key',
      });

      await load();
      router.refresh();
    } finally {
      setSavingExperience(false);
    }
  };

  const appendVisitNoteChip = (chip: string) => {
    setVisitNote((prev) => {
      const trimmed = prev.trim();
      if (!trimmed) return chip.slice(0, VISIT_NOTE_MAX);
      const next = `${trimmed}, ${chip}`;
      return next.slice(0, VISIT_NOTE_MAX);
    });
  };

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

  const visitDate = formatDate(upload.occurred_at ?? upload.created_at);
  const isSharedVisit = participants.length > 1;
  const isReviewable = isHost;
  const showHostShareSection = isHost;
  const showStandaloneExperience = !isHost;
  const directionsHref = getGoogleMapsLink(restaurant?.place_id, restaurant?.address, restaurant?.name);
  const todayHours = getTodayHours(restaurant?.opening_hours ?? null);
  const openNow =
    restaurant?.opening_hours && typeof restaurant.opening_hours === 'object' && !Array.isArray(restaurant.opening_hours)
      ? (restaurant.opening_hours as { open_now?: boolean }).open_now
      : undefined;
  const selectedHangoutPhoto =
    hangoutPhotos.find((photo) => photo.id === selectedHangoutPhotoId) ?? hangoutPhotos[0] ?? null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-6">
      <div className="card-surface space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-app-text">Hangout recap</h1>
          <p className="text-xs text-app-muted">With {Math.max(1, participants.length)}</p>
        </div>
        <p className="text-base text-app-text">{restaurant?.name ?? 'Unknown restaurant'}</p>
        <p className="text-sm text-app-muted">{visitDate}</p>
        {visitNote && <p className="text-sm text-app-text">{visitNote}</p>}

        <div className="rounded-xl border border-app-border bg-app-card p-3 space-y-3">
          {restaurant?.address ? (
            <p className="text-sm text-app-muted">📍 {restaurant.address}</p>
          ) : (
            <p className="text-sm text-app-muted">📍 Address not available.</p>
          )}

          <div className="flex flex-wrap gap-2">
            {directionsHref && (
              <a
                href={directionsHref}
                target="_blank"
                rel="noreferrer"
                aria-label="Open directions"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-app-border bg-app-card px-3 text-base"
              >
                🧭
              </a>
            )}
            {restaurant?.phone_number && (
              <a
                href={`tel:${restaurant.phone_number}`}
                aria-label="Call restaurant"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-app-border bg-app-card px-3 text-base"
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
                className="inline-flex h-10 items-center justify-center rounded-xl border border-app-border bg-app-card px-3 text-base"
              >
                🌐
              </a>
            )}
          </div>

          {openNow === true && <p className="text-sm text-emerald-700 dark:text-emerald-300">🟢 Open now</p>}
          {openNow === false && <p className="text-sm text-app-muted">🔴 Closed now</p>}
          {todayHours ? (
            <p className="text-sm text-app-muted">🕒 {todayHours}</p>
          ) : placeSyncLoading ? (
            <p className="text-sm text-app-muted">🕒 Syncing hours...</p>
          ) : (
            <p className="text-sm text-app-muted">🕒 Hours not available yet.</p>
          )}
        </div>
      </div>
      <div className="card-surface space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-label">Hangout photos</h2>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" fullWidth={false} className="h-8 px-2 text-xs" onClick={() => hangoutCameraInputRef.current?.click()}>
              Take photo
            </Button>
            <Button type="button" variant="secondary" size="sm" fullWidth={false} className="h-8 px-2 text-xs" onClick={() => hangoutUploadInputRef.current?.click()}>
              Upload photo
            </Button>
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
            if (file && upload?.id) {
              void uploadPhoto(file, 'hangout', upload.id);
            }
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
            if (file && upload?.id) {
              void uploadPhoto(file, 'hangout', upload.id);
            }
            event.currentTarget.value = '';
          }}
        />

        {selectedHangoutPhoto?.signedUrls.medium ? (
          <>
            <button type="button" className="relative block overflow-hidden rounded-xl border border-app-border" onClick={() => void openHangoutViewer()}>
              <Image src={selectedHangoutPhoto.signedUrls.medium} alt="Hangout photo" width={1280} height={720} className="h-52 w-full object-cover" unoptimized />
            </button>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {hangoutPhotos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  className={`relative shrink-0 overflow-hidden rounded-lg border ${selectedHangoutPhoto.id === photo.id ? 'border-app-primary' : 'border-app-border'}`}
                  onClick={() => setSelectedHangoutPhotoId(photo.id)}
                >
                  {photo.signedUrls.thumb ? (
                    <Image src={photo.signedUrls.thumb} alt="Hangout thumbnail" width={120} height={120} className="h-16 w-16 object-cover" unoptimized />
                  ) : (
                    <div className="h-16 w-16 bg-app-card" />
                  )}
                </button>
              ))}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => hangoutUploadInputRef.current?.click()}
            className="inline-flex h-24 w-full items-center justify-center rounded-xl border border-dashed border-app-border text-sm text-app-muted"
          >
            {photoUploadLoading === `hangout:${upload.id}` ? 'Uploading...' : 'Add a hangout pic (optional)'}
          </button>
        )}
      </div>
      {showHostShareSection && (
        <div className="card-surface space-y-3">
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
          <div className="space-y-2">
            {participants.length === 0 ? (
              <p className="text-xs text-app-muted">No crew yet. Add your buddies.</p>
            ) : (
              participants.map((participant) => (
                <div key={participant.id} className="flex items-center justify-between gap-3 rounded-xl border border-app-border bg-app-card px-3 py-2">
                  <div>
                    <p className="text-sm text-app-text">{participant.display_name ?? 'Crew member'}</p>
                    <p className="text-xs text-app-muted">In your crew</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    className="h-8 px-2 text-xs"
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

      {showExtractionPrompt && (
        <div className="card-surface space-y-3">
          <h2 className="section-label">Extraction</h2>
          <p className="text-sm text-app-muted">{isSharedVisit ? 'Run extraction to generate dishes for your crew.' : 'Run extraction to generate dishes for your hangout.'}</p>
          <Button type="button" variant="secondary" onClick={runExtraction}>
            Run extraction
          </Button>
        </div>
      )}

      {isReviewable && (
        <div className="card-surface space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-app-text">Review dishes</h2>

          <Button type="button" variant="secondary" onClick={runExtraction}>
            Run extraction
          </Button>

          <div className="rounded-2xl border border-app-border p-4 space-y-3">
            <div className="space-y-2">
              <label className="section-label">Vibe (optional)</label>
              <Input
                value={visitNote}
                maxLength={VISIT_NOTE_MAX}
                onChange={(e) => setVisitNote(e.target.value.slice(0, VISIT_NOTE_MAX))}
                placeholder="e.g., great vibe, too spicy, slow service"
              />
              <p className="text-xs text-app-muted">{visitNote.length}/{VISIT_NOTE_MAX}</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_NOTE_CHIPS.map((chip) => (
                  <Button
                    key={chip}
                    type="button"
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => appendVisitNoteChip(chip)}
                  >
                    {chip}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <h3 className="section-label">{isSharedVisit ? 'Dishes (review + your experience)' : 'Extracted dishes (organizer review)'}</h3>
          {isSharedVisit && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() =>
                  setPersonalDrafts((prev) =>
                    prev.map((dish) => ({
                      ...dish,
                      had_it: true,
                    })),
                  )
                }
              >
                Mark all as had it
              </Button>
            </div>
          )}
          {items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-app-border p-4 text-sm text-app-muted">
              No extracted dishes yet. You can still save the vibe and come back to scan a receipt later.
            </p>
          ) : (
            <div className="space-y-3">
              {reviewRows.map((row) => {
                const firstIndex = row.itemIndexes[0];
                const firstItem = items[firstIndex];
                const dishName = firstItem.name_final || firstItem.name_raw;
                const draftDishKey = toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
                const draftIndex = personalDrafts.findIndex((entry) => entry.dish_key === draftDishKey);
                const personalDraft = draftIndex >= 0 ? personalDrafts[draftIndex] : null;
                const noteOpen = openItemNotes[row.key] || Boolean(firstItem.comment);
                const included = row.itemIndexes.every((itemIndex) => items[itemIndex].included);
                const identityValue = row.itemIndexes.map((itemIndex) => items[itemIndex].identity_tag).find((value) => value != null) ?? null;
                const hasDuplicates = row.itemIndexes.length > 1 || (reviewRows.some((entry) => entry.baseGroupKey === row.baseGroupKey) && row.split);

                return (
                  <div key={row.key} className="rounded-2xl border border-app-border p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-app-muted">{row.quantity > 1 ? `Auto-grouped x${row.quantity}` : 'Single line item'}</p>
                      {hasDuplicates && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          fullWidth={false}
                          className="h-7 px-2 text-xs"
                          onClick={() =>
                            setSplitGroupKeys((prev) => ({
                              ...prev,
                              [row.baseGroupKey]: !prev[row.baseGroupKey],
                            }))
                          }
                        >
                          {splitGroupKeys[row.baseGroupKey] ? 'Undo split' : 'Split'}
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[1fr,120px,84px]">
                      <Input
                        value={firstItem.name_final ?? ''}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((entry, itemIndex) =>
                              row.itemIndexes.includes(itemIndex) ? { ...entry, name_final: e.target.value, group_key: row.baseGroupKey } : entry,
                            ),
                          )
                        }
                        placeholder="Dish name"
                      />
                      <Input
                        type="number"
                        value={firstItem.price_final ?? ''}
                        onChange={(e) => {
                          const value = Number.parseFloat(e.target.value) || null;
                          setItems((prev) =>
                            prev.map((entry, itemIndex) =>
                              row.itemIndexes.includes(itemIndex)
                                ? { ...entry, price_final: value, unit_price: value, group_key: row.baseGroupKey }
                                : entry,
                            ),
                          );
                        }}
                        placeholder="Price"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((entry, itemIndex) =>
                              row.itemIndexes.includes(itemIndex) ? { ...entry, included: !included } : entry,
                            ),
                          )
                        }
                        className={`inline-flex h-11 items-center justify-center rounded-xl border px-3 text-sm font-medium transition-colors duration-200 ${
                          included
                            ? 'border-app-primary bg-app-primary text-app-primary-text'
                            : 'border-app-border bg-app-card text-app-muted'
                        }`}
                        aria-pressed={included}
                      >
                        {included ? 'Included' : 'Excluded'}
                      </button>
                    </div>

                    <IdentitySelector
                      value={identityValue}
                      onChange={(value) => {
                        setItems((prev) =>
                          prev.map((entry, itemIndex) =>
                            row.itemIndexes.includes(itemIndex) ? { ...entry, identity_tag: value } : entry,
                          ),
                        );

                        if (isSharedVisit && draftIndex >= 0) {
                          setPersonalDrafts((prev) =>
                            prev.map((entry, i) =>
                              i === draftIndex
                                ? {
                                    ...entry,
                                    identity_tag: value,
                                  }
                                : entry,
                            ),
                          );
                        }
                      }}
                    />

                    <div className="space-y-2">
                      {isSharedVisit ? (
                        <>
                          <div className="flex items-center justify-between rounded-xl border border-app-border px-3 py-2">
                            <p className="text-sm text-app-text">I had this dish</p>
                            <button
                              type="button"
                              onClick={() => {
                                if (draftIndex < 0) return;
                                setPersonalDrafts((prev) =>
                                  prev.map((entry, i) =>
                                    i === draftIndex
                                      ? {
                                          ...entry,
                                          had_it: !entry.had_it,
                                        }
                                      : entry,
                                  ),
                                );
                              }}
                              className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-200 ${
                                personalDraft?.had_it
                                  ? 'border-app-primary bg-app-primary text-app-primary-text'
                                  : 'border-app-border bg-app-card text-app-muted'
                              }`}
                            >
                              {personalDraft?.had_it ? 'Had it' : "Didn't have it"}
                            </button>
                          </div>
                          <Input
                            value={firstItem.comment ?? ''}
                            maxLength={140}
                            onChange={(e) => {
                              const value = e.target.value;
                              setItems((prev) =>
                                prev.map((entry, itemIndex) =>
                                  row.itemIndexes.includes(itemIndex) ? { ...entry, comment: value } : entry,
                                ),
                              );

                              if (draftIndex >= 0) {
                                setPersonalDrafts((prev) =>
                                  prev.map((entry, i) =>
                                    i === draftIndex
                                      ? {
                                          ...entry,
                                          comment: value,
                                        }
                                      : entry,
                                  ),
                                );
                              }
                            }}
                            placeholder="Optional dish note"
                          />
                        </>
                      ) : (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            fullWidth={false}
                            className="h-8 px-1 text-xs underline underline-offset-2"
                            onClick={() =>
                              setOpenItemNotes((prev) => ({
                                ...prev,
                                [row.key]: !noteOpen,
                              }))
                            }
                          >
                            {noteOpen ? 'Hide dish note' : 'Add note'}
                          </Button>

                          {noteOpen && (
                            <Input
                              value={firstItem.comment ?? ''}
                              maxLength={140}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((entry, itemIndex) =>
                                    row.itemIndexes.includes(itemIndex) ? { ...entry, comment: e.target.value } : entry,
                                  ),
                                )
                              }
                              placeholder="Optional dish note"
                            />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <Button type="button" variant="secondary" onClick={addRow}>
              Add row
            </Button>
              <Button type="button" variant="secondary" onClick={saveNewRows}>
                Save added rows
              </Button>
              <Button type="button" onClick={approve} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
      )}

      {showStandaloneExperience && (
      <div className="card-surface space-y-3">
        <h2 className="section-label">Your experience</h2>
        {personalDrafts.length === 0 ? (
          <p className="empty-surface">No dishes available for personal annotation yet. Run extraction first.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onClick={() =>
                  setPersonalDrafts((prev) =>
                    prev.map((dish) => ({
                      ...dish,
                      had_it: true,
                    })),
                  )
                }
              >
                Mark all as had it
              </Button>
            </div>

            <div className="space-y-3">
              {personalDrafts.map((dish, index) => (
                <div key={dish.dish_key} className="rounded-2xl border border-app-border bg-app-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-app-text">{dish.dish_name}</p>
                      <p className="text-xs text-app-muted">{formatPrice(dish.price)}</p>
                    </div>
                    {dish.identity_tag && <IdentityTagPill tag={dish.identity_tag} />}
                  </div>

                  <IdentitySelector
                    value={dish.identity_tag}
                    onChange={(value) =>
                      setPersonalDrafts((prev) =>
                        prev.map((entry, i) =>
                          i === index
                            ? {
                                ...entry,
                                identity_tag: value,
                              }
                            : entry,
                        ),
                      )
                    }
                  />

                  <div className="flex items-center justify-between rounded-xl border border-app-border px-3 py-2">
                    <p className="text-sm text-app-text">I had this dish</p>
                    <button
                      type="button"
                      onClick={() =>
                        setPersonalDrafts((prev) =>
                          prev.map((entry, i) =>
                            i === index
                              ? {
                                  ...entry,
                                  had_it: !entry.had_it,
                                }
                              : entry,
                          ),
                        )
                      }
                      className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors duration-200 ${
                        dish.had_it
                          ? 'border-app-primary bg-app-primary text-app-primary-text'
                          : 'border-app-border bg-app-card text-app-muted'
                      }`}
                    >
                      {dish.had_it ? 'Had it' : "Didn't have it"}
                    </button>
                  </div>

                  <Input
                    value={dish.comment}
                    onChange={(event) =>
                      setPersonalDrafts((prev) =>
                        prev.map((entry, i) =>
                          i === index
                            ? {
                                ...entry,
                                comment: event.target.value,
                              }
                            : entry,
                        ),
                      )
                    }
                    placeholder="Optional personal note"
                    maxLength={140}
                  />
                </div>
              ))}
            </div>

            <div className="sticky bottom-4">
              <Button type="button" onClick={saveExperience} disabled={savingExperience}>
                {savingExperience ? 'Saving...' : 'Save your experience'}
              </Button>
            </div>
          </>
        )}
      </div>
      )}

      {visitDishes.length > 0 && (
        <div className="card-surface space-y-3">
          <h2 className="section-label">Hangout dishes (saved)</h2>

          <input
            ref={dishUploadInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && dishUploadTargetId) {
                void uploadPhoto(file, 'dish', dishUploadTargetId);
              }
              event.currentTarget.value = '';
              setDishUploadTargetId(null);
            }}
          />

          {visitDishes.map((dish) => {
            const dishPhoto = dishPhotoByEntryId[dish.id];
            return (
              <Link key={dish.id} href={`/dishes/${dish.dish_key}`} className="rounded-2xl border border-app-border bg-app-card p-4 block">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {dishPhoto?.signedUrls.thumb ? (
                      <Image
                        src={dishPhoto.signedUrls.thumb}
                        alt={`${dish.dish_name} photo`}
                        width={64}
                        height={64}
                        className="h-14 w-14 rounded-lg object-cover"
                        unoptimized
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.preventDefault();
                          setDishUploadTargetId(dish.id);
                          dishUploadInputRef.current?.click();
                        }}
                        className="inline-flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-app-border text-[11px] text-app-muted"
                      >
                        {photoUploadLoading === `dish:${dish.id}` ? '...' : 'Add pic'}
                      </button>
                    )}
                    <div>
                      <p className="font-medium text-app-text">{dish.dish_name}</p>
                      <p className="text-xs text-app-muted">{formatDate(dish.eaten_at ?? dish.created_at)}</p>
                    </div>
                  </div>
                  <IdentityTagPill tag={dish.identity_tag} />
                </div>
                {dish.comment && <p className="text-xs text-app-muted">{dish.comment}</p>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
































