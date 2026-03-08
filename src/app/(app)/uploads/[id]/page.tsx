'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, CheckCircle2, ChevronDown, Clock3, Globe, MapPin, Navigation, Pencil, Phone, Plus, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { DishActionBar } from '@/components/DishActionBar';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishCatalog, DishEntry, HangoutItem, HangoutSummary, ReceiptUpload, Restaurant, VisitParticipant } from '@/lib/supabase/types';
import { toDishKey } from '@/lib/utils';
import { normalizeName } from '@/lib/extraction/normalize';
import { getGoogleMapsLink } from '@/lib/google/mapsLinks';
import { SignedPhoto } from '@/lib/photos/types';
import { listDishPhotosForHangout, listHangoutPhotos, uploadDishPhoto, uploadHangoutPhoto } from '@/lib/data/photosRepo';
import { uploadImage } from '@/lib/storage/uploadImage';

const VIBE_OPTIONS = [
  'Great vibes',
  'Go-to spot',
  'Quick bite',
  'Celebrating',
  'Work hangout',
  'Late-night',
] as const;

type UnifiedDishRow = {
  hangoutItem: HangoutItem;
  myEntry: Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'> | null;
};

type CrewMember = VisitParticipant & {
  display_name: string | null;
  avatar_url: string | null;
};

