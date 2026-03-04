'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Clock3, Globe, MapPin, Navigation, Phone, X } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { DishActionBar } from '@/components/DishActionBar';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishCatalog, DishEntry, DishIdentityTag, HangoutItem, HangoutSummary, ReceiptUpload, Restaurant, VisitParticipant } from '@/lib/supabase/types';
import { toDishKey } from '@/lib/utils';
import { normalizeName } from '@/lib/extraction/normalize';
import { getGoogleMapsLink } from '@/lib/google/mapsLinks';
import { SignedPhoto } from '@/lib/photos/types';
import { listDishPhotosForHangout, listHangoutPhotos, uploadDishPhoto, uploadHangoutPhoto } from '@/lib/data/photosRepo';
import { uploadImage } from '@/lib/storage/uploadImage';

const VISIT_NOTE_MAX = 140;

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
type PlaceSuggestion = {
  placeId: string;
  primaryText: string;
  secondaryText: string;
};
type PlaceDetails = {
  placeId: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  googleMapsUrl?: string | null;
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

function inferCaptureMode(upload: ReceiptUpload | null): 'receipt' | 'food_photo' {
  if (!upload) return 'receipt';
  const firstPath = upload.image_paths?.find((value) => typeof value === 'string' && value.length > 0) ?? '';
  return firstPath.includes('/dish/') ? 'food_photo' : 'receipt';
}

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

function getRestaurantLocalParts(utcOffsetMinutes: number | null): { dayIndex: number; minutes: number } {
  if (utcOffsetMinutes == null) {
    const now = new Date();
    return { dayIndex: (now.getDay() + 6) % 7, minutes: now.getHours() * 60 + now.getMinutes() };
  }

  const shifted = new Date(Date.now() + utcOffsetMinutes * 60 * 1000);
  return {
    dayIndex: (shifted.getUTCDay() + 6) % 7,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function parseTimeToMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3].toUpperCase();
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  const base = hour % 12;
  return (meridiem === 'PM' ? base + 12 : base) * 60 + minute;
}

function parseOpenNowFromTodayLine(todayLine: string, currentMinutes: number): boolean | null {
  const parts = todayLine.split(':');
  if (parts.length < 2) return null;
  const schedule = parts.slice(1).join(':').trim();
  const normalized = schedule.toLowerCase();

  if (normalized.includes('closed')) return false;
  if (normalized.includes('open 24 hours')) return true;

  const windows = schedule.split(',').map((segment) => segment.trim()).filter(Boolean);
  if (!windows.length) return null;

  for (const window of windows) {
    const span = window.split(/[–-]/).map((part) => part.trim());
    if (span.length !== 2) continue;
    const start = parseTimeToMinutes(span[0]);
    const end = parseTimeToMinutes(span[1]);
    if (start == null || end == null) continue;

    if (end > start) {
      if (currentMinutes >= start && currentMinutes < end) return true;
    } else {
      if (currentMinutes >= start || currentMinutes < end) return true;
    }
  }

  return false;
}

function getTodayHours(openingHours: Restaurant['opening_hours'], utcOffsetMinutes: number | null): string | null {
  if (!openingHours || typeof openingHours !== 'object' || Array.isArray(openingHours)) return null;
  const weekdayText = (openingHours as { weekday_text?: unknown }).weekday_text;
  if (!Array.isArray(weekdayText) || weekdayText.length === 0) return null;
  const { dayIndex } = getRestaurantLocalParts(utcOffsetMinutes);
  const line = weekdayText[dayIndex];
  return typeof line === 'string' ? line : null;
}

function getOpenNowStatus(openingHours: Restaurant['opening_hours'], utcOffsetMinutes: number | null): boolean | null {
  const todayLine = getTodayHours(openingHours, utcOffsetMinutes);
  if (!todayLine) return null;
  const { minutes } = getRestaurantLocalParts(utcOffsetMinutes);
  return parseOpenNowFromTodayLine(todayLine, minutes);
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

function truncateText(value: string, max = 140): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function normalizeDish(value: string): string {
  return normalizeName(value) || value.trim().toLowerCase();
}

export default function UploadDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const uploadId = params.id;

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [upload, setUpload] = useState<ReceiptUpload | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantDirectory | null>(null);

  const [dishes, setFood] = useState<UnifiedDishRow[]>([]);
  const [catalogByDishKey, setCatalogByDishKey] = useState<Record<string, DishCatalog>>({});

  const [visitNote, setVisitNote] = useState('');
  const [hangoutSummary, setHangoutSummary] = useState<HangoutSummary | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
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
  const [editingDishRow, setEditingDishRow] = useState<{
    hangoutItemId: string;
    dishKey: string;
    fallbackName: string;
  } | null>(null);
  const [editNameCanonical, setEditNameCanonical] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editFlavorTags, setEditFlavorTags] = useState('');
  const [savingDishCatalog, setSavingDishCatalog] = useState(false);
  const hangoutCameraInputRef = useRef<HTMLInputElement | null>(null);
  const hangoutUploadInputRef = useRef<HTMLInputElement | null>(null);
  const dishCameraInputRef = useRef<HTMLInputElement | null>(null);
  const dishUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [dishUploadTarget, setDishUploadTarget] = useState<{ hangoutItemId: string } | null>(null);
  const [manualDishName, setManualDishName] = useState('');
  const [manualDishPrice, setManualDishPrice] = useState('');
  const [manualDishSaving, setManualDishSaving] = useState(false);
  const [manualDishError, setManualDishError] = useState<string | null>(null);
  const [uploadingHangoutPhoto, setUploadingHangoutPhoto] = useState(false);
  const [uploadingDishPhotoFor, setUploadingDishPhotoFor] = useState<string | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [hasTriedExtraction, setHasTriedExtraction] = useState(false);
  const [manualEntryForReceipt, setManualEntryForReceipt] = useState(false);
  const [saveHangoutLoading, setSaveHangoutLoading] = useState(false);
  const [saveHangoutError, setSaveHangoutError] = useState<string | null>(null);
  const [saveHangoutToast, setSaveHangoutToast] = useState<string | null>(null);
  const [restaurantQuery, setRestaurantQuery] = useState('');
  const [restaurantSuggestions, setRestaurantSuggestions] = useState<PlaceSuggestion[]>([]);
  const [restaurantLookupLoading, setRestaurantLookupLoading] = useState(false);
  const [restaurantLookupError, setRestaurantLookupError] = useState<string | null>(null);
  const [restaurantFocused, setRestaurantFocused] = useState(false);
  const [manualRestaurantMode, setManualRestaurantMode] = useState(false);
  const [manualRestaurantName, setManualRestaurantName] = useState('');
  const [cancelingDraft, setCancelingDraft] = useState(false);
  const receiptReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const didAutoExtractRef = useRef(false);

  const isHost = Boolean(upload && currentUserId && upload.user_id === currentUserId);

  const isActiveParticipant = useMemo(
    () => Boolean(currentUserId && participants.some((row) => row.user_id === currentUserId && row.status === 'active')),
    [currentUserId, participants],
  );

  const canViewVisit = isHost || isActiveParticipant;
  const hasAnyExtractedItems = dishes.length > 0;
  const captureMode = useMemo(() => inferCaptureMode(upload), [upload]);
  const isReceiptCapture = captureMode === 'receipt';
  const showExtractionPrompt = Boolean(isHost && upload && !hasAnyExtractedItems && isReceiptCapture);

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

  const loadHangoutSummary = useCallback(async () => {
    if (!isReceiptCapture) {
      setHangoutSummary(null);
      return;
    }

    const headers = await getAuthHeader();
    if (!headers.Authorization) return;

    const response = await fetch(`/api/hangouts/summary?hangoutId=${encodeURIComponent(uploadId)}`, { headers });
    if (!response.ok) {
      setHangoutSummary(null);
      return;
    }

    const payload = (await response.json()) as { summary?: HangoutSummary };
    setHangoutSummary(payload.summary ?? null);
  }, [getAuthHeader, isReceiptCapture, uploadId]);

  useEffect(() => {
    if (!restaurant) {
      setRestaurantQuery('');
      return;
    }
    setRestaurantQuery(restaurant.name ?? '');
  }, [restaurant]);

  useEffect(() => {
    if (restaurantQuery.trim().length < 2) {
      setRestaurantSuggestions([]);
      setRestaurantLookupError(null);
      setRestaurantLookupLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        setRestaurantLookupLoading(true);
        setRestaurantLookupError(null);
        const response = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(restaurantQuery.trim())}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { results?: PlaceSuggestion[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'Failed to search restaurants');
        setRestaurantSuggestions(payload.results ?? []);
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setRestaurantLookupError(error instanceof Error ? error.message : 'Failed to search restaurants');
        setRestaurantSuggestions([]);
      } finally {
        setRestaurantLookupLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [restaurantQuery]);


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
      setFood([]);
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

    setFood(unifiedRows);
    setCatalogByDishKey(nextCatalogByDishKey);
    setEntryMetaById(entryMap);
    setRestaurant((restaurantData.data ?? null) as RestaurantDirectory | null);
    setVisitNote(typedUpload.visit_note ?? '');

    await loadParticipants();
    if (inferCaptureMode(typedUpload) === 'receipt') {
      await loadHangoutSummary();
    } else {
      setHangoutSummary(null);
    }
  }, [loadHangoutSummary, loadParticipants, uploadId]);

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
    setIsExtracting(true);
    setHasTriedExtraction(true);
    try {
      await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId }),
      });
      await load();
    } finally {
      setIsExtracting(false);
    }
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
    if (!isReceiptCapture) return;
    if (!upload.image_paths || upload.image_paths.length === 0) return;
    if (hasAnyExtractedItems) return;

    didAutoExtractRef.current = true;
    void runExtraction();
  }, [hasAnyExtractedItems, isHost, isReceiptCapture, runExtraction, upload]);

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
          setFood((prev) =>
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
      setFood((prev) =>
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
      setUploadingHangoutPhoto(true);
      try {
        const created = await uploadHangoutPhoto(upload.id, file);
        if (created) {
          await loadHangoutPhotos();
        }
      } finally {
        setUploadingHangoutPhoto(false);
      }
    },
    [loadHangoutPhotos, upload?.id],
  );

  const handleUploadDishPhoto = useCallback(
    async (row: UnifiedDishRow, file: File) => {
      if (!upload?.id) return;
      setUploadingDishPhotoFor(row.hangoutItem.id);
      try {
        const ensured = await ensureDishEntryForRow(row);
        if (!ensured?.id) return;
        const created = await uploadDishPhoto(upload.id, ensured.id, file);
        if (created) {
          await load();
        }
      } finally {
        setUploadingDishPhotoFor(null);
      }
    },
    [ensureDishEntryForRow, load, upload?.id],
  );

  const addManualDishItem = useCallback(async () => {
    const name = manualDishName.trim();
    if (!name || !upload?.id || !isHost || !currentUserId) return;

    setManualDishSaving(true);
    setManualDishError(null);
    try {
      const parsedPrice = Number(manualDishPrice.trim());
      const unitPrice = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null;
      const supabase = getBrowserSupabaseClient();
      const { data: hangoutExisting, error: hangoutExistingError } = await supabase
        .from('hangouts')
        .select('id')
        .eq('id', upload.id)
        .maybeSingle();
      if (hangoutExistingError) throw hangoutExistingError;
      if (!hangoutExisting) {
        const { error: hangoutInsertError } = await supabase.from('hangouts').insert({
          id: upload.id,
          owner_user_id: upload.user_id,
          restaurant_id: upload.restaurant_id,
          occurred_at: upload.visited_at ?? upload.created_at,
          note: upload.visit_note ?? null,
        });
        if (hangoutInsertError) throw hangoutInsertError;
      }

      const { data: participantExisting, error: participantExistingError } = await supabase
        .from('hangout_participants')
        .select('hangout_id')
        .eq('hangout_id', upload.id)
        .eq('user_id', upload.user_id)
        .maybeSingle();
      if (participantExistingError) throw participantExistingError;
      if (!participantExisting) {
        const { error: participantError } = await supabase.from('hangout_participants').insert({
          hangout_id: upload.id,
          user_id: upload.user_id,
        });
        if (participantError) throw participantError;
      }

      const { data: insertedItem, error } = await supabase
        .from('hangout_items')
        .insert({
          hangout_id: upload.id,
          source_id: null,
          name_raw: name,
          name_final: name,
          quantity: 1,
          unit_price: unitPrice,
          currency: upload.currency_detected || 'USD',
          included: true,
          confidence: null,
        })
        .select('id,quantity,unit_price')
        .single();

      if (error) throw error;

      const dishKey = toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${name}`);
      await supabase.from('dish_entries').upsert(
        {
          user_id: currentUserId,
          restaurant_id: upload.restaurant_id,
          hangout_id: upload.id,
          hangout_item_id: insertedItem.id,
          dish_name: name,
          price_original: insertedItem.unit_price,
          currency_original: upload.currency_detected || 'USD',
          price_usd: insertedItem.unit_price,
          quantity: insertedItem.quantity,
          eaten_at: upload.visited_at ?? upload.created_at,
          source_upload_id: upload.id,
          dish_key: dishKey,
          identity_tag: null,
          comment: null,
        },
        { onConflict: 'user_id,hangout_item_id' },
      );
      setManualDishName('');
      setManualDishPrice('');
      await load();
    } catch (error) {
      setManualDishError(error instanceof Error ? error.message : 'Could not add dish');
    } finally {
      setManualDishSaving(false);
    }
  }, [currentUserId, isHost, load, manualDishName, manualDishPrice, restaurant?.name, upload]);

  const openDishCatalogEditor = useCallback(
    (row: UnifiedDishRow) => {
      const dishName = row.hangoutItem.name_final || row.hangoutItem.name_raw;
      const dishKey = row.myEntry?.dish_key ?? toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
      const catalog = catalogByDishKey[dishKey] ?? null;
      setEditingDishRow({
        hangoutItemId: row.hangoutItem.id,
        dishKey,
        fallbackName: dishName,
      });
      setEditNameCanonical(catalog?.name_canonical ?? dishName);
      setEditDescription(catalog?.description ?? '');
      setEditFlavorTags((catalog?.flavor_tags ?? []).join(', '));
    },
    [catalogByDishKey, restaurant?.name],
  );

  const saveDishCatalogEdits = useCallback(async () => {
    if (!editingDishRow) return;

    const headers = await getAuthHeader();
    if (!headers.Authorization) return;

    const flavorTags = editFlavorTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);

    setSavingDishCatalog(true);
    try {
      const response = await fetch('/api/dish-catalog/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          hangoutId: uploadId,
          hangoutItemId: editingDishRow.hangoutItemId,
          nameCanonical: editNameCanonical,
          description: editDescription,
          flavorTags,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { ok?: boolean; catalog?: DishCatalog } | null;
      const catalog = payload?.catalog;
      if (response.ok && payload?.ok && catalog) {
        setCatalogByDishKey((prev) => ({
          ...prev,
          [catalog.dish_key]: catalog,
        }));
        setEditingDishRow(null);
      }
    } finally {
      setSavingDishCatalog(false);
    }
  }, [editDescription, editFlavorTags, editNameCanonical, editingDishRow, getAuthHeader, uploadId]);

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

  const onSelectRestaurantSuggestion = useCallback(
    async (suggestion: PlaceSuggestion) => {
      if (!upload || !currentUserId) return;
      try {
        setRestaurantLookupError(null);
        const detailsResponse = await fetch(`/api/places/details?placeId=${encodeURIComponent(suggestion.placeId)}`);
        const detailsPayload = (await detailsResponse.json()) as PlaceDetails & { error?: string };
        if (!detailsResponse.ok) throw new Error(detailsPayload.error ?? 'Could not fetch place details');

        const supabase = getBrowserSupabaseClient();
        const { data: upsertedRestaurant, error: upsertError } = await supabase
          .from('restaurants')
          .upsert(
            {
              user_id: currentUserId,
              place_id: detailsPayload.placeId,
              name: detailsPayload.name,
              address: detailsPayload.address,
              lat: detailsPayload.lat,
              lng: detailsPayload.lng,
            },
            { onConflict: 'user_id,place_id' },
          )
          .select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
          .single();
        if (upsertError) throw upsertError;

        const { error: uploadUpdateError } = await supabase.from('receipt_uploads').update({ restaurant_id: upsertedRestaurant.id }).eq('id', upload.id);
        if (uploadUpdateError) throw uploadUpdateError;
        await supabase.from('hangouts').update({ restaurant_id: upsertedRestaurant.id }).eq('id', upload.id);

        setRestaurant((upsertedRestaurant ?? null) as RestaurantDirectory | null);
        setRestaurantQuery(upsertedRestaurant.name);
        setRestaurantSuggestions([]);
        setRestaurantFocused(false);
      } catch (error) {
        setRestaurantLookupError(error instanceof Error ? error.message : 'Could not update restaurant');
      }
    },
    [currentUserId, upload],
  );

  const saveManualRestaurant = useCallback(async () => {
    if (!upload || !currentUserId) return;
    const name = manualRestaurantName.trim();
    if (!name) return;
    try {
      setRestaurantLookupError(null);
      const supabase = getBrowserSupabaseClient();
      const { data: createdRestaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .insert({
          user_id: currentUserId,
          name,
        })
        .select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
        .single();
      if (restaurantError) throw restaurantError;

      const { error: uploadUpdateError } = await supabase.from('receipt_uploads').update({ restaurant_id: createdRestaurant.id }).eq('id', upload.id);
      if (uploadUpdateError) throw uploadUpdateError;
      await supabase.from('hangouts').update({ restaurant_id: createdRestaurant.id }).eq('id', upload.id);
      setRestaurant((createdRestaurant ?? null) as RestaurantDirectory | null);
      setRestaurantQuery(createdRestaurant.name);
      setManualRestaurantName('');
      setManualRestaurantMode(false);
    } catch (error) {
      setRestaurantLookupError(error instanceof Error ? error.message : 'Could not update restaurant');
    }
  }, [currentUserId, manualRestaurantName, upload]);

  const promoteTempReceiptImages = useCallback(async (): Promise<string[] | null> => {
    if (!upload?.image_paths?.length || !currentUserId) return null;
    const tempPaths = upload.image_paths.filter((path) => path.includes('/temp_receipt/'));
    if (tempPaths.length === 0) return null;

    const supabase = getBrowserSupabaseClient();
    const nextPaths: string[] = [];

    for (const path of upload.image_paths) {
      if (!path.includes('/temp_receipt/')) {
        nextPaths.push(path);
        continue;
      }
      const destination = path.replace('/temp_receipt/', '/receipt/');
      const { error: copyError } = await supabase.storage.from('uploads').copy(path, destination);
      if (copyError) throw copyError;
      nextPaths.push(destination);
    }

    const { error: removeError } = await supabase.storage.from('uploads').remove(tempPaths);
    if (removeError) throw removeError;
    return nextPaths;
  }, [currentUserId, upload?.image_paths]);

  const cancelHangoutDraft = useCallback(async () => {
    if (!upload || !isHost) return;
    setCancelingDraft(true);
    setSaveHangoutError(null);
    try {
      const supabase = getBrowserSupabaseClient();
      const tempOrUploaded = (upload.image_paths ?? []).filter(Boolean);
      if (tempOrUploaded.length > 0) {
        await supabase.storage.from('uploads').remove(tempOrUploaded);
      }
      await supabase
        .from('receipt_uploads')
        .update({
          status: 'rejected',
          image_paths: [],
          visit_note: null,
        })
        .eq('id', upload.id);
      router.push('/add');
    } finally {
      setCancelingDraft(false);
    }
  }, [isHost, router, upload]);

  const replaceReceiptAndRescan = useCallback(
    async (file: File) => {
      if (!upload || !currentUserId) return;
      setIsExtracting(true);
      setHasTriedExtraction(true);
      try {
        const imagePath = await uploadImage({
          file,
          userId: currentUserId,
          uploadId: upload.id,
          category: 'temp_receipt',
        });
        const supabase = getBrowserSupabaseClient();
        const { error: updateError } = await supabase
          .from('receipt_uploads')
          .update({ image_paths: [imagePath], status: 'uploaded' })
          .eq('id', upload.id);
        if (updateError) throw updateError;
        await runExtraction();
      } catch (error) {
        setSaveHangoutError(error instanceof Error ? error.message : 'Could not upload new receipt');
      } finally {
        setIsExtracting(false);
      }
    },
    [currentUserId, runExtraction, upload],
  );

  const saveHangout = useCallback(async () => {
    if (!upload || !currentUserId) return;
    setSaveHangoutError(null);
    const activeFood = dishes.filter((row) => row.hangoutItem.included);
    if (activeFood.length === 0) {
      setSaveHangoutError('Add at least one food item before saving.');
      return;
    }

    setSaveHangoutLoading(true);
    try {
      const promotedImagePaths = await promoteTempReceiptImages();
      for (const row of activeFood) {
        await upsertMyDishEntry(row, {});
      }
      const supabase = getBrowserSupabaseClient();
      await supabase
        .from('receipt_uploads')
        .update({
          visit_note: visitNote?.trim() ? visitNote.trim() : null,
          status: 'approved',
          ...(promotedImagePaths ? { image_paths: promotedImagePaths } : {}),
        })
        .eq('id', upload.id);

      await supabase
        .from('hangouts')
        .update({
          note: visitNote?.trim() ? visitNote.trim() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', upload.id)
        .eq('owner_user_id', currentUserId);

      setSaveHangoutToast('Hangout saved');
      window.setTimeout(() => setSaveHangoutToast(null), 1800);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      router.push(`/hangouts/${upload.id}`);
    } finally {
      setSaveHangoutLoading(false);
    }
  }, [currentUserId, dishes, promoteTempReceiptImages, router, upload, upsertMyDishEntry, visitNote]);

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
  const visibleFood = dishes.filter((row) => row.hangoutItem.included);
  const hiddenFood = dishes.filter((row) => !row.hangoutItem.included);
  const withNames = participants
    .filter((participant) => participant.status === 'active')
    .map((participant) => participant.display_name ?? 'Buddy');
  const withLabel = withNames.length > 0 ? withNames.join(', ') : 'Solo';
  const directionsHref = getGoogleMapsLink(restaurant?.place_id, restaurant?.address, restaurant?.name);
  const todayHours = getTodayHours(restaurant?.opening_hours ?? null, restaurant?.utc_offset_minutes ?? null);
  const openNow = getOpenNowStatus(restaurant?.opening_hours ?? null, restaurant?.utc_offset_minutes ?? null);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 pb-4">
      <div className="card-surface p-3 space-y-2">
        <h1 className="text-2xl font-semibold leading-7 text-app-text">{restaurant?.name ?? 'Restaurant not detected'}</h1>
        <p className="text-xs leading-4 text-app-muted">
          {visitDate} · With {withLabel}
        </p>
        {isHost ? (
          <div className="relative space-y-1">
            {!restaurant ? (
              <div className="flex flex-wrap gap-2 pb-1">
                <Button type="button" variant={!manualRestaurantMode ? 'secondary' : 'ghost'} size="sm" fullWidth={false} onClick={() => setManualRestaurantMode(false)}>
                  Search restaurant
                </Button>
                <Button type="button" variant={manualRestaurantMode ? 'secondary' : 'ghost'} size="sm" fullWidth={false} onClick={() => setManualRestaurantMode(true)}>
                  Add restaurant manually
                </Button>
              </div>
            ) : null}
            {!manualRestaurantMode ? (
              <>
                <Input
                  value={restaurantQuery}
                  onChange={(event) => setRestaurantQuery(event.target.value)}
                  onFocus={() => setRestaurantFocused(true)}
                  onBlur={() => window.setTimeout(() => setRestaurantFocused(false), 120)}
                  placeholder="Search restaurant"
                />
                {restaurantFocused && restaurantQuery.trim().length >= 2 ? (
                  <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-app-border bg-app-card shadow-sm">
                    {restaurantLookupLoading ? <p className="p-3 text-sm text-app-muted">Searching...</p> : null}
                    {!restaurantLookupLoading && restaurantSuggestions.length === 0 ? (
                      <p className="p-3 text-sm text-app-muted">No matching places found.</p>
                    ) : null}
                    {!restaurantLookupLoading &&
                      restaurantSuggestions.map((suggestion) => (
                        <button
                          key={suggestion.placeId}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => void onSelectRestaurantSuggestion(suggestion)}
                          className="w-full border-b border-app-border px-3 py-3 text-left last:border-b-0"
                        >
                          <p className="text-sm font-medium text-app-text">{suggestion.primaryText}</p>
                          {suggestion.secondaryText ? <p className="text-xs text-app-muted">{suggestion.secondaryText}</p> : null}
                        </button>
                      ))}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex gap-2">
                <Input
                  value={manualRestaurantName}
                  onChange={(event) => setManualRestaurantName(event.target.value)}
                  placeholder="Enter restaurant name"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  fullWidth={false}
                  onClick={() => void saveManualRestaurant()}
                  disabled={manualRestaurantName.trim().length === 0}
                >
                  Save
                </Button>
              </div>
            )}
            {restaurantLookupError ? <p className="text-xs text-rose-700 dark:text-rose-300">{restaurantLookupError}</p> : null}
          </div>
        ) : null}
        {hangoutSummary?.summary_text ? (
          <div className="rounded-lg border border-app-border bg-app-card/70 px-2.5 py-2">
            <p className="text-sm leading-5 text-app-text">
              {summaryExpanded ? hangoutSummary.summary_text : truncateText(hangoutSummary.summary_text, 120)}
            </p>
            {hangoutSummary.summary_text.length > 120 ? (
              <button
                type="button"
                className="mt-1 inline-flex h-8 items-center text-xs font-medium text-app-link underline underline-offset-2"
                onClick={() => setSummaryExpanded((prev) => !prev)}
              >
                {summaryExpanded ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </div>
        ) : null}
        {visitNote && <p className="text-sm italic leading-5 text-app-text">“{visitNote}”</p>}

        <div className="flex flex-wrap items-center gap-2">
          {directionsHref && (
            <a href={directionsHref} target="_blank" rel="noreferrer" aria-label="Open directions" className="icon-button-subtle">
              <Navigation size={16} strokeWidth={1.5} />
            </a>
          )}
          {restaurant?.phone_number && (
            <a href={`tel:${restaurant.phone_number}`} aria-label="Call restaurant" className="icon-button-subtle">
              <Phone size={16} strokeWidth={1.5} />
            </a>
          )}
          {restaurant?.website && (
            <a href={restaurant.website} target="_blank" rel="noreferrer" aria-label="Open website" className="icon-button-subtle">
              <Globe size={16} strokeWidth={1.5} />
            </a>
          )}
          {restaurant?.address && (
            <p className="flex items-center gap-1 text-xs leading-4 text-app-muted">
              <MapPin size={13} strokeWidth={1.5} />
              {restaurant.address}
            </p>
          )}
          {openNow === true && <p className="flex items-center text-xs leading-4 text-emerald-700 dark:text-emerald-300">Open now</p>}
          {openNow === false && <p className="flex items-center text-xs leading-4 text-app-muted">Closed now</p>}
          {todayHours ? (
            <p className="flex items-center gap-1 text-xs leading-4 text-app-muted">
              <Clock3 size={13} strokeWidth={1.5} />
              {todayHours}
            </p>
          ) : placeSyncLoading ? (
            <p className="flex items-center gap-1 text-xs leading-4 text-app-muted">
              <Clock3 size={13} strokeWidth={1.5} />
              Syncing hours...
            </p>
          ) : (
            <p className="flex items-center gap-1 text-xs leading-4 text-app-muted">
              <Clock3 size={13} strokeWidth={1.5} />
              Hours not available yet.
            </p>
          )}
        </div>
      </div>
      <input
        ref={receiptReplaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void replaceReceiptAndRescan(file);
          event.currentTarget.value = '';
        }}
      />
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              fullWidth={false}
              className="h-9 px-2 text-xs"
              onClick={() => setHangoutSheetOpen(true)}
              disabled={uploadingHangoutPhoto}
            >
              {uploadingHangoutPhoto ? 'Uploading photo...' : 'Add hangout photo'}
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
          <Button
            type="button"
            variant="secondary"
            size="sm"
            fullWidth={false}
            className="h-9 px-2 text-xs"
            onClick={() => setHangoutSheetOpen(true)}
            disabled={uploadingHangoutPhoto}
          >
            {uploadingHangoutPhoto ? 'Uploading photo...' : 'Add hangout photo'}
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
              <div className="flex flex-wrap gap-2">
                {participants
                  .filter((participant) => participant.status !== 'removed')
                  .map((participant) => {
                    const isPending = participant.status === 'invited' && !participant.user_id;
                    const name =
                      participant.display_name?.trim() ||
                      participant.invited_email ||
                      (isPending ? 'Invite pending' : 'Buddy');
                    const canRemove = isHost && participant.user_id !== upload.user_id;

                    return (
                      <div key={participant.id} className="inline-flex items-center gap-2 rounded-full border border-app-border bg-app-card px-2 py-1">
                        <span className="text-xs font-medium text-app-text">{name}</span>
                        {isPending ? <span className="text-[11px] text-app-muted">Invite pending</span> : null}
                        {canRemove ? (
                          <button
                            type="button"
                            aria-label={`Remove ${name}`}
                            onClick={() => void removeParticipant(participant.id)}
                            className="icon-button-subtle"
                          >
                            <X size={14} strokeWidth={1.5} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card-surface p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-label">Food</h2>
          {isHost &&
            (showExtractionPrompt ? (
              <Button type="button" onClick={runExtraction} disabled={isExtracting}>
                {isExtracting ? 'Analyzing...' : 'Scan receipt'}
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => void runExtraction()}
                disabled={isExtracting}
                className="inline-flex h-11 items-center text-xs font-medium text-app-link underline underline-offset-2"
              >
                {isExtracting ? 'Analyzing...' : isReceiptCapture ? 'Upload another receipt' : 'Analyze photo'}
              </button>
            ))}
        </div>

        {isHost && (!isReceiptCapture || manualEntryForReceipt) ? (
          <div className="rounded-xl border border-app-border bg-app-card/60 p-2.5 space-y-2">
            <p className="text-xs text-app-muted">Add dishes manually</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_auto]">
              <Input
                value={manualDishName}
                onChange={(event) => setManualDishName(event.target.value)}
                placeholder="Dish name"
              />
              <Input
                value={manualDishPrice}
                onChange={(event) => setManualDishPrice(event.target.value)}
                placeholder="Price (optional)"
                inputMode="decimal"
              />
              <Button
                type="button"
                variant="secondary"
                fullWidth={false}
                onClick={() => void addManualDishItem()}
                disabled={manualDishSaving || manualDishName.trim().length === 0}
              >
                {manualDishSaving ? 'Adding...' : 'Add dish'}
              </Button>
            </div>
            {manualDishError ? <p className="text-xs text-rose-700 dark:text-rose-300">{manualDishError}</p> : null}
          </div>
        ) : null}

        {uploadingDishPhotoFor ? <p className="text-xs text-app-muted">Uploading dish photo...</p> : null}

        {visibleFood.length > 0 ? (
          <div className="divide-y divide-app-border/60">
            {visibleFood.map((row) => {
              const dishName = row.hangoutItem.name_final || row.hangoutItem.name_raw;
              const quantity = Math.max(1, row.hangoutItem.quantity ?? 1);
              const unitPrice = row.hangoutItem.unit_price;
              const identityValue = row.myEntry?.identity_tag ?? null;
              const isNeverAgain = identityValue === 'never_again';
              const rowPhotos = dishPhotosByItemId[row.hangoutItem.id] ?? dishPhotosByItemId[normalizeDish(dishName)] ?? [];
              const dishKey = row.myEntry?.dish_key ?? toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
              const catalog = catalogByDishKey[dishKey] ?? null;

              return (
                <div key={row.hangoutItem.id} className={`space-y-1 p-2 ${isNeverAgain ? 'opacity-60' : ''}`}>
                  <div className="flex min-h-10 items-start justify-between gap-2">
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
                    <DishActionBar
                      onAddPhoto={() => {
                        setDishUploadTarget({ hangoutItemId: row.hangoutItem.id });
                        dishUploadInputRef.current?.click();
                      }}
                      onEdit={() => openDishCatalogEditor(row)}
                      ratingValue={identityValue}
                      onSetRating={(value) => {
                        setFood((prev) =>
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
                      noteValue={row.myEntry?.comment ?? ''}
                      onSaveNote={(value) => {
                        setFood((prev) =>
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
                    />
                    {rowPhotos.slice(0, 2).map((photo, index) => (
                      <button
                        key={photo.id}
                        type="button"
                        className="h-9 w-9 overflow-hidden rounded-md border border-app-border"
                        onClick={() => {
                          setLightboxPhotos(rowPhotos);
                          setLightboxIndex(index);
                        }}
                        aria-label="Open food photo"
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
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {isReceiptCapture && hasTriedExtraction && !isExtracting && hiddenFood.length === 0 ? (
              <div className="rounded-xl border border-rose-300 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/30">
                <p className="text-sm font-medium text-app-text">We couldn&apos;t detect a receipt in this image.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => receiptReplaceInputRef.current?.click()}>
                    Upload another receipt
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setManualEntryForReceipt(true)}>
                    Log food manually
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void cancelHangoutDraft()} disabled={cancelingDraft}>
                    {cancelingDraft ? 'Canceling...' : 'Cancel'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-app-muted">
                {hiddenFood.length > 0
                  ? 'All extracted lines are hidden (fees/tax/tip).'
                  : isReceiptCapture
                    ? 'No food items yet. Scan the receipt to start your recap.'
                    : 'No food items yet. Analyze your photo or add dishes manually.'}
              </p>
            )}
          </>
        )}

        {hiddenFood.length > 0 && (
          <div className="pt-1">
            <button
              type="button"
              className="inline-flex h-9 items-center text-xs font-medium text-app-link underline underline-offset-2"
              onClick={() => setHiddenItemsOpen((prev) => !prev)}
            >
              {hiddenItemsOpen ? 'Hide hidden items' : `Hidden items (${hiddenFood.length})`}
            </button>
            {hiddenItemsOpen && (
              <div className="mt-1 divide-y divide-app-border/50 rounded-lg border border-app-border/70 bg-app-card/50">
                {hiddenFood.map((row) => {
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

      {isHost ? (
        <div className="card-surface p-3 space-y-2">
          {saveHangoutError ? <p className="text-sm text-rose-700 dark:text-rose-300">{saveHangoutError}</p> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" size="lg" onClick={() => void cancelHangoutDraft()} disabled={saveHangoutLoading || cancelingDraft}>
              {cancelingDraft ? 'Canceling...' : 'Cancel'}
            </Button>
            <Button type="button" size="lg" onClick={() => void saveHangout()} disabled={saveHangoutLoading || cancelingDraft}>
              {saveHangoutLoading ? 'Saving...' : 'Save Hangout'}
            </Button>
          </div>
        </div>
      ) : null}

      {saveHangoutToast ? (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-app-border bg-app-card px-3 py-2 text-sm text-app-text shadow-lg">
          {saveHangoutToast}
        </div>
      ) : null}

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

      {editingDishRow && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setEditingDishRow(null)} />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-app-text">Edit dish details</p>
              <Input value={editNameCanonical} onChange={(event) => setEditNameCanonical(event.target.value)} placeholder="Food item name" />
              <textarea
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                placeholder="Description"
                rows={3}
                className="w-full rounded-xl border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary/35"
              />
              <Input value={editFlavorTags} onChange={(event) => setEditFlavorTags(event.target.value)} placeholder="Flavor tags (comma separated)" />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setEditingDishRow(null)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void saveDishCatalogEdits()} disabled={savingDishCatalog}>
                  {savingDishCatalog ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