type ShareUserSuggestion = {
  id: string;
  email: string;
  display_name?: string | null;
  avatar_url?: string | null;
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

type ExtractedDraftRow = {
  name_raw: string;
  name_final: string | null;
  quantity: number | null;
  unit_price: number | null;
  confidence: number | null;
  included: boolean;
};
type DetectedMerchant = {
  name: string | null;
  address: string | null;
  phone: string | null;
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

function normalizeDetectedDatetime(value: string | null | undefined): string | null {
  if (!value) return null;
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return null;
  return new Date(stamp).toISOString();
}

function normalizedDraftKey(name: string, unitPrice: number | null): string {
  const normalizedName = normalizeDish(name).replace(/\s+/g, ' ').trim();
  const normalizedPrice = unitPrice == null ? 'noprice' : unitPrice.toFixed(2);
  return `${normalizedName}::${normalizedPrice}`;
}

function initialsFromName(value: string | null): string {
  const cleaned = (value ?? '').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0]?.slice(0, 1) ?? ''}${parts[1]?.slice(0, 1) ?? ''}`.toUpperCase();
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

  const [hangoutSummary, setHangoutSummary] = useState<HangoutSummary | null>(null);
  const [vibeTags, setVibeTags] = useState<string[]>([]);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [captionEditing, setCaptionEditing] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const [captionSaving, setCaptionSaving] = useState(false);
  const [captionRegenerating, setCaptionRegenerating] = useState(false);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [hoursExpanded, setHoursExpanded] = useState(false);
  const [hiddenItemsOpen, setHiddenItemsOpen] = useState(false);

  const [participants, setParticipants] = useState<CrewMember[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSuggestions, setShareSuggestions] = useState<ShareUserSuggestion[]>([]);
  const [shareSuggestLoading, setShareSuggestLoading] = useState(false);
  const [shareFocused, setShareFocused] = useState(false);
  const [crewSheetOpen, setCrewSheetOpen] = useState(false);

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
  const [editPrice, setEditPrice] = useState('');
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
  const [manualRestaurantAddress, setManualRestaurantAddress] = useState('');
  const [detectedMerchant, setDetectedMerchant] = useState<DetectedMerchant | null>(null);
  const [draftRestaurantName, setDraftRestaurantName] = useState('');
  const [draftRestaurantAddress, setDraftRestaurantAddress] = useState('');
  const [draftOccurredAt, setDraftOccurredAt] = useState<string | null>(null);
  const [useDetectedRestaurant, setUseDetectedRestaurant] = useState(false);
  const [restaurantNameEditing, setRestaurantNameEditing] = useState(false);
  const [restaurantNameDraft, setRestaurantNameDraft] = useState('');
  const [restaurantNameSaving, setRestaurantNameSaving] = useState(false);
  const [cancelingDraft, setCancelingDraft] = useState(false);
  const [receiptReplaceSheetOpen, setReceiptReplaceSheetOpen] = useState(false);
  const [receiptUpdateModeOpen, setReceiptUpdateModeOpen] = useState(false);
  const [pendingReceiptFile, setPendingReceiptFile] = useState<File | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [savedFoodFingerprint, setSavedFoodFingerprint] = useState('');
  const receiptReplaceCameraInputRef = useRef<HTMLInputElement | null>(null);
  const receiptReplaceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const didAutoExtractRef = useRef(false);

  useEffect(() => {
    didAutoExtractRef.current = false;
  }, [uploadId]);

  const isHost = Boolean(upload && currentUserId && upload.user_id === currentUserId);

  const isActiveParticipant = useMemo(
    () => Boolean(currentUserId && participants.some((row) => row.user_id === currentUserId && row.status === 'active')),
    [currentUserId, participants],
  );

  const canViewVisit = isHost || isActiveParticipant;
  const canEditVisit = canViewVisit;
  const hasAnyExtractedItems = dishes.length > 0;
  const captureMode = useMemo(() => inferCaptureMode(upload), [upload]);
  const isReceiptCapture = captureMode === 'receipt';
  const showExtractionPrompt = Boolean(canEditVisit && upload && !hasAnyExtractedItems && isReceiptCapture);

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

  const loadHangoutCaption = useCallback(async () => {
    if (!isReceiptCapture) {
      setHangoutSummary(null);
      return;
    }

    const headers = await getAuthHeader();
    if (!headers.Authorization) return;

    const response = await fetch(`/api/caption?hangout_id=${encodeURIComponent(uploadId)}`, { headers });
    if (!response.ok) {
      setHangoutSummary(null);
      return;
    }

    const payload = (await response.json()) as { caption?: HangoutSummary };
    const caption = payload.caption ?? null;
    setHangoutSummary(caption);
    setCaptionDraft(caption?.caption_text ?? '');
  }, [getAuthHeader, isReceiptCapture, uploadId]);

  useEffect(() => {
    if (!restaurant) {
      setRestaurantQuery('');
      return;
    }
    setRestaurantQuery(restaurant.name ?? '');
  }, [restaurant]);

  useEffect(() => {
    if (restaurantNameEditing) return;
    setRestaurantNameDraft(restaurant?.name ?? '');
  }, [restaurant?.name, restaurantNameEditing]);

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
        const key = meta.hangout_item_id ?? photo.dish_entry_id;
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
      setVibeTags([]);
      setDetectedMerchant(null);
      setDraftRestaurantName('');
      setDraftRestaurantAddress('');
      setDraftOccurredAt(null);
      setUseDetectedRestaurant(false);
      setParticipants([]);
      return;
    }

    const restaurantPromise = typedUpload.restaurant_id
      ? supabase.from('restaurants').select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync').eq('id', typedUpload.restaurant_id).single()
      : Promise.resolve({ data: null });

    const myEntriesPrimary = await supabase
      .from('dish_entries')
      .select('id,hangout_item_id,dish_name,dish_key,identity_tag,comment,price_original,currency_original,quantity,created_at,eaten_at')
      .eq('hangout_id', uploadId);
    const myEntries = (myEntriesPrimary.data ?? []) as Array<
      Pick<
        DishEntry,
        'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment' | 'price_original' | 'currency_original' | 'quantity' | 'created_at' | 'eaten_at'
      >
    >;

    const allEntriesResult = await supabase.from('dish_entries').select('id,hangout_item_id,dish_name').eq('hangout_id', uploadId);
    const entryMap: Record<string, { hangout_item_id: string | null; dish_name: string }> = {};
    for (const entry of (allEntriesResult.data ?? []) as Array<Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name'>>) {
      entryMap[entry.id] = {
        hangout_item_id: entry.hangout_item_id ?? null,
        dish_name: entry.dish_name,
      };
    }

    const restaurantData = await restaurantPromise;

    const unifiedRows: UnifiedDishRow[] = myEntries.map((entry) => {
      const dishName = entry.dish_name;
      return {
        hangoutItem: {
          id: entry.id,
          hangout_id: uploadId,
          source_id: null,
          name_raw: dishName,
          name_final: dishName,
          quantity: Math.max(1, entry.quantity ?? 1),
          unit_price: entry.price_original,
          currency: entry.currency_original ?? typedUpload.currency_detected ?? 'USD',
          line_total: null,
          confidence: null,
          included: true,
          created_at: entry.created_at,
        },
        myEntry: {
          id: entry.id,
          hangout_item_id: entry.hangout_item_id,
          dish_name: entry.dish_name,
          dish_key: entry.dish_key,
          identity_tag: entry.identity_tag,
          comment: entry.comment,
        },
      };
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
    setSavedFoodFingerprint(
      JSON.stringify(
        unifiedRows
          .map((row) => {
            const name = row.hangoutItem.name_final || row.hangoutItem.name_raw;
            return {
              key: normalizedDraftKey(name, row.hangoutItem.unit_price),
              quantity: row.hangoutItem.quantity ?? 1,
              included: row.hangoutItem.included,
              note: row.myEntry?.comment ?? null,
              tag: row.myEntry?.identity_tag ?? null,
            };
          })
          .sort((a, b) => (a.key < b.key ? -1 : 1)),
      ),
    );
    setHasUnsavedChanges(false);
    setCatalogByDishKey(nextCatalogByDishKey);
    setEntryMetaById(entryMap);
    setRestaurant((restaurantData.data ?? null) as RestaurantDirectory | null);
    setVibeTags(Array.isArray(typedUpload.vibe_tags) ? typedUpload.vibe_tags.filter((value): value is string => typeof value === 'string') : []);
    setDraftOccurredAt(typedUpload.visited_at ?? null);
    if (typedUpload.restaurant_id) {
      setUseDetectedRestaurant(false);
      setDraftRestaurantName('');
      setDraftRestaurantAddress('');
    }

    await loadParticipants();
    if (inferCaptureMode(typedUpload) === 'receipt') {
      await loadHangoutCaption();
    } else {
      setHangoutSummary(null);
    }
  }, [loadHangoutCaption, loadParticipants, uploadId]);

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

  const mergeExtractedIntoDraft = useCallback((mode: 'add' | 'overwrite', extractedRows: ExtractedDraftRow[]) => {
    const mappedRows: UnifiedDishRow[] = extractedRows.map((item, index) => {
      const dishName = (item.name_final || item.name_raw || '').trim() || `Untitled item ${index + 1}`;
      const quantity = Math.max(1, item.quantity ?? 1);
      return {
        hangoutItem: {
          id: `draft-${crypto.randomUUID()}`,
          hangout_id: uploadId,
          source_id: null,
          name_raw: item.name_raw || dishName,
          name_final: item.name_final || dishName,
          quantity,
          unit_price: item.unit_price ?? null,
          currency: upload?.currency_detected || 'USD',
          line_total: null,
          confidence: item.confidence ?? null,
          included: item.included,
          created_at: new Date().toISOString(),
        },
        myEntry: null,
      };
    });

    setFood((current) => {
      const base = mode === 'overwrite' ? [] : current.map((row) => ({ ...row, hangoutItem: { ...row.hangoutItem } }));
      const byKey = new Map<string, UnifiedDishRow>();

      for (const row of base) {
        const name = row.hangoutItem.name_final || row.hangoutItem.name_raw;
        const key = normalizedDraftKey(name, row.hangoutItem.unit_price);
        byKey.set(key, row);
      }

      for (const row of mappedRows) {
        const name = row.hangoutItem.name_final || row.hangoutItem.name_raw;
        const key = normalizedDraftKey(name, row.hangoutItem.unit_price);
        const existing = byKey.get(key);
        if (!existing) {
          byKey.set(key, row);
          continue;
        }
        existing.hangoutItem.quantity = Math.max(1, (existing.hangoutItem.quantity ?? 1) + (row.hangoutItem.quantity ?? 1));
        existing.hangoutItem.included = existing.hangoutItem.included || row.hangoutItem.included;
      }

      return Array.from(byKey.values());
    });
  }, [upload?.currency_detected, uploadId]);

  const runExtraction = useCallback(
    async (mode: 'add' | 'overwrite' = 'overwrite') => {
      setIsExtracting(true);
      setHasTriedExtraction(true);
      try {
        const response = await fetch('/api/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId, dryRun: true }),
        });
        const payload = (await response.json().catch(() => null)) as {
          items?: ExtractedDraftRow[];
          merchant?: DetectedMerchant | null;
          datetime?: string | null;
        } | null;
        if (!response.ok) return;
        mergeExtractedIntoDraft(mode, payload?.items ?? []);
        const merchant = payload?.merchant ?? null;
        if (merchant?.name || merchant?.address || merchant?.phone) {
          setDetectedMerchant(merchant);
          if (!restaurant) {
            setDraftRestaurantName(merchant.name ?? '');
            setDraftRestaurantAddress(merchant.address ?? '');
          }
        }
        const detectedAt = normalizeDetectedDatetime(payload?.datetime);
        if (detectedAt && !upload?.visited_at) {
          setDraftOccurredAt(detectedAt);
        }
        setHasUnsavedChanges(true);
      } finally {
        setIsExtracting(false);
      }
    },
    [mergeExtractedIntoDraft, restaurant, upload?.visited_at, uploadId],
  );


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
    if (!canEditVisit || !upload) return;
    if (!isReceiptCapture) return;
    if (!upload.image_paths || upload.image_paths.length === 0) return;
    if (upload.processed_at) return;
    if (hasAnyExtractedItems) return;

    didAutoExtractRef.current = true;
    void runExtraction();
  }, [canEditVisit, hasAnyExtractedItems, isReceiptCapture, runExtraction, upload]);

  useEffect(() => {
    const currentFingerprint = JSON.stringify(
      dishes
        .map((row) => {
          const name = row.hangoutItem.name_final || row.hangoutItem.name_raw;
          return {
            key: normalizedDraftKey(name, row.hangoutItem.unit_price),
            quantity: row.hangoutItem.quantity ?? 1,
            included: row.hangoutItem.included,
            note: row.myEntry?.comment ?? null,
            tag: row.myEntry?.identity_tag ?? null,
          };
        })
        .sort((a, b) => (a.key < b.key ? -1 : 1)),
    );
    const dirty = hasUnsavedChanges || (savedFoodFingerprint.length > 0 && savedFoodFingerprint !== currentFingerprint);
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dishes, hasUnsavedChanges, savedFoodFingerprint]);

  const ensureDishEntryForRow = useCallback(
    async (row: UnifiedDishRow): Promise<Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'> | null> => {
      return row.myEntry?.id ? row.myEntry : null;
    },
    [],
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
    if (!name || !upload?.id || !canEditVisit || !currentUserId) return;

    setManualDishSaving(true);
    setManualDishError(null);
    try {
      const parsedPrice = Number(manualDishPrice.trim());
      const unitPrice = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null;
      setFood((prev) => [
        ...prev,
        {
          hangoutItem: {
            id: `draft-${crypto.randomUUID()}`,
            hangout_id: upload.id,
            source_id: null,
            name_raw: name,
            name_final: name,
            quantity: 1,
            unit_price: unitPrice,
            currency: upload.currency_detected || 'USD',
            line_total: null,
            confidence: null,
            included: true,
            created_at: new Date().toISOString(),
          },
          myEntry: null,
        },
      ]);
      setHasUnsavedChanges(true);
      setManualDishName('');
      setManualDishPrice('');
    } catch (error) {
      setManualDishError(error instanceof Error ? error.message : 'Could not add dish');
    } finally {
      setManualDishSaving(false);
    }
  }, [canEditVisit, currentUserId, manualDishName, manualDishPrice, upload]);

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
      setEditPrice(row.hangoutItem.unit_price != null ? String(row.hangoutItem.unit_price) : '');
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
    const parsedPrice = Number(editPrice.trim());
    const nextPrice = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : null;

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
      const supabase = getBrowserSupabaseClient();
      await supabase
        .from('dish_entries')
        .update({
          price_original: nextPrice,
          price_usd: nextPrice,
        })
        .eq('id', editingDishRow.hangoutItemId);

      setFood((prev) =>
        prev.map((entry) =>
          entry.hangoutItem.id === editingDishRow.hangoutItemId
            ? {
                ...entry,
                hangoutItem: {
                  ...entry.hangoutItem,
                  unit_price: nextPrice,
                },
              }
            : entry,
        ),
      );

      if (response.ok && payload?.ok && catalog) {
        setCatalogByDishKey((prev) => ({
          ...prev,
          [catalog.dish_key]: catalog,
        }));
      }
      setEditingDishRow(null);
    } finally {
      setSavingDishCatalog(false);
    }
  }, [editDescription, editFlavorTags, editNameCanonical, editPrice, editingDishRow, getAuthHeader, uploadId]);

  const addParticipant = async (emailOverride?: string) => {
    const email = (emailOverride ?? shareEmail).trim().toLowerCase();
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

  const saveRestaurantName = useCallback(async () => {
    if (!canEditVisit || !restaurant?.id) return;
    const nextName = restaurantNameDraft.trim();
    if (!nextName || nextName === (restaurant.name ?? '').trim()) {
      setRestaurantNameEditing(false);
      setRestaurantNameDraft(restaurant.name ?? '');
      return;
    }

    setRestaurantNameSaving(true);
    setRestaurantLookupError(null);
    try {
      const supabase = getBrowserSupabaseClient();
      const { data: updatedRestaurant, error } = await supabase
        .from('restaurants')
        .update({ name: nextName })
        .eq('id', restaurant.id)
        .select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
        .single();
      if (error) throw error;

      setRestaurant((updatedRestaurant ?? null) as RestaurantDirectory | null);
      setRestaurantNameEditing(false);
    } catch (error) {
      setRestaurantLookupError(error instanceof Error ? error.message : 'Could not update restaurant name');
    } finally {
      setRestaurantNameSaving(false);
    }
  }, [canEditVisit, restaurant, restaurantNameDraft]);

  const onSelectRestaurantSuggestion = useCallback(
    async (suggestion: PlaceSuggestion) => {
      if (!upload || !currentUserId) return;
      try {
        setRestaurantLookupError(null);
        const detailsResponse = await fetch(`/api/places/details?placeId=${encodeURIComponent(suggestion.placeId)}`);
        const detailsPayload = (await detailsResponse.json()) as PlaceDetails & { error?: string };
        if (!detailsResponse.ok) throw new Error(detailsPayload.error ?? 'Could not fetch place details');

        const supabase = getBrowserSupabaseClient();
        const { data: existingRestaurant } = await supabase
          .from('restaurants')
          .select('id')
          .eq('user_id', currentUserId)
          .eq('place_id', detailsPayload.placeId)
          .maybeSingle();

        const restaurantMutation = existingRestaurant?.id
          ? await supabase
              .from('restaurants')
              .update({
                name: detailsPayload.name,
                address: detailsPayload.address,
                lat: detailsPayload.lat,
                lng: detailsPayload.lng,
                maps_url: detailsPayload.googleMapsUrl ?? null,
              })
              .eq('id', existingRestaurant.id)
              .select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
              .single()
          : await supabase
              .from('restaurants')
              .insert({
                user_id: currentUserId,
                place_id: detailsPayload.placeId,
                name: detailsPayload.name,
                address: detailsPayload.address,
                lat: detailsPayload.lat,
                lng: detailsPayload.lng,
                maps_url: detailsPayload.googleMapsUrl ?? null,
              })
              .select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
              .single();

        if (restaurantMutation.error || !restaurantMutation.data) throw restaurantMutation.error ?? new Error('Could not save restaurant');
        let nextRestaurant = restaurantMutation.data as RestaurantDirectory;

        try {
          const headers = {
            'Content-Type': 'application/json',
            ...(await getAuthHeader()),
          };
          const syncResponse = await fetch('/api/places/sync', {
            method: 'POST',
            headers,
            body: JSON.stringify({ restaurant_id: nextRestaurant.id, force: true }),
          });
          if (syncResponse.ok) {
            const syncPayload = (await syncResponse.json()) as { ok?: boolean; restaurant?: RestaurantDirectory };
            if (syncPayload.ok && syncPayload.restaurant) {
              nextRestaurant = syncPayload.restaurant;
            }
          }
        } catch {
          // Non-blocking: selection should still succeed even if sync fails.
        }

        const { error: uploadUpdateError } = await supabase.from('receipt_uploads').update({ restaurant_id: nextRestaurant.id }).eq('id', upload.id);
        if (uploadUpdateError) throw uploadUpdateError;
        await supabase.from('hangouts').update({ restaurant_id: nextRestaurant.id }).eq('id', upload.id);
        await supabase
          .from('dish_entries')
          .update({ restaurant_id: nextRestaurant.id })
          .eq('hangout_id', upload.id);

        setRestaurant(nextRestaurant);
        setUpload((current) => (current ? { ...current, restaurant_id: nextRestaurant.id } : current));
        setRestaurantQuery(nextRestaurant.name);
        setDraftRestaurantName('');
        setDraftRestaurantAddress('');
        setUseDetectedRestaurant(false);
        setRestaurantSuggestions([]);
        setRestaurantFocused(false);
      } catch (error) {
        setRestaurantLookupError(error instanceof Error ? error.message : 'Could not update restaurant');
      }
    },
    [currentUserId, getAuthHeader, upload],
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
          address: manualRestaurantAddress.trim() || null,
        })
        .select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
        .single();
      if (restaurantError) throw restaurantError;

      const { error: uploadUpdateError } = await supabase.from('receipt_uploads').update({ restaurant_id: createdRestaurant.id }).eq('id', upload.id);
      if (uploadUpdateError) throw uploadUpdateError;
      await supabase.from('hangouts').update({ restaurant_id: createdRestaurant.id }).eq('id', upload.id);
      await supabase
        .from('dish_entries')
        .update({ restaurant_id: createdRestaurant.id })
        .eq('hangout_id', upload.id);
      setRestaurant((createdRestaurant ?? null) as RestaurantDirectory | null);
      setUpload((current) => (current ? { ...current, restaurant_id: createdRestaurant.id } : current));
      setRestaurantQuery(createdRestaurant.name);
      setManualRestaurantName('');
      setManualRestaurantAddress('');
      setDraftRestaurantName('');
      setDraftRestaurantAddress('');
      setUseDetectedRestaurant(false);
      setManualRestaurantMode(false);
    } catch (error) {
      setRestaurantLookupError(error instanceof Error ? error.message : 'Could not update restaurant');
    }
  }, [currentUserId, manualRestaurantAddress, manualRestaurantName, upload]);

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
      if (upload.status === 'approved') {
        await load();
        setHasUnsavedChanges(false);
        setPendingReceiptFile(null);
        setReceiptUpdateModeOpen(false);
        setReceiptReplaceSheetOpen(false);
        return;
      }
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
  }, [isHost, load, router, upload]);

  const replaceReceiptAndRescan = useCallback(
    async (file: File, mode: 'add' | 'overwrite') => {
      if (!upload || !currentUserId) return;
      setReceiptReplaceSheetOpen(false);
      setReceiptUpdateModeOpen(false);
      setPendingReceiptFile(null);
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
        const nextPaths = mode === 'add' ? [...(upload.image_paths ?? []), imagePath] : [imagePath];
        const { error: updateError } = await supabase
          .from('receipt_uploads')
          .update({ image_paths: nextPaths, status: 'uploaded' })
          .eq('id', upload.id);
        if (updateError) throw updateError;
        setUpload((current) => (current ? { ...current, image_paths: nextPaths, status: 'uploaded', processed_at: null } : current));
        await new Promise((resolve) => window.setTimeout(resolve, 200));
        await runExtraction(mode);
        setHasUnsavedChanges(true);
      } catch (error) {
        setSaveHangoutError(error instanceof Error ? error.message : 'Could not upload new receipt');
      } finally {
        setIsExtracting(false);
      }
    },
    [currentUserId, runExtraction, upload],
  );

  const saveCaptionOverride = useCallback(async () => {
    if (!upload?.id || !canEditVisit) return;
    const nextText = captionDraft.trim();
    if (!nextText) {
      setCaptionError('Caption cannot be empty.');
      return;
    }

    setCaptionSaving(true);
    setCaptionError(null);
    try {
      const headers = await getAuthHeader();
      const response = await fetch('/api/caption', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          hangout_id: upload.id,
          caption_text: nextText,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { caption?: HangoutSummary; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Could not save caption');
      }
      if (payload?.caption) {
        setHangoutSummary(payload.caption);
        setCaptionDraft(payload.caption.caption_text ?? nextText);
      }
      setCaptionEditing(false);
    } catch (error) {
      setCaptionError(error instanceof Error ? error.message : 'Could not save caption');
    } finally {
      setCaptionSaving(false);
    }
  }, [canEditVisit, captionDraft, getAuthHeader, upload?.id]);

  const regenerateCaption = useCallback(async () => {
    if (!upload?.id || !canEditVisit) return;
    setCaptionRegenerating(true);
    setCaptionError(null);
    try {
      const headers = await getAuthHeader();
      const response = await fetch('/api/caption', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          hangout_id: upload.id,
          force: true,
          vibe_tags: vibeTags,
          overall_vibe: hangoutSummary?.caption_source === 'user' ? captionDraft : undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { caption?: HangoutSummary; error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Could not regenerate caption');
      }
      if (payload?.caption) {
        setHangoutSummary(payload.caption);
        setCaptionDraft(payload.caption.caption_text ?? '');
      }
    } catch (error) {
      setCaptionError(error instanceof Error ? error.message : 'Could not regenerate caption');
    } finally {
      setCaptionRegenerating(false);
    }
  }, [canEditVisit, captionDraft, getAuthHeader, hangoutSummary?.caption_source, upload?.id, vibeTags]);

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
      const nextFingerprint = JSON.stringify(
        dishes
          .map((row) => {
            const name = row.hangoutItem.name_final || row.hangoutItem.name_raw;
            return {
              key: normalizedDraftKey(name, row.hangoutItem.unit_price),
              quantity: row.hangoutItem.quantity ?? 1,
              included: row.hangoutItem.included,
              note: row.myEntry?.comment ?? null,
              tag: row.myEntry?.identity_tag ?? null,
            };
          })
          .sort((a, b) => (a.key < b.key ? -1 : 1)),
      );
      const promotedImagePaths = await promoteTempReceiptImages();
      const supabase = getBrowserSupabaseClient();
      const preservedEntryIds = new Set<string>();
      let effectiveRestaurantId = upload.restaurant_id;

      if (!effectiveRestaurantId && useDetectedRestaurant && draftRestaurantName.trim()) {
        const { data: createdRestaurant, error: createRestaurantError } = await supabase
          .from('restaurants')
          .insert({
            user_id: currentUserId,
            name: draftRestaurantName.trim(),
            address: draftRestaurantAddress.trim() || null,
          })
          .select('id,name,address,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
          .single();
        if (createRestaurantError || !createdRestaurant) {
          throw createRestaurantError ?? new Error('Could not create restaurant from receipt detection');
        }
        effectiveRestaurantId = createdRestaurant.id;
        setRestaurant(createdRestaurant as RestaurantDirectory);
        setUpload((current) => (current ? { ...current, restaurant_id: createdRestaurant.id } : current));
      }

      const effectiveOccurredAt = draftOccurredAt ?? upload.visited_at ?? upload.created_at;
      const effectiveRestaurantName = restaurant?.name ?? (draftRestaurantName.trim() || 'unknown-restaurant');

      for (const row of activeFood) {
        const dishName = row.hangoutItem.name_final || row.hangoutItem.name_raw;
        const dishKey = toDishKey(`${effectiveRestaurantName} ${dishName}`);
        const draftIdentity = row.myEntry?.identity_tag ?? null;
        const draftComment = row.myEntry?.comment?.trim() ? row.myEntry.comment.trim() : null;
        const payload = {
          user_id: currentUserId,
          restaurant_id: effectiveRestaurantId,
          hangout_id: upload.id,
          hangout_item_id: null,
          dish_name: dishName,
          price_original: row.hangoutItem.unit_price,
          currency_original: row.hangoutItem.currency ?? upload.currency_detected ?? 'USD',
          price_usd: row.hangoutItem.unit_price,
          quantity: row.hangoutItem.quantity,
          eaten_at: effectiveOccurredAt,
          source_upload_id: upload.id,
          dish_key: dishKey,
          identity_tag: draftIdentity,
          comment: draftComment,
        };
        const existingId = row.myEntry?.id && !row.myEntry.id.startsWith('tmp-') ? row.myEntry.id : null;
        const saveResult = existingId
          ? await supabase
              .from('dish_entries')
              .update(payload)
              .eq('id', existingId)
              .eq('hangout_id', upload.id)
              .select('id,hangout_item_id,dish_name,dish_key,identity_tag,comment')
              .single()
          : await supabase
              .from('dish_entries')
              .insert(payload)
              .select('id,hangout_item_id,dish_name,dish_key,identity_tag,comment')
              .single();
        if (saveResult.error || !saveResult.data) throw saveResult.error ?? new Error('Failed to save food entry');
        const typedSavedEntry = saveResult.data as Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'>;
        preservedEntryIds.add(typedSavedEntry.id);
        setFood((prev) =>
          prev.map((entry) =>
            entry.hangoutItem.id === row.hangoutItem.id
              ? {
                  ...entry,
                  hangoutItem: {
                    ...entry.hangoutItem,
                    id: typedSavedEntry.id,
                  },
                  myEntry: typedSavedEntry,
                }
              : entry,
          ),
        );
      }

      const { data: existingEntries } = await supabase
        .from('dish_entries')
        .select('id')
        .eq('hangout_id', upload.id);
      const removeIds = (existingEntries ?? []).map((row) => row.id).filter((id) => !preservedEntryIds.has(id));
      if (removeIds.length > 0) {
        await supabase.from('dish_entries').delete().in('id', removeIds);
      }

      await supabase
        .from('receipt_uploads')
        .update({
          restaurant_id: effectiveRestaurantId,
          visited_at: effectiveOccurredAt,
          vibe_tags: vibeTags.length > 0 ? vibeTags : [],
          status: 'approved',
          processed_at: new Date().toISOString(),
          ...(promotedImagePaths ? { image_paths: promotedImagePaths } : {}),
        })
        .eq('id', upload.id);

      await supabase
        .from('hangouts')
        .update({
          restaurant_id: effectiveRestaurantId,
          note: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', upload.id);

      if (isReceiptCapture) {
        try {
          const headers = await getAuthHeader();
          const response = await fetch('/api/caption', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...headers,
            },
            body: JSON.stringify({
              hangout_id: upload.id,
              vibe_tags: vibeTags,
              overall_vibe: hangoutSummary?.caption_source === 'user' ? captionDraft : undefined,
            }),
          });
          if (response.ok) {
            const payload = (await response.json()) as { caption?: HangoutSummary };
            if (payload.caption) {
              setHangoutSummary(payload.caption);
              setCaptionDraft(payload.caption.caption_text ?? '');
            }
          }
        } catch {
          // Caption generation is best-effort and should never block save.
        }
      }

      setSaveHangoutToast('Hangout saved');
      setSavedFoodFingerprint(nextFingerprint);
      setHasUnsavedChanges(false);
      window.setTimeout(() => setSaveHangoutToast(null), 1800);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      router.push(`/hangouts/${upload.id}`);
    } finally {
      setSaveHangoutLoading(false);
    }
  }, [
    captionDraft,
    currentUserId,
    dishes,
    draftOccurredAt,
    draftRestaurantAddress,
    draftRestaurantName,
    getAuthHeader,
    hangoutSummary?.caption_source,
    isReceiptCapture,
    promoteTempReceiptImages,
    restaurant?.name,
    router,
    upload,
    useDetectedRestaurant,
    vibeTags,
  ]);

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
  const visibleFood = dishes.filter((row) => row.hangoutItem.included);
  const hiddenFood = dishes.filter((row) => !row.hangoutItem.included);
  const draftFoodFingerprint = JSON.stringify(
    dishes
      .map((row) => {
        const name = row.hangoutItem.name_final || row.hangoutItem.name_raw;
        return {
          key: normalizedDraftKey(name, row.hangoutItem.unit_price),
          quantity: row.hangoutItem.quantity ?? 1,
          included: row.hangoutItem.included,
          note: row.myEntry?.comment ?? null,
          tag: row.myEntry?.identity_tag ?? null,
        };
      })
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
  );
  const activeCrew = participants
    .filter((participant) => participant.status === 'active')
    .map((participant) => participant);
  const withNames = activeCrew.map((participant) => participant.display_name ?? 'Buddy');
  const withLabel = withNames.length > 0 ? withNames.join(', ') : 'Solo';
  const isSavedHangout = upload.status === 'approved';
  const directionsHref = getGoogleMapsLink(restaurant?.place_id, restaurant?.address, restaurant?.name);
  const todayHours = getTodayHours(restaurant?.opening_hours ?? null, restaurant?.utc_offset_minutes ?? null);
  const openNow = getOpenNowStatus(restaurant?.opening_hours ?? null, restaurant?.utc_offset_minutes ?? null);
  const showUnsavedIndicator = hasUnsavedChanges || (savedFoodFingerprint.length > 0 && savedFoodFingerprint !== draftFoodFingerprint);
  const captionText = hangoutSummary?.caption_text?.trim() ?? '';

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3 pb-4">
      <div className="card-surface space-y-3 p-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            {restaurantNameEditing ? (
              <div className="flex min-w-0 items-center gap-2">
                <input
                  value={restaurantNameDraft}
                  onChange={(event) => setRestaurantNameDraft(event.target.value)}
                  className="h-9 min-w-0 rounded-lg border border-app-border bg-app-bg px-2.5 text-base text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary/35"
                  aria-label="Restaurant name"
                />
                <button
                  type="button"
                  className="icon-button-subtle"
                  aria-label="Save restaurant name"
                  onClick={() => void saveRestaurantName()}
                  disabled={restaurantNameSaving}
                >
                  <Check size={15} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center text-xs font-medium text-app-link underline underline-offset-2"
                  onClick={() => {
                    setRestaurantNameEditing(false);
                    setRestaurantNameDraft(restaurant?.name ?? '');
                  }}
                  disabled={restaurantNameSaving}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <h1 className="truncate text-2xl font-semibold leading-7 text-app-text">{restaurant?.name ?? 'Restaurant not detected'}</h1>
                {canEditVisit && restaurant?.id ? (
                  <button
                    type="button"
                    className="icon-button-subtle"
                    aria-label="Edit restaurant name"
                    title="Edit restaurant name"
                    onClick={() => {
                      setRestaurantNameDraft(restaurant.name ?? '');
                      setRestaurantNameEditing(true);
                    }}
                  >
                    <Pencil size={14} strokeWidth={1.6} />
                  </button>
                ) : null}
              </>
            )}
            {isSavedHangout ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-100/30 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle2 size={12} strokeWidth={1.7} />
                Saved
              </span>
            ) : null}
          </div>
          <p className="text-xs leading-4 text-app-muted">
            {visitDate} · With {withLabel}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {activeCrew.map((participant) => {
              const name = participant.display_name?.trim() || participant.invited_email || 'Crew member';
              const canRemove = isHost && participant.user_id !== upload.user_id;
              return (
                <span key={participant.id} className="inline-flex items-center gap-1.5 rounded-full border border-app-border bg-app-card px-2 py-1">
                  {participant.avatar_url ? (
                    <Image src={participant.avatar_url} alt={name} width={18} height={18} className="h-5 w-5 rounded-full object-cover" unoptimized />
                  ) : (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-app-bg text-[10px] font-semibold text-app-muted">
                      {initialsFromName(name)}
                    </span>
                  )}
                  <span className="text-xs font-medium text-app-text">{name}</span>
                  {canRemove ? (
                    <button
                      type="button"
                      aria-label={`Remove ${name}`}
                      onClick={() => void removeParticipant(participant.id)}
                      className="icon-button-subtle h-5 w-5"
                    >
                      <X size={12} strokeWidth={1.6} />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {isHost ? (
              <button
                type="button"
                onClick={() => setCrewSheetOpen(true)}
                className="inline-flex items-center gap-1 rounded-full border border-app-border bg-app-card px-2 py-1 text-xs font-medium text-app-link"
              >
                <Plus size={12} strokeWidth={1.8} />
                Add
              </button>
            ) : null}
          </div>
          {showUnsavedIndicator ? (
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Unsaved changes</p>
          ) : null}
        </div>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-app-muted">
            {restaurant?.address ? (
              <p className="flex items-center gap-1">
                <MapPin size={13} strokeWidth={1.5} />
                {restaurant.address}
              </p>
            ) : null}
            {openNow === true ? <p className="text-emerald-700 dark:text-emerald-300">Open now</p> : null}
            {openNow === false ? <p>Closed now</p> : null}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {directionsHref ? (
                <a href={directionsHref} target="_blank" rel="noreferrer" aria-label="Open directions" className="icon-button-subtle">
                  <Navigation size={16} strokeWidth={1.5} />
                </a>
              ) : null}
              {restaurant?.phone_number ? (
                <a href={`tel:${restaurant.phone_number}`} aria-label="Call restaurant" className="icon-button-subtle">
                  <Phone size={16} strokeWidth={1.5} />
                </a>
              ) : null}
              {restaurant?.website ? (
                <a href={restaurant.website} target="_blank" rel="noreferrer" aria-label="Open website" className="icon-button-subtle">
                  <Globe size={16} strokeWidth={1.5} />
                </a>
              ) : null}
            </div>
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 text-xs font-medium text-app-link underline underline-offset-2"
              onClick={() => setHoursExpanded((prev) => !prev)}
            >
              Hours
              <ChevronDown size={14} strokeWidth={1.6} className={hoursExpanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
          </div>
          {hoursExpanded ? (
            <p className="flex items-center gap-1 text-xs leading-4 text-app-muted">
              <Clock3 size={13} strokeWidth={1.5} />
              {todayHours ?? (placeSyncLoading ? 'Syncing hours...' : 'Hours not available yet.')}
            </p>
          ) : null}
        </div>
        {canEditVisit && !restaurant ? (
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
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input value={manualRestaurantName} onChange={(event) => setManualRestaurantName(event.target.value)} placeholder="Restaurant name" />
                <Input value={manualRestaurantAddress} onChange={(event) => setManualRestaurantAddress(event.target.value)} placeholder="Address (optional)" />
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
          </div>
        ) : null}
        {restaurantLookupError ? <p className="text-xs text-rose-700 dark:text-rose-300">{restaurantLookupError}</p> : null}
        {!restaurant && detectedMerchant?.name ? (
          <div className="rounded-xl border border-app-border bg-app-card/70 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-app-text">Restaurant (detected)</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="text-xs font-medium text-app-link underline underline-offset-2"
                  onClick={() => {
                    setDraftRestaurantName(detectedMerchant.name ?? '');
                    setDraftRestaurantAddress(detectedMerchant.address ?? '');
                    setUseDetectedRestaurant(true);
                    setHasUnsavedChanges(true);
                  }}
                >
                  {useDetectedRestaurant ? 'Using' : 'Use'}
                </button>
                <button
                  type="button"
                  className="text-xs font-medium text-app-link underline underline-offset-2"
                  onClick={() => {
                    setManualRestaurantMode(true);
                    setManualRestaurantName(draftRestaurantName || detectedMerchant.name || '');
                    setManualRestaurantAddress(draftRestaurantAddress || detectedMerchant.address || '');
                  }}
                >
                  Edit
                </button>
              </div>
            </div>
            <p className="text-sm text-app-text">{draftRestaurantName || detectedMerchant.name}</p>
            {(draftRestaurantAddress || detectedMerchant.address) ? (
              <p className="text-xs text-app-muted">{draftRestaurantAddress || detectedMerchant.address}</p>
            ) : null}
          </div>
        ) : null}
        {restaurant && detectedMerchant?.name ? (
          <p className="text-xs text-app-muted">Receipt detected: {detectedMerchant.name}</p>
        ) : null}
        <div className="rounded-lg border border-app-border border-l-2 border-l-app-primary bg-app-primary/5 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-app-muted" title="Generated by PalateAI. Edit anytime.">
                {hangoutSummary?.caption_source === 'user' ? null : <Sparkles size={12} strokeWidth={1.5} />}
                {hangoutSummary?.caption_source === 'user' ? 'Edited' : 'AI caption'}
              </div>
              {canEditVisit ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="icon-button-subtle"
                    aria-label="Edit caption"
                    title="Edit caption"
                    onClick={() => {
                      setCaptionEditing((prev) => !prev);
                      setCaptionDraft(hangoutSummary?.caption_text ?? '');
                      setCaptionError(null);
                    }}
                  >
                    <Pencil size={14} strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-8 items-center text-xs font-medium text-app-link underline underline-offset-2"
                    onClick={() => void regenerateCaption()}
                    disabled={captionRegenerating}
                  >
                    {captionRegenerating ? 'Trying...' : 'Try another caption'}
                  </button>
                </div>
              ) : null}
            </div>
            {captionEditing ? (
              <div className="space-y-2">
                <textarea
                  value={captionDraft}
                  onChange={(event) => setCaptionDraft(event.target.value)}
                  maxLength={160}
                  rows={2}
                  className="w-full rounded-xl border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary/35"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-app-muted">{captionDraft.length}/160</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" size="sm" fullWidth={false} onClick={() => setCaptionEditing(false)}>
                      Cancel
                    </Button>
                    <Button type="button" size="sm" fullWidth={false} onClick={() => void saveCaptionOverride()} disabled={captionSaving}>
                      {captionSaving ? 'Saving...' : 'Save'}
                    </Button>
                  </div>
                </div>
                {captionError ? <p className="text-xs text-rose-700 dark:text-rose-300">{captionError}</p> : null}
              </div>
            ) : (
              <>
                <p className="text-sm leading-5 text-app-muted/90">{captionText ? (captionExpanded ? captionText : truncateText(captionText, 120)) : 'No memory text yet.'}</p>
                {captionText.length > 120 ? (
                  <button
                    type="button"
                    className="mt-1 inline-flex h-8 items-center text-xs font-medium text-app-link underline underline-offset-2"
                    onClick={() => setCaptionExpanded((prev) => !prev)}
                  >
                    {captionExpanded ? 'Show less' : 'Show more'}
                  </button>
                ) : null}
              </>
            )}
            {canEditVisit ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {VIBE_OPTIONS.map((tag) => {
                  const selected = vibeTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        setVibeTags((current) => (current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]));
                        setHasUnsavedChanges(true);
                      }}
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        selected
                          ? 'border-app-primary/60 bg-app-primary/15 text-app-text'
                          : 'border-app-border bg-app-card text-app-muted'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
      </div>
      <input
        ref={receiptReplaceUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            setPendingReceiptFile(file);
            setReceiptUpdateModeOpen(true);
          }
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={receiptReplaceCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            setPendingReceiptFile(file);
            setReceiptUpdateModeOpen(true);
          }
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
        <div className="card-surface p-3 space-y-2.5">
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
              {uploadingHangoutPhoto ? 'Uploading photo...' : 'Add photos'}
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
            {uploadingHangoutPhoto ? 'Uploading photo...' : 'Add photos'}
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

      {receiptReplaceSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setReceiptReplaceSheetOpen(false)} />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3">
            <div className="space-y-2">
              <Button
                type="button"
                onClick={() => {
                  setReceiptReplaceSheetOpen(false);
                  receiptReplaceCameraInputRef.current?.click();
                }}
              >
                Take photo
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setReceiptReplaceSheetOpen(false);
                  receiptReplaceUploadInputRef.current?.click();
                }}
              >
                Upload photo
              </Button>
            </div>
          </div>
        </div>
      )}

      {receiptUpdateModeOpen && pendingReceiptFile && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => { setReceiptUpdateModeOpen(false); setPendingReceiptFile(null); }} />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3">
            <p className="text-sm font-semibold text-app-text">Update receipt items</p>
            <div className="mt-2 space-y-2">
              <Button
                type="button"
                onClick={() => void replaceReceiptAndRescan(pendingReceiptFile, 'add')}
                disabled={isExtracting}
              >
                Add new items
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void replaceReceiptAndRescan(pendingReceiptFile, 'overwrite')}
                disabled={isExtracting}
              >
                Overwrite existing items
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setReceiptUpdateModeOpen(false);
                  setPendingReceiptFile(null);
                }}
                disabled={isExtracting}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {crewSheetOpen && isHost ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button type="button" className="absolute inset-0" aria-label="Close" onClick={() => setCrewSheetOpen(false)} />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-app-text">Add crew</p>
              <div className="relative">
                <Input
                  value={shareEmail}
                  onFocus={() => setShareFocused(true)}
                  onBlur={() => window.setTimeout(() => setShareFocused(false), 120)}
                  onChange={(event) => setShareEmail(event.target.value)}
                  placeholder="Type name or email"
                  type="email"
                />
                {shareFocused && shareEmail.trim().length >= 2 ? (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-app-border bg-app-card shadow-sm">
                    {shareSuggestLoading ? <p className="p-3 text-xs text-app-muted">Searching users...</p> : null}
                    {!shareSuggestLoading && shareSuggestions.length === 0 ? (
                      <p className="p-3 text-xs text-app-muted">No user match. You can invite this email.</p>
                    ) : null}
                    {!shareSuggestLoading &&
                      shareSuggestions.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={async () => {
                            setShareEmail(user.email);
                            await addParticipant(user.email);
                          }}
                          className="w-full border-b border-app-border px-3 py-2 text-left last:border-b-0"
                        >
                          <div className="flex items-center gap-2">
                            {user.avatar_url ? (
                              <Image src={user.avatar_url} alt={user.display_name ?? user.email} width={22} height={22} className="h-6 w-6 rounded-full object-cover" unoptimized />
                            ) : (
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-app-bg text-[10px] font-semibold text-app-muted">
                                {initialsFromName(user.display_name ?? user.email)}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-app-text">{user.display_name ?? user.email}</p>
                              <p className="truncate text-[11px] text-app-muted">{user.email}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-xs font-medium text-app-link underline underline-offset-2"
                  onClick={() => void addParticipant()}
                  disabled={shareLoading || shareEmail.trim().length === 0}
                >
                  {shareLoading ? 'Adding...' : 'Invite by email'}
                </button>
                <Button type="button" variant="secondary" size="sm" fullWidth={false} onClick={() => setCrewSheetOpen(false)}>
                  Done
                </Button>
              </div>
              {shareError ? <p className="text-xs text-rose-700 dark:text-rose-300">{shareError}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="card-surface p-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-label">Food</h2>
          {canEditVisit &&
            (showExtractionPrompt ? (
              <Button type="button" onClick={() => void runExtraction('overwrite')} disabled={isExtracting}>
                {isExtracting ? 'Analyzing...' : 'Scan receipt'}
              </Button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (isReceiptCapture) {
                    setReceiptReplaceSheetOpen(true);
                    return;
                  }
                  void runExtraction('overwrite');
                }}
                disabled={isExtracting}
                className="inline-flex h-11 items-center text-xs font-medium text-app-link underline underline-offset-2"
              >
                {isExtracting ? 'Analyzing...' : isReceiptCapture ? 'Upload another receipt' : 'Analyze photo'}
              </button>
            ))}
        </div>

        {canEditVisit && (!isReceiptCapture || manualEntryForReceipt) ? (
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
              const dishPhoto = row.myEntry?.id ? (dishPhotosByItemId[row.myEntry.id]?.[0] ?? null) : null;
              const dishKey = row.myEntry?.dish_key ?? toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
              const catalog = catalogByDishKey[dishKey] ?? null;

              return (
                <div key={row.hangoutItem.id} className={`space-y-1 p-2 ${isNeverAgain ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-app-border"
                      onClick={() => {
                        if (dishPhoto) {
                          setLightboxPhotos([dishPhoto]);
                          setLightboxIndex(0);
                          return;
                        }
                        if (upload.status !== 'approved') {
                          setSaveHangoutError('Save hangout first, then add dish photos.');
                          return;
                        }
                        setDishUploadTarget({ hangoutItemId: row.hangoutItem.id });
                        dishUploadInputRef.current?.click();
                      }}
                      aria-label={dishPhoto ? 'Open dish photo' : 'Add dish photo'}
                    >
                      {dishPhoto?.signedUrls.thumb ? (
                        <Image src={dishPhoto.signedUrls.thumb} alt="Dish photo" width={64} height={64} className="h-full w-full object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-app-bg text-[10px] text-app-muted">No photo</div>
                      )}
                    </button>

                    <div className="min-w-0 flex-1 space-y-1">
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

                      <div className="flex items-center justify-end gap-2">
                    <DishActionBar
                      showPhotoAction={false}
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
                        setHasUnsavedChanges(true);
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
                        setHasUnsavedChanges(true);
                      }}
                    />
                      </div>
                    </div>
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
                  <Button type="button" variant="secondary" size="sm" onClick={() => setReceiptReplaceSheetOpen(true)}>
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

      {canEditVisit ? (
        <div className="card-surface p-3 space-y-2.5">
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
              <Input value={editPrice} onChange={(event) => setEditPrice(event.target.value)} placeholder="Price" inputMode="decimal" />
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
