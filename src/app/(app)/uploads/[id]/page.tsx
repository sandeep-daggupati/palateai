'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Ban, Check, CheckCircle2, ChevronDown, Clock3, FileText, Flame, Gem, Globe, MapPin, Navigation, Pencil, Phone, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PinMapPicker } from '@/components/maps/PinMapPicker';
import { DishActionBar } from '@/components/DishActionBar';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { DishCatalog, DishEntry, DishEntryParticipant, HangoutItem, ReceiptUpload, Restaurant, VisitParticipant } from '@/lib/supabase/types';
import { toDishKey } from '@/lib/utils';
import { normalizeName } from '@/lib/extraction/normalize';
import { sanitizeText } from '@/lib/text/sanitize';
import { getGoogleMapsLink } from '@/lib/google/mapsLinks';
import { SignedPhoto } from '@/lib/photos/types';
import { deletePhoto, listDishPhotosForHangout, listHangoutPhotos, uploadDishPhoto, uploadHangoutPhoto } from '@/lib/data/photosRepo';
import { uploadImage } from '@/lib/storage/uploadImage';
import { HANGOUT_VIBE_OPTIONS, HangoutVibeKey, normalizeHangoutVibeTags } from '@/lib/hangouts/vibes';

type UnifiedDishRow = {
  hangoutItem: HangoutItem;
  myEntry: Pick<DishEntry, 'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment'> | null;
};

type DishTriedBy = Pick<DishEntryParticipant, 'id' | 'dish_entry_id' | 'user_id' | 'had_it'> & {
  rating?: number | null;
  display_name: string | null;
  avatar_url: string | null;
};

type CrewMember = VisitParticipant & {
  display_name: string | null;
  avatar_url: string | null;
};
type CreatorProfile = {
  display_name: string | null;
  email: string | null;
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
type VisitedAtSource = 'receipt' | 'manual' | 'fallback';
type RestaurantDirectory = Pick<
  Restaurant,
  | 'id'
  | 'place_type'
  | 'name'
  | 'address'
  | 'custom_name'
  | 'approx_address'
  | 'accuracy_meters'
  | 'lat'
  | 'lng'
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
const HANGOUT_DRAFT_DISH_COUNT_KEY = 'palateai:hangout-draft-visible-dish-count';

function readDraftDishCountMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(HANGOUT_DRAFT_DISH_COUNT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        out[key] = Math.floor(value);
      }
    });
    return out;
  } catch {
    return {};
  }
}

function writeDraftDishCount(uploadId: string, count: number): void {
  if (typeof window === 'undefined') return;
  const next = readDraftDishCountMap();
  next[uploadId] = Math.max(0, Math.floor(count));
  window.localStorage.setItem(HANGOUT_DRAFT_DISH_COUNT_KEY, JSON.stringify(next));
}

function clearDraftDishCount(uploadId: string): void {
  if (typeof window === 'undefined') return;
  const next = readDraftDishCountMap();
  if (!(uploadId in next)) return;
  delete next[uploadId];
  window.localStorage.setItem(HANGOUT_DRAFT_DISH_COUNT_KEY, JSON.stringify(next));
}

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

function formatDateTime(value: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function toDateTimeLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatPrice(value: number | null): string {
  if (value == null) return 'Price unavailable';
  return `$${value.toFixed(2)}`;
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
  if (!cleaned) return 'U';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0]?.slice(0, 1) ?? ''}${parts[1]?.slice(0, 1) ?? ''}`.toUpperCase();
}

export default function UploadDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const uploadId = params.id;

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserAvatarUrl, setCurrentUserAvatarUrl] = useState<string | null>(null);
  const [upload, setUpload] = useState<ReceiptUpload | null>(null);
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantDirectory | null>(null);

  const [dishes, setFood] = useState<UnifiedDishRow[]>([]);
  const [catalogByDishKey, setCatalogByDishKey] = useState<Record<string, DishCatalog>>({});

  const [vibeTags, setVibeTags] = useState<HangoutVibeKey[]>([]);
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
  const [deletingHangoutPhotoId, setDeletingHangoutPhotoId] = useState<string | null>(null);
  const [dishPhotosByItemId, setDishPhotosByItemId] = useState<Record<string, SignedPhoto[]>>({});
  const [dishTriedByByEntryId, setDishTriedByByEntryId] = useState<Record<string, DishTriedBy[]>>({});
  const [myDishHadByEntryId, setMyDishHadByEntryId] = useState<Record<string, boolean>>({});
  const [savedMyDishHadByEntryId, setSavedMyDishHadByEntryId] = useState<Record<string, boolean>>({});
  const [triedBySheet, setTriedBySheet] = useState<{ dishName: string; entries: DishTriedBy[] } | null>(null);
  const [participantsSheetOpen, setParticipantsSheetOpen] = useState(false);
  const [entryMetaById, setEntryMetaById] = useState<Record<string, { hangout_item_id: string | null; dish_name: string }>>({});
  const [lightboxPhotos, setLightboxPhotos] = useState<SignedPhoto[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [hangoutSheetOpen, setHangoutSheetOpen] = useState(false);
  const [editingDishRow, setEditingDishRow] = useState<{
    hangoutItemId: string;
    dishKey: string;
    fallbackName: string;
  } | null>(null);
  const [deleteDishTarget, setDeleteDishTarget] = useState<{ hangoutItemId: string; dishEntryId: string | null; dishName: string } | null>(null);
  const [deletingDishEntryId, setDeletingDishEntryId] = useState<string | null>(null);
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
  const [deleteHangoutOpen, setDeleteHangoutOpen] = useState(false);
  const [deleteHangoutLoading, setDeleteHangoutLoading] = useState(false);
  const [deleteHangoutError, setDeleteHangoutError] = useState<string | null>(null);
  const [restaurantQuery, setRestaurantQuery] = useState('');
  const [restaurantSuggestions, setRestaurantSuggestions] = useState<PlaceSuggestion[]>([]);
  const [detectedRestaurantChoices, setDetectedRestaurantChoices] = useState<PlaceSuggestion[]>([]);
  const [detectedPlaceLookupLoading, setDetectedPlaceLookupLoading] = useState(false);
  const [restaurantLookupLoading, setRestaurantLookupLoading] = useState(false);
  const [restaurantLookupError, setRestaurantLookupError] = useState<string | null>(null);
  const [restaurantFocused, setRestaurantFocused] = useState(false);
  const [manualRestaurantMode, setManualRestaurantMode] = useState(false);
  const [pinnedRestaurantMode, setPinnedRestaurantMode] = useState(false);
  const [manualRestaurantName, setManualRestaurantName] = useState('');
  const [manualRestaurantAddress, setManualRestaurantAddress] = useState('');
  const [pinnedRestaurantName, setPinnedRestaurantName] = useState('');
  const [pinnedRestaurantAddress, setPinnedRestaurantAddress] = useState('');
  const [pinnedRestaurantCoords, setPinnedRestaurantCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [detectedMerchant, setDetectedMerchant] = useState<DetectedMerchant | null>(null);


  const [draftOccurredAt, setDraftOccurredAt] = useState<string | null>(null);
  const [draftOccurredAtSource, setDraftOccurredAtSource] = useState<VisitedAtSource | null>(null);
  const [visitDateEditing, setVisitDateEditing] = useState(false);
  const [manualVisitDateEdited, setManualVisitDateEdited] = useState(false);

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
  const canEditHangoutIdentity = isHost;
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

  const enrichDishCatalogForEntry = useCallback(
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
      }).catch(() => undefined);
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
    const userMeta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    setCurrentUserAvatarUrl(
      (typeof userMeta.avatar_url === 'string' && userMeta.avatar_url) ||
        (typeof userMeta.picture === 'string' && userMeta.picture) ||
        null,
    );

    const { data: uploadData } = await supabase.from('receipt_uploads').select('*').eq('id', uploadId).single();

    const typedUpload = uploadData as ReceiptUpload | null;
    setUpload(typedUpload);

    if (!typedUpload || !user) {
      setRestaurant(null);
      setCreatorProfile(null);
      setFood([]);
      setDishTriedByByEntryId({});
      setMyDishHadByEntryId({});
      setSavedMyDishHadByEntryId({});
      setVibeTags([]);
      setDetectedMerchant(null);
      setDraftOccurredAt(null);
      setDraftOccurredAtSource(null);
      setManualVisitDateEdited(false);
      setVisitDateEditing(false);
      setDetectedRestaurantChoices([]);
      setParticipants([]);
      setCurrentUserAvatarUrl(null);
      return;
    }

    const { data: creatorProfileData } = await supabase
      .from('profiles')
      .select('display_name,email')
      .eq('id', typedUpload.user_id)
      .maybeSingle();
    setCreatorProfile((creatorProfileData ?? null) as CreatorProfile | null);

    const restaurantPromise = typedUpload.restaurant_id
      ? supabase.from('restaurants').select('id,place_type,name,address,custom_name,approx_address,accuracy_meters,lat,lng,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync').eq('id', typedUpload.restaurant_id).single()
      : Promise.resolve({ data: null });

    const myEntriesPrimary = await supabase
      .from('dish_entries')
      .select('id,hangout_item_id,dish_name,dish_key,identity_tag,comment,price_original,currency_original,quantity,created_at,eaten_at')
      .eq('hangout_id', uploadId);
    const hangoutEntries = (myEntriesPrimary.data ?? []) as Array<
      Pick<
        DishEntry,
        'id' | 'hangout_item_id' | 'dish_name' | 'dish_key' | 'identity_tag' | 'comment' | 'price_original' | 'currency_original' | 'quantity' | 'created_at' | 'eaten_at'
      >
    >;
    const entryMap: Record<string, { hangout_item_id: string | null; dish_name: string }> = {};
    for (const entry of hangoutEntries) {
      entryMap[entry.id] = {
        hangout_item_id: entry.hangout_item_id ?? null,
        dish_name: entry.dish_name,
      };
    }

    const entryIds = hangoutEntries.map((entry) => entry.id);
    let nextDishTriedByByEntryId: Record<string, DishTriedBy[]> = {};
    let nextMyDishHadByEntryId: Record<string, boolean> = {};
    if (entryIds.length > 0) {
      const { data: triedRows } = await supabase
        .from('dish_entry_participants')
        .select('id,dish_entry_id,user_id,had_it,rating')
        .in('dish_entry_id', entryIds);

      const participantRows = (
        (triedRows ?? []) as Array<Pick<DishEntryParticipant, 'id' | 'dish_entry_id' | 'user_id' | 'had_it' | 'rating'>>
      ).filter((row) => row.user_id && row.dish_entry_id);
      nextMyDishHadByEntryId = participantRows
        .filter((row) => row.user_id === user.id)
        .reduce(
          (acc, row) => {
            acc[row.dish_entry_id] = row.had_it;
            return acc;
          },
          {} as Record<string, boolean>,
        );
      const participantUserIds = Array.from(new Set(participantRows.map((row) => row.user_id).filter(Boolean)));
      const { data: profileRows } =
        participantUserIds.length > 0
          ? await supabase.from('profiles').select('id,display_name,avatar_url').in('id', participantUserIds)
          : { data: [] };
      const profileById = new Map(
        ((profileRows ?? []) as Array<{ id: string; display_name: string | null; avatar_url: string | null }>).map((row) => [row.id, row]),
      );

      nextDishTriedByByEntryId = participantRows
        .filter((row) => row.had_it)
        .reduce(
        (acc, row) => {
          const profile = profileById.get(row.user_id);
          if (!acc[row.dish_entry_id]) acc[row.dish_entry_id] = [];
          acc[row.dish_entry_id].push({
            id: row.id,
            dish_entry_id: row.dish_entry_id,
            user_id: row.user_id,
            had_it: row.had_it,
            rating: row.rating ?? null,
            display_name: profile?.display_name ?? null,
            avatar_url: profile?.avatar_url ?? null,
          });
          return acc;
        },
        {} as Record<string, DishTriedBy[]>,
      );
    }

    const restaurantData = await restaurantPromise;

    const unifiedRows: UnifiedDishRow[] = hangoutEntries.map((entry) => {
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
          const dishName = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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
            const name = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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
    setDishTriedByByEntryId(nextDishTriedByByEntryId);
    setMyDishHadByEntryId(nextMyDishHadByEntryId);
    setSavedMyDishHadByEntryId(nextMyDishHadByEntryId);
    setEntryMetaById(entryMap);
    setRestaurant((restaurantData.data ?? null) as RestaurantDirectory | null);
    setVibeTags(normalizeHangoutVibeTags(Array.isArray(typedUpload.vibe_tags) ? typedUpload.vibe_tags.filter((value): value is string => typeof value === 'string') : []));
    setDraftOccurredAt(typedUpload.visited_at ?? typedUpload.created_at ?? null);
    setDraftOccurredAtSource((typedUpload.visited_at_source as VisitedAtSource | null) ?? null);
    setManualVisitDateEdited((typedUpload.visited_at_source as VisitedAtSource | null) === 'manual');
    setVisitDateEditing(false);
    if (typedUpload.restaurant_id) {
      setDetectedRestaurantChoices([]);
    }

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
    if (!upload?.id) return;
    const visibleDishCount = dishes.filter((row) => row.hangoutItem.included).length;
    writeDraftDishCount(upload.id, visibleDishCount);
  }, [dishes, upload?.id]);


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
        const name = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
        const key = normalizedDraftKey(name, row.hangoutItem.unit_price);
        byKey.set(key, row);
      }

      for (const row of mappedRows) {
        const name = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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

          if (canEditHangoutIdentity && !restaurant && merchant?.name) {
            setDetectedPlaceLookupLoading(true);
            try {
              const headers = {
                'Content-Type': 'application/json',
                ...(await getAuthHeader()),
              };

              const resolveResponse = await fetch('/api/restaurants/resolve', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  upload_id: uploadId,
                  merchant_name: merchant.name,
                  merchant_address: merchant.address,
                  visit_lat: upload?.visit_lat ?? null,
                  visit_lng: upload?.visit_lng ?? null,
                }),
              });

              const resolvePayload = (await resolveResponse.json().catch(() => null)) as {
                autoResolved?: boolean;
                source?: 'local' | 'local_fallback' | 'local_google' | 'google' | 'none';
                restaurant?: RestaurantDirectory;
                choices?: PlaceSuggestion[];
              } | null;

              if (resolveResponse.ok && resolvePayload?.autoResolved && resolvePayload.restaurant) {
                setRestaurant(resolvePayload.restaurant);
                setUpload((current) =>
                  current ? { ...current, restaurant_id: resolvePayload.restaurant?.id ?? current.restaurant_id } : current,
                );
                setRestaurantQuery(resolvePayload.restaurant.name);
                const lacksDirectoryData = !hasDirectoryData(resolvePayload.restaurant);
                const needsConfirmation = resolvePayload.source === 'local_fallback' || lacksDirectoryData || !resolvePayload.restaurant.place_id;

                if (needsConfirmation) {
                  const initialChoices = resolvePayload?.choices ?? [];
                  if (initialChoices.length > 0) {
                    setDetectedRestaurantChoices(initialChoices);
                  } else {
                    try {
                      const query = [merchant.name, merchant.address].filter(Boolean).join(' ').trim() || merchant.name;
                      const autocompleteResponse = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(query)}`);
                      const autocompletePayload = (await autocompleteResponse.json().catch(() => null)) as { results?: PlaceSuggestion[] } | null;
                      if (autocompleteResponse.ok) {
                        setDetectedRestaurantChoices((autocompletePayload?.results ?? []).slice(0, 5));
                      } else {
                        setDetectedRestaurantChoices([]);
                      }
                    } catch {
                      setDetectedRestaurantChoices([]);
                    }
                  }
                } else {
                  setDetectedRestaurantChoices([]);
                }
              } else {
                setDetectedRestaurantChoices(resolvePayload?.choices ?? []);
              }
            } catch {
              setDetectedRestaurantChoices([]);
            } finally {
              setDetectedPlaceLookupLoading(false);
            }
          }
        }

        const detectedAt = normalizeDetectedDatetime(payload?.datetime);
        const allowApplyDetectedTime = canEditHangoutIdentity && !manualVisitDateEdited && draftOccurredAtSource !== 'manual';
        if (detectedAt && allowApplyDetectedTime) {
          setDraftOccurredAt(detectedAt);
          setDraftOccurredAtSource('receipt');
        }
        setHasUnsavedChanges(true);
      } finally {
        setIsExtracting(false);
      }
    },
    [canEditHangoutIdentity, draftOccurredAtSource, getAuthHeader, manualVisitDateEdited, mergeExtractedIntoDraft, restaurant, upload?.visit_lat, upload?.visit_lng, uploadId],
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
          const name = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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

  const handleDeleteHangoutPhoto = useCallback(
    async (photoId: string) => {
      setDeletingHangoutPhotoId(photoId);
      try {
        const ok = await deletePhoto(photoId);
        if (!ok) return;
        await loadHangoutPhotos();
      } finally {
        setDeletingHangoutPhotoId(null);
      }
    },
    [loadHangoutPhotos],
  );

  const upsertPersonalMemoryForDish = useCallback(
    async (params: {
      dishEntryId: string;
      dishName: string;
      dishKey: string;
      price: number | null;
      hadIt: boolean;
      rating?: number | null;
      note?: string | null;
      reactionTag?: DishEntry['identity_tag'] | null;
    }) => {
      if (!currentUserId || !upload) return;
      const supabase = getBrowserSupabaseClient();
      const { error } = await supabase.from('personal_food_entries').upsert(
        {
          user_id: currentUserId,
          source_dish_entry_id: params.dishEntryId,
          source_hangout_id: upload.id,
          restaurant_id: restaurant?.id ?? upload.restaurant_id ?? null,
          dish_key: params.dishKey,
          dish_name: params.dishName,
          price: params.price,
          rating: params.rating ?? null,
          note: params.note ?? null,
          reaction_tag: params.reactionTag ?? null,
          had_it: params.hadIt,
          detached_from_hangout: false,
        },
        { onConflict: 'user_id,source_dish_entry_id' },
      );
      if (error) throw error;
    },
    [currentUserId, restaurant?.id, upload],
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
          const dishName = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
          const dishKey = ensured.dish_key ?? toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
          const hadIt = myDishHadByEntryId[ensured.id] ?? true;
          try {
            await upsertPersonalMemoryForDish({
              dishEntryId: ensured.id,
              dishName,
              dishKey,
              price: row.hangoutItem.unit_price ?? null,
              hadIt,
              reactionTag: ensured.identity_tag ?? null,
              note: ensured.comment ?? null,
            });
          } catch {
            // Photo upload should remain successful even if memory sync fails.
          }
          await load();
        }
      } finally {
        setUploadingDishPhotoFor(null);
      }
    },
    [ensureDishEntryForRow, load, myDishHadByEntryId, restaurant?.name, upsertPersonalMemoryForDish, upload?.id],
  );

  const toggleMyDishHadIt = useCallback(
    (row: UnifiedDishRow, nextHadIt: boolean) => {
      if (!currentUserId) return;
      const dishEntryId = row.myEntry?.id;
      if (!dishEntryId || dishEntryId.startsWith('draft-')) return;
      const previousHadIt = myDishHadByEntryId[dishEntryId] ?? false;
      setMyDishHadByEntryId((prev) => ({ ...prev, [dishEntryId]: nextHadIt }));
      void (async () => {
        const supabase = getBrowserSupabaseClient();
        const { error } = await supabase
          .from('dish_entry_participants')
          .upsert(
            {
              dish_entry_id: dishEntryId,
              user_id: currentUserId,
              had_it: nextHadIt,
            },
            { onConflict: 'dish_entry_id,user_id' },
          );
        if (error) {
          setMyDishHadByEntryId((prev) => ({ ...prev, [dishEntryId]: previousHadIt }));
          setSaveHangoutError('Could not update participation right now.');
          return;
        }
        try {
          const dishName = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
          const dishKey = row.myEntry?.dish_key ?? toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
          await upsertPersonalMemoryForDish({
            dishEntryId,
            dishName,
            dishKey,
            price: row.hangoutItem.unit_price ?? null,
            hadIt: nextHadIt,
            reactionTag: row.myEntry?.identity_tag ?? null,
            note: row.myEntry?.comment ?? null,
          });
        } catch {
          // Participation update already succeeded; keep memory sync best-effort.
        }
        setSavedMyDishHadByEntryId((prev) => ({ ...prev, [dishEntryId]: nextHadIt }));
      })();
    },
    [currentUserId, myDishHadByEntryId, restaurant?.name, upsertPersonalMemoryForDish],
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
      const dishName = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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

  const deleteDishRow = useCallback(
    async (target: { hangoutItemId: string; dishEntryId: string | null; dishName: string }) => {
      const persistedDishEntryId = target.dishEntryId;
      const draftLikeId =
        !persistedDishEntryId || persistedDishEntryId.startsWith('draft-') || persistedDishEntryId.startsWith('tmp-');

      if (draftLikeId) {
        setFood((prev) => prev.filter((entry) => entry.hangoutItem.id !== target.hangoutItemId));
        setHasUnsavedChanges(true);
        setDeleteDishTarget(null);
        return;
      }

      if (!upload) return;

      setDeletingDishEntryId(persistedDishEntryId);
      setSaveHangoutError(null);
      try {
        const photos = dishPhotosByItemId[persistedDishEntryId] ?? [];
        if (photos.length > 0) {
          await Promise.all(photos.map((photo: SignedPhoto) => deletePhoto(photo.id).catch(() => false)));
        }

        const supabase = getBrowserSupabaseClient();
        const { error } = await supabase
          .from('dish_entries')
          .delete()
          .eq('id', persistedDishEntryId)
          .eq('hangout_id', upload.id);
        if (error) throw error;
        await supabase.from('personal_food_entries').delete().eq('source_dish_entry_id', persistedDishEntryId);

        setFood((prev) => {
          const next = prev.filter((entry) => entry.hangoutItem.id !== target.hangoutItemId);
          const nextFingerprint = JSON.stringify(
            next
              .map((row) => {
                const name = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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
          setSavedFoodFingerprint(nextFingerprint);
          return next;
        });

        setDishPhotosByItemId((prev) => {
          const next = { ...prev };
          delete next[persistedDishEntryId];
          return next;
        });
        setDishTriedByByEntryId((prev) => {
          const next = { ...prev };
          delete next[persistedDishEntryId];
          return next;
        });
        setMyDishHadByEntryId((prev) => {
          const next = { ...prev };
          delete next[persistedDishEntryId];
          return next;
        });
        setSavedMyDishHadByEntryId((prev) => {
          const next = { ...prev };
          delete next[persistedDishEntryId];
          return next;
        });
        setEntryMetaById((prev) => {
          const next = { ...prev };
          delete next[persistedDishEntryId];
          return next;
        });

        setSaveHangoutToast('Dish deleted');
        window.setTimeout(() => setSaveHangoutToast(null), 1500);
      } catch (error) {
        setSaveHangoutError(error instanceof Error ? error.message : 'Could not delete dish');
      } finally {
        setDeletingDishEntryId(null);
        setDeleteDishTarget(null);
      }
    },
    [dishPhotosByItemId, upload],
  );

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
    if (!canEditHangoutIdentity || !restaurant?.id) return;
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
        .select('id,place_type,name,address,custom_name,approx_address,accuracy_meters,lat,lng,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
        .single();
      if (error) throw error;

      setRestaurant((updatedRestaurant ?? null) as RestaurantDirectory | null);
      setRestaurantNameEditing(false);
    } catch (error) {
      setRestaurantLookupError(error instanceof Error ? error.message : 'Could not update restaurant name');
    } finally {
      setRestaurantNameSaving(false);
    }
  }, [canEditHangoutIdentity, restaurant, restaurantNameDraft]);

  const onSelectRestaurantSuggestion = useCallback(
    async (suggestion: PlaceSuggestion) => {
      if (!canEditHangoutIdentity || !upload || !currentUserId) return;
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
                place_type: 'google',
                name: detailsPayload.name,
                address: detailsPayload.address,
                lat: detailsPayload.lat,
                lng: detailsPayload.lng,
                maps_url: detailsPayload.googleMapsUrl ?? null,
              })
              .eq('id', existingRestaurant.id)
              .select('id,place_type,name,address,custom_name,approx_address,accuracy_meters,lat,lng,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
              .single()
          : await supabase
              .from('restaurants')
              .insert({
                user_id: currentUserId,
                place_type: 'google',
                place_id: detailsPayload.placeId,
                name: detailsPayload.name,
                address: detailsPayload.address,
                lat: detailsPayload.lat,
                lng: detailsPayload.lng,
                maps_url: detailsPayload.googleMapsUrl ?? null,
              })
              .select('id,place_type,name,address,custom_name,approx_address,accuracy_meters,lat,lng,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
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
        setDetectedRestaurantChoices([]);
        setManualRestaurantMode(false);
        setRestaurantSuggestions([]);
        setRestaurantFocused(false);
      } catch (error) {
        setRestaurantLookupError(error instanceof Error ? error.message : 'Could not update restaurant');
      }
    },
    [canEditHangoutIdentity, currentUserId, getAuthHeader, upload],
  );

  const saveManualRestaurant = useCallback(async () => {
    if (!canEditHangoutIdentity || !upload || !currentUserId) return;
    const name = manualRestaurantName.trim();
    if (!name) return;
    try {
      setRestaurantLookupError(null);
      const supabase = getBrowserSupabaseClient();
      const { data: createdRestaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .insert({
          user_id: currentUserId,
          place_type: 'google',
          name,
          address: manualRestaurantAddress.trim() || null,
        })
        .select('id,place_type,name,address,custom_name,approx_address,accuracy_meters,lat,lng,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
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
      setDetectedRestaurantChoices([]);
      setManualRestaurantMode(false);
    } catch (error) {
      setRestaurantLookupError(error instanceof Error ? error.message : 'Could not update restaurant');
    }
  }, [canEditHangoutIdentity, currentUserId, manualRestaurantAddress, manualRestaurantName, upload]);

  const savePinnedRestaurant = useCallback(async () => {
    if (!canEditHangoutIdentity || !upload || !currentUserId || !pinnedRestaurantCoords) return;
    const name = pinnedRestaurantName.trim() || 'Pinned location';
    try {
      setRestaurantLookupError(null);
      const supabase = getBrowserSupabaseClient();
      const { data: createdRestaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .insert({
          user_id: currentUserId,
          place_type: 'pinned',
          name,
          custom_name: pinnedRestaurantName.trim() || null,
          approx_address: pinnedRestaurantAddress.trim() || null,
          place_id: null,
          address: pinnedRestaurantAddress.trim() || null,
          accuracy_meters: null,
          lat: pinnedRestaurantCoords.lat,
          lng: pinnedRestaurantCoords.lng,
        })
        .select('id,place_type,name,address,custom_name,approx_address,accuracy_meters,lat,lng,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
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
      setPinnedRestaurantMode(false);
      setPinnedRestaurantName('');
      setPinnedRestaurantAddress('');
      setPinnedRestaurantCoords(null);
      setDetectedRestaurantChoices([]);
      setManualRestaurantMode(false);
    } catch (error) {
      setRestaurantLookupError(error instanceof Error ? error.message : 'Could not update pinned location');
    }
  }, [canEditHangoutIdentity, currentUserId, pinnedRestaurantAddress, pinnedRestaurantCoords, pinnedRestaurantName, upload]);

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
      clearDraftDishCount(upload.id);
      await load();
      setHasUnsavedChanges(false);
      setPendingReceiptFile(null);
      setReceiptUpdateModeOpen(false);
      setReceiptReplaceSheetOpen(false);
      setSaveHangoutToast('Changes discarded');
      window.setTimeout(() => setSaveHangoutToast(null), 1600);
    } finally {
      setCancelingDraft(false);
    }
  }, [isHost, load, upload]);

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

  const saveHangout = useCallback(async () => {
    if (!upload || !currentUserId) return;
    setSaveHangoutError(null);

    const nextFingerprint = JSON.stringify(
      dishes
        .map((row) => {
          const name = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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
    const hasFoodDraftChanges = savedFoodFingerprint.length > 0 && savedFoodFingerprint !== nextFingerprint;
    const hasAnyChanges = hasUnsavedChanges || hasFoodDraftChanges;
    if (!hasAnyChanges) return;

    const activeFood = dishes.filter((row) => row.hangoutItem.included);
    if (activeFood.length === 0) {
      setSaveHangoutError('Add at least one food item before saving.');
      return;
    }

    setSaveHangoutLoading(true);
    try {
      const promotedImagePaths = await promoteTempReceiptImages();
      const supabase = getBrowserSupabaseClient();
      const preservedEntryIds = new Set<string>();
      const resolvedDishEntryIdsByRowId: Record<string, string> = {};
      const persistedDraftMetaByRowId: Record<
        string,
        {
          dishName: string;
          dishKey: string;
          price: number | null;
          identityTag: DishEntry['identity_tag'] | null;
          note: string | null;
        }
      > = {};
      let effectiveRestaurantId = restaurant?.id ?? upload.restaurant_id;

      // Preserve a detected merchant as a fallback restaurant so the saved hangout
      // does not regress to "Restaurant not detected" when auto-resolve is incomplete.
      if (!effectiveRestaurantId) {
        const fallbackName = detectedMerchant?.name?.trim() || restaurantQuery.trim();
        const fallbackAddress = detectedMerchant?.address?.trim() || null;
        if (fallbackName) {
          const { data: fallbackRestaurant, error: fallbackRestaurantError } = await supabase
            .from('restaurants')
            .insert({
              user_id: currentUserId,
              place_type: 'google',
              name: fallbackName,
              address: fallbackAddress,
              place_id: null,
              lat: null,
              lng: null,
            })
            .select('id,place_type,name,address,custom_name,approx_address,accuracy_meters,lat,lng,place_id,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync')
            .single();
          if (!fallbackRestaurantError && fallbackRestaurant) {
            effectiveRestaurantId = fallbackRestaurant.id;
            setRestaurant((fallbackRestaurant ?? null) as RestaurantDirectory | null);
            setRestaurantQuery(fallbackRestaurant.name ?? fallbackName);
            setUpload((current) => (current ? { ...current, restaurant_id: fallbackRestaurant.id } : current));
          }
        }
      }

      const effectiveOccurredAt = draftOccurredAt ?? upload.visited_at ?? upload.created_at ?? new Date().toISOString();
      const effectiveOccurredAtSource: VisitedAtSource =
        draftOccurredAtSource ?? (manualVisitDateEdited ? 'manual' : 'fallback');
      const effectiveRestaurantName =
        (restaurant?.name ?? detectedMerchant?.name ?? restaurantQuery.trim()) || 'unknown-restaurant';

      for (const row of activeFood) {
        const dishName = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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
        resolvedDishEntryIdsByRowId[row.hangoutItem.id] = typedSavedEntry.id;
        persistedDraftMetaByRowId[row.hangoutItem.id] = {
          dishName,
          dishKey,
          price: row.hangoutItem.unit_price ?? null,
          identityTag: draftIdentity,
          note: draftComment,
        };
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

      const participationRows = activeFood
        .map((row) => {
          const persistedDishEntryId = resolvedDishEntryIdsByRowId[row.hangoutItem.id] ?? row.myEntry?.id ?? null;
          if (!persistedDishEntryId || persistedDishEntryId.startsWith('draft-')) return null;
          const explicitDraft = myDishHadByEntryId[persistedDishEntryId];
          const priorValue = savedMyDishHadByEntryId[persistedDishEntryId];

          if (typeof explicitDraft === 'boolean') {
            if (explicitDraft === priorValue) return null;
            return {
              dish_entry_id: persistedDishEntryId,
              user_id: currentUserId,
              had_it: explicitDraft,
            };
          }

          return null;
        })
        .filter((row): row is { dish_entry_id: string; user_id: string; had_it: boolean } => Boolean(row));

      if (participationRows.length > 0) {
        const { error: participationError } = await supabase
          .from('dish_entry_participants')
          .upsert(participationRows, { onConflict: 'dish_entry_id,user_id' });
        if (participationError) throw participationError;
      }

      const isSoloHangoutForMemory = participants.filter((participant) => participant.status === 'active').length <= 1;
      const personalMemoryRows = activeFood
        .map((row) => {
          const dishEntryId = resolvedDishEntryIdsByRowId[row.hangoutItem.id] ?? row.myEntry?.id ?? null;
          if (!dishEntryId || dishEntryId.startsWith('draft-')) return null;
          const persistedMeta = persistedDraftMetaByRowId[row.hangoutItem.id];
          if (!persistedMeta) return null;

          const hadItDraft = myDishHadByEntryId[dishEntryId];
          const hasExplicitMemoryFields = Boolean(persistedMeta.identityTag || persistedMeta.note);
          if (typeof hadItDraft !== 'boolean' && !hasExplicitMemoryFields && !isSoloHangoutForMemory) return null;

          return {
            user_id: currentUserId,
            source_dish_entry_id: dishEntryId,
            source_hangout_id: upload.id,
            restaurant_id: effectiveRestaurantId,
            dish_key: persistedMeta.dishKey,
            dish_name: persistedMeta.dishName,
            price: persistedMeta.price,
            rating: null,
            note: persistedMeta.note,
            reaction_tag: persistedMeta.identityTag,
            had_it: typeof hadItDraft === 'boolean' ? hadItDraft : isSoloHangoutForMemory || hasExplicitMemoryFields,
            detached_from_hangout: false,
          };
        })
        .filter(
          (
            row,
          ): row is {
            user_id: string;
            source_dish_entry_id: string;
            source_hangout_id: string;
            restaurant_id: string | null;
            dish_key: string;
            dish_name: string;
            price: number | null;
            rating: null;
            note: string | null;
            reaction_tag: DishEntry['identity_tag'] | null;
            had_it: boolean;
            detached_from_hangout: boolean;
          } => Boolean(row),
        );

      if (personalMemoryRows.length > 0) {
        const { error: personalMemoryError } = await supabase
          .from('personal_food_entries')
          .upsert(personalMemoryRows, { onConflict: 'user_id,source_dish_entry_id' });
        if (personalMemoryError) throw personalMemoryError;
      }

      const { data: existingEntries } = await supabase
        .from('dish_entries')
        .select('id')
        .eq('hangout_id', upload.id);
      const removeIds = (existingEntries ?? []).map((row) => row.id).filter((id) => !preservedEntryIds.has(id));
      if (removeIds.length > 0) {
        await supabase.from('dish_entries').delete().in('id', removeIds);
      }

      await Promise.all(Array.from(preservedEntryIds).map((id) => enrichDishCatalogForEntry(id)));

      await supabase
        .from('receipt_uploads')
        .update({
          restaurant_id: effectiveRestaurantId,
          visited_at: effectiveOccurredAt,
          visited_at_source: effectiveOccurredAtSource,
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

      clearDraftDishCount(upload.id);

      setSaveHangoutToast('Saved ✓');
      setSavedFoodFingerprint(nextFingerprint);
      setSavedMyDishHadByEntryId(myDishHadByEntryId);
      setHasUnsavedChanges(false);
      window.setTimeout(() => setSaveHangoutToast(null), 1800);
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      router.push(`/hangouts/${upload.id}`);
    } finally {
      setSaveHangoutLoading(false);
    }
  }, [
    currentUserId,
    dishes,
    draftOccurredAt,
    draftOccurredAtSource,
    myDishHadByEntryId,
    savedMyDishHadByEntryId,
    manualVisitDateEdited,
    promoteTempReceiptImages,
    hasUnsavedChanges,
    savedFoodFingerprint,
    enrichDishCatalogForEntry,
    detectedMerchant?.address,
    detectedMerchant?.name,
    participants,
    restaurant?.id,
    restaurant?.name,
    restaurantQuery,
    router,
    upload,
    vibeTags,
  ]);

  const deleteHangout = useCallback(async () => {
    if (!upload || !isHost) return;
    setDeleteHangoutError(null);
    setDeleteHangoutLoading(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(await getAuthHeader()),
      };
      const response = await fetch('/api/hangouts/delete', {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ hangoutId: upload.id }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to delete hangout');
      }
      clearDraftDishCount(upload.id);
      router.push('/hangouts');
    } catch (error) {
      setDeleteHangoutError(error instanceof Error ? error.message : 'Failed to delete hangout');
    } finally {
      setDeleteHangoutLoading(false);
    }
  }, [getAuthHeader, isHost, router, upload]);

  if (!upload) {
    return <div className="text-sm text-app-muted">Loading hangout...</div>;
  }

  if (currentUserId && !canViewVisit) {
    return <div className="card-surface text-sm text-app-muted">You do not have access to this hangout.</div>;
  }

  const visitDateTimeValue = draftOccurredAt ?? upload.visited_at ?? upload.created_at;
  const visitDateLabel = formatDateTime(visitDateTimeValue);
  const visibleFood = dishes.filter((row) => row.hangoutItem.included);
  const hiddenFood = dishes.filter((row) => !row.hangoutItem.included);
  const draftFoodFingerprint = JSON.stringify(
    dishes
      .map((row) => {
        const name = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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
  const isSavedHangout = upload.status === 'approved';
  const directionsHref = getGoogleMapsLink(restaurant?.place_id, restaurant?.address, restaurant?.lat, restaurant?.lng, restaurant?.name, restaurant?.place_type);
  const todayHours = getTodayHours(restaurant?.opening_hours ?? null, restaurant?.utc_offset_minutes ?? null);
  const openNow = getOpenNowStatus(restaurant?.opening_hours ?? null, restaurant?.utc_offset_minutes ?? null);
  const showUnsavedIndicator = hasUnsavedChanges || (savedFoodFingerprint.length > 0 && savedFoodFingerprint !== draftFoodFingerprint);
  const showFromReceiptHint = draftOccurredAtSource === 'receipt';
  const creatorLabel =
    currentUserId && upload.user_id === currentUserId
      ? 'You created'
      : 'Shared';
  const participantCount = activeCrew.length;
  const dishCount = visibleFood.length;
  const totalSpend = visibleFood.reduce((sum, row) => {
    const unitPrice = row.hangoutItem.unit_price;
    if (unitPrice == null) return sum;
    return sum + unitPrice * Math.max(1, row.hangoutItem.quantity ?? 1);
  }, 0);
  const hasSpendData = visibleFood.some((row) => row.hangoutItem.unit_price != null);
  const ratedDishCount = visibleFood.filter((row) => Boolean(row.myEntry?.identity_tag)).length;
  const averageRatingLabel = ratedDishCount > 0 ? `${ratedDishCount}/${dishCount} rated` : 'Use "Rate it" on dishes';
  const statsSpendLabel = hasSpendData ? `$${totalSpend.toFixed(2)}` : '—';
  const participantNameById = new Map(participants.map((participant) => [participant.user_id, participant.display_name]));
  const photoOwnerLabel = (userId: string | null | undefined): string => {
    if (!userId) return 'Added by someone';
    if (userId === currentUserId) return 'Added by you';
    if (userId === upload.user_id) {
      const creatorName = creatorProfile?.display_name || creatorProfile?.email?.split('@')[0];
      return creatorName ? `Added by ${creatorName}` : 'Added by creator';
    }
    const crewName = participantNameById.get(userId)?.trim();
    return crewName ? `Added by ${crewName}` : 'Added by crew';
  };
  const getPhotoDishLabel = (dishEntryId: string | null): string | null => {
    if (!dishEntryId) return null;
    const dishName = entryMetaById[dishEntryId]?.dish_name;
    const normalized = sanitizeText(dishName ?? '');
    return normalized.length > 0 ? normalized : null;
  };
  const canDeleteHangoutPhoto = (photo: SignedPhoto): boolean => {
    if (!currentUserId) return false;
    return photo.user_id === currentUserId || upload.user_id === currentUserId;
  };
  const unratedDishCount = dishCount - ratedDishCount;
  const highlights = (() => {
    const aggregate = new Map<
      string,
      {
        dishName: string;
        lovedCount: number;
        hiddenGemCount: number;
        skipCount: number;
        triedCount: number;
      }
    >();

    for (const row of visibleFood) {
      const dishName = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
      if (!dishName) continue;
      const key = dishName.toLowerCase();
      const tag = row.myEntry?.identity_tag ?? null;
      const triedCountForRow = row.myEntry?.id ? (dishTriedByByEntryId[row.myEntry.id]?.length ?? 0) : 0;
      if (!aggregate.has(key)) {
        aggregate.set(key, {
          dishName,
          lovedCount: 0,
          hiddenGemCount: 0,
          skipCount: 0,
          triedCount: triedCountForRow,
        });
      }
      const current = aggregate.get(key)!;
      if (tag === 'go_to' || tag === 'hidden_gem' || tag === 'special_occasion') current.lovedCount += 1;
      if (tag === 'hidden_gem') current.hiddenGemCount += 1;
      if (tag === 'never_again') current.skipCount += 1;
      current.triedCount = Math.max(current.triedCount, triedCountForRow);
    }

    const values = Array.from(aggregate.values());
    const pickTop = (score: (entry: (typeof values)[number]) => number) => {
      const ranked = values
        .map((entry) => ({ entry, value: score(entry) }))
        .filter((row) => row.value > 0)
        .sort((a, b) => b.value - a.value);
      return ranked[0]?.entry ?? null;
    };

    const topLoved = pickTop((entry) => entry.lovedCount);
    const topHidden = pickTop((entry) => entry.hiddenGemCount);
    const topCrowd = pickTop((entry) => entry.triedCount);
    const topSkip = pickTop((entry) => entry.skipCount);

    const rows = [
      topLoved ? { key: 'most_loved', icon: 'most_loved', text: `Most loved: ${topLoved.dishName}` } : null,
      topHidden ? { key: 'hidden_gem', icon: 'hidden_gem', text: `Hidden gem: ${topHidden.dishName}` } : null,
      topCrowd ? { key: 'crowd_favorite', icon: 'crowd_favorite', text: `Everyone tried: ${topCrowd.dishName}` } : null,
      topSkip ? { key: 'skip_next_time', icon: 'skip_next_time', text: `Skip next time: ${topSkip.dishName}` } : null,
    ].filter((row): row is { key: string; icon: 'most_loved' | 'hidden_gem' | 'crowd_favorite' | 'skip_next_time'; text: string } => Boolean(row));

    return rows.slice(0, 3);
  })();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-6">
      <div className="card-surface space-y-5 p-5">
        <div className="min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            {restaurantNameEditing ? (
              <div className="flex min-w-0 flex-1 items-center gap-2">
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
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-[1.75rem] font-semibold leading-8 tracking-tight text-app-text">{restaurant?.name ?? 'Restaurant not detected'}</h1>
                {canEditHangoutIdentity && restaurant?.id ? (
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
              </div>
            )}
            {isSavedHangout ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-100/30 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle2 size={12} strokeWidth={1.7} />
                Saved
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-5 text-app-muted">
            {visitDateEditing && canEditHangoutIdentity ? (
              <div className="flex items-center gap-1">
                <input
                  type="datetime-local"
                  value={toDateTimeLocalInput(visitDateTimeValue)}
                  onChange={(event) => {
                    const value = event.target.value ? new Date(event.target.value).toISOString() : null;
                    setDraftOccurredAt(value);
                    setDraftOccurredAtSource('manual');
                    setManualVisitDateEdited(true);
                    setHasUnsavedChanges(true);
                  }}
                  className="h-8 rounded-lg border border-app-border bg-app-bg px-2 text-xs text-app-text focus:outline-none focus:ring-2 focus:ring-app-primary/35"
                  aria-label="Visited date and time"
                />
                <button
                  type="button"
                  className="icon-button-subtle h-7 w-7"
                  onClick={() => setVisitDateEditing(false)}
                  aria-label="Done editing visited date and time"
                >
                  <Check size={13} strokeWidth={1.7} />
                </button>
              </div>
            ) : (
              <>
                <span>{visitDateLabel}</span>
                {showFromReceiptHint ? (
                  <span className="inline-flex h-5 w-5 items-center justify-center text-app-muted" title="Imported from receipt" aria-label="Imported from receipt">
                    <FileText size={13} strokeWidth={1.7} />
                  </span>
                ) : null}
                {canEditHangoutIdentity ? (
                  <button
                    type="button"
                    className="icon-button-subtle h-7 w-7"
                    onClick={() => setVisitDateEditing(true)}
                    aria-label="Edit visited date and time"
                  >
                    <Pencil size={12} strokeWidth={1.6} />
                  </button>
                ) : null}
              </>
            )}
            <span className="inline-flex items-center rounded-full border border-app-border/80 bg-app-card px-2 py-0.5 text-[11px] font-medium text-app-muted">
              {creatorLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className="flex items-center rounded-full border border-transparent px-0.5 py-0.5 hover:border-app-border/70"
              onClick={() => setParticipantsSheetOpen(true)}
              aria-label="View participants"
              title="View participants"
            >
              {activeCrew.slice(0, 8).map((participant, index) => {
                const name = participant.display_name?.trim() || participant.invited_email || 'Crew member';
                return (
                  <span
                    key={participant.id}
                    className={`inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-app-card bg-app-bg text-[10px] font-medium text-app-text ${index > 0 ? '-ml-2' : ''}`}
                    title={name}
                  >
                    {participant.avatar_url ? (
                      <Image src={participant.avatar_url} alt={name} width={32} height={32} className="h-8 w-8 object-cover" unoptimized />
                    ) : (
                      initialsFromName(name)
                    )}
                  </span>
                );
              })}
              {activeCrew.length > 8 ? <span className="ml-1 text-[11px] text-app-muted">+{activeCrew.length - 8}</span> : null}
            </button>
            {isHost ? (
              <button
                type="button"
                onClick={() => setCrewSheetOpen(true)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-app-border text-app-link"
                aria-label="Add participant"
                title="Add participant"
              >
                <Plus size={14} strokeWidth={1.8} />
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
        {canEditHangoutIdentity && !restaurant ? (
          <div className="space-y-2">
            {!manualRestaurantMode && detectedMerchant?.name ? (
              <div className="rounded-xl border border-app-border bg-app-card/70 p-2.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-app-muted">Restaurant</p>
                <p className="text-sm font-semibold text-app-text">{detectedMerchant.name}</p>
                {detectedMerchant.address ? <p className="text-xs text-app-muted">{detectedMerchant.address}</p> : null}
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-app-muted">Detected from receipt</p>
                  <button
                    type="button"
                    className="text-xs font-medium text-app-link underline underline-offset-2"
                    onClick={() => {
                      setManualRestaurantMode(true);
                      setPinnedRestaurantMode(false);
                      setManualRestaurantName(detectedMerchant.name ?? '');
                      setManualRestaurantAddress(detectedMerchant.address ?? '');
                    }}
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : null}

            {!manualRestaurantMode && detectedPlaceLookupLoading ? <p className="text-xs text-app-muted">Resolving restaurant...</p> : null}

            {!manualRestaurantMode && detectedRestaurantChoices.length > 0 ? (
              <div className="rounded-xl border border-app-border bg-app-card/70 p-2">
                <p className="mb-1 text-xs font-medium text-app-text">Pick the right place</p>
                <div className="space-y-1">
                  {detectedRestaurantChoices.map((choice) => (
                    <button
                      key={choice.placeId}
                      type="button"
                      onClick={() => void onSelectRestaurantSuggestion(choice)}
                      className="w-full rounded-lg border border-app-border px-2 py-2 text-left"
                    >
                      <p className="text-xs font-medium text-app-text">{choice.primaryText}</p>
                      {choice.secondaryText ? <p className="text-[11px] text-app-muted">{choice.secondaryText}</p> : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {(manualRestaurantMode || !detectedMerchant?.name) ? (
              <div className="relative space-y-1">
                <div className="flex flex-wrap gap-2 pb-1">
                  <Button
                    type="button"
                    variant={!manualRestaurantMode && !pinnedRestaurantMode ? 'secondary' : 'ghost'}
                    size="sm"
                    fullWidth={false}
                    onClick={() => {
                      setManualRestaurantMode(false);
                      setPinnedRestaurantMode(false);
                    }}
                  >
                    Search restaurant
                  </Button>
                  <Button
                    type="button"
                    variant={manualRestaurantMode ? 'secondary' : 'ghost'}
                    size="sm"
                    fullWidth={false}
                    onClick={() => {
                      setManualRestaurantMode(true);
                      setPinnedRestaurantMode(false);
                    }}
                  >
                    Add restaurant manually
                  </Button>
                  <Button
                    type="button"
                    variant={pinnedRestaurantMode ? 'secondary' : 'ghost'}
                    size="sm"
                    fullWidth={false}
                    onClick={() => {
                      setPinnedRestaurantMode(true);
                      setManualRestaurantMode(false);
                    }}
                  >
                    Drop a pin
                  </Button>
                </div>

                {!manualRestaurantMode && !pinnedRestaurantMode ? (
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
                          <div className="p-3">
                            <p className="text-sm text-app-muted">No matching places found.</p>
                            <button
                              type="button"
                              className="mt-1 text-xs font-medium text-app-link underline underline-offset-2"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setPinnedRestaurantMode(true);
                                setManualRestaurantMode(false);
                              }}
                            >
                              Can&apos;t find the place? Drop a pin
                            </button>
                          </div>
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
                ) : manualRestaurantMode ? (
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
                ) : (
                  <div className="space-y-2">
                    <Input
                      value={pinnedRestaurantName}
                      onChange={(event) => setPinnedRestaurantName(event.target.value)}
                      placeholder="Custom place name (optional)"
                    />
                    <Input
                      value={pinnedRestaurantAddress}
                      onChange={(event) => setPinnedRestaurantAddress(event.target.value)}
                      placeholder="Nearby address (optional)"
                    />
                    <PinMapPicker value={pinnedRestaurantCoords} onChange={setPinnedRestaurantCoords} />
                    {pinnedRestaurantCoords ? (
                      <p className="text-xs text-app-muted">
                        Pin: {pinnedRestaurantCoords.lat.toFixed(5)}, {pinnedRestaurantCoords.lng.toFixed(5)}
                      </p>
                    ) : (
                      <p className="text-xs text-app-muted">Tap the map or drag the pin to choose a location.</p>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      fullWidth={false}
                      onClick={() => void savePinnedRestaurant()}
                      disabled={!pinnedRestaurantCoords}
                    >
                      Save pinned place
                    </Button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        {restaurantLookupError ? <p className="text-xs text-rose-700 dark:text-rose-300">{restaurantLookupError}</p> : null}
        {restaurant && detectedMerchant?.name ? (
          <p className="text-xs text-app-muted">Receipt detected: {detectedMerchant.name}</p>
        ) : null}
      </div>
      <div className="card-surface overflow-hidden border border-app-border/70 p-0">
        <div className="bg-gradient-to-r from-app-card via-app-card to-app-bg/70 px-4 py-3 text-xs text-app-muted">
          <div className="flex flex-wrap items-center gap-2.5">
            <span><span className="font-semibold text-app-text">{participantCount}</span> people</span>
            <span className="text-app-muted/70">·</span>
            <span><span className="font-semibold text-app-text">{dishCount}</span> dishes</span>
            <span className="text-app-muted/70">·</span>
            {hasSpendData ? (
              <span><span className="font-semibold text-app-text">{statsSpendLabel}</span> total spend</span>
            ) : (
              <span>total spend unavailable</span>
            )}
            <span className="text-app-muted/70">·</span>
            {ratedDishCount > 0 ? (
              <span><span className="font-semibold text-app-text">{ratedDishCount}/{dishCount}</span> rated</span>
            ) : (
              <span className="text-app-muted">{averageRatingLabel}</span>
            )}
          </div>
        </div>
      </div>
      <div className="card-surface space-y-1.5 px-4 py-3">
        {ratedDishCount > 0 ? (
          highlights.length > 0 ? (
            highlights.map((row) => (
              <p key={row.key} className="flex items-center gap-2 text-xs text-app-muted">
                <span aria-hidden="true" className="text-app-muted">
                  {row.icon === 'most_loved' ? <Flame size={12} strokeWidth={1.7} /> : null}
                  {row.icon === 'hidden_gem' ? <Gem size={12} strokeWidth={1.7} /> : null}
                  {row.icon === 'crowd_favorite' ? <Users size={12} strokeWidth={1.7} /> : null}
                  {row.icon === 'skip_next_time' ? <Ban size={12} strokeWidth={1.7} /> : null}
                </span>
                <span className="truncate">{row.text}</span>
              </p>
            ))
          ) : (
            <p className="text-xs text-app-muted">Rate dishes to see highlights</p>
          )
        ) : (
          <p className="text-xs text-app-muted">Rate dishes to see highlights</p>
        )}
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
      <div className="card-surface space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-label">Photos <span className="normal-case text-xs font-normal tracking-normal text-app-muted">— Moments from this hangout</span></h2>
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
        {hangoutPhotos.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {hangoutPhotos.map((photo, index) => {
              const dishLabel = getPhotoDishLabel(photo.dish_entry_id);
              return (
                <button
                  key={photo.id}
                  type="button"
                  className="group relative overflow-hidden rounded-xl border border-app-border"
                  onClick={() => {
                    setLightboxPhotos(hangoutPhotos);
                    setLightboxIndex(index);
                  }}
                >
                  {photo.signedUrls.thumb ? (
                    <Image src={photo.signedUrls.thumb} alt="Hangout thumbnail" width={240} height={240} className="h-28 w-full object-cover" unoptimized />
                  ) : (
                    <div className="h-28 w-full bg-app-card" />
                  )}
                  {canDeleteHangoutPhoto(photo) ? (
                    <button
                      type="button"
                      className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white"
                      aria-label="Delete photo"
                      title="Delete photo"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void handleDeleteHangoutPhoto(photo.id);
                      }}
                      disabled={deletingHangoutPhotoId === photo.id}
                    >
                      <Trash2 size={12} strokeWidth={1.9} />
                    </button>
                  ) : null}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-left">
                    <p className="truncate text-[10px] font-medium text-white/95">{photoOwnerLabel(photo.user_id)}</p>
                    {dishLabel ? <p className="truncate text-[10px] text-white/80">{dishLabel}</p> : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-app-muted">No photos yet. Add one to capture this memory.</p>
        )}
      </div>

      <div className="card-surface space-y-3 p-4">
        <h2 className="section-label">Vibe <span className="normal-case text-xs font-normal tracking-normal text-app-muted">— Tag this hangout to help organize your memories</span></h2>
        <div className="flex flex-wrap gap-1.5">
          {HANGOUT_VIBE_OPTIONS.map((option) => {
            const selected = vibeTags.includes(option.key);
            return (
              <button
                key={option.key}
                type="button"
                disabled={!canEditVisit}
                onClick={() => {
                  if (!canEditVisit) return;
                  setVibeTags((current) => {
                    if (current.includes(option.key)) return current.filter((value) => value !== option.key);
                    return [...current, option.key];
                  });
                  setHasUnsavedChanges(true);
                }}
                className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  selected
                    ? 'border-app-primary/60 bg-app-primary/15 text-app-text'
                    : 'border-app-border bg-app-card text-app-muted'
                } ${!canEditVisit ? 'opacity-60' : ''}`}
              >
                {selected ? <Check size={12} strokeWidth={1.7} className="mr-1" /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

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

      {triedBySheet ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 sm:items-center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close tried by list"
            onClick={() => setTriedBySheet(null)}
          />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3 sm:rounded-2xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-app-text">Who tried this</p>
                <p className="text-xs text-app-muted">{triedBySheet.dishName}</p>
              </div>
              <Button type="button" variant="secondary" size="sm" fullWidth={false} onClick={() => setTriedBySheet(null)}>
                Close
              </Button>
            </div>
            {triedBySheet.entries.length > 0 ? (
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {triedBySheet.entries.map((entry) => {
                  const name = entry.display_name?.trim() || 'User';
                  const avatarUrl =
                    entry.avatar_url ??
                    participants.find((row) => row.user_id === entry.user_id)?.avatar_url ??
                    (entry.user_id === currentUserId ? currentUserAvatarUrl : null);
                  return (
                    <div key={entry.id} className="flex items-center gap-2 rounded-lg border border-app-border/70 bg-app-card/60 px-2 py-1.5">
                      {avatarUrl ? (
                        <Image src={avatarUrl} alt={name} width={24} height={24} className="h-6 w-6 rounded-full object-cover" unoptimized />
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-app-bg text-[10px] font-semibold text-app-muted">
                          {initialsFromName(name)}
                        </span>
                      )}
                      <span className="text-xs font-medium text-app-text">{name}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-app-muted">No one marked yet.</p>
            )}
          </div>
        </div>
      ) : null}

      {participantsSheetOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 sm:items-center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close participants list"
            onClick={() => setParticipantsSheetOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3 sm:rounded-2xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-app-text">Participants</p>
                <p className="text-xs text-app-muted">{participantCount} people</p>
              </div>
              <Button type="button" variant="secondary" size="sm" fullWidth={false} onClick={() => setParticipantsSheetOpen(false)}>
                Close
              </Button>
            </div>
            {activeCrew.length > 0 ? (
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {activeCrew.map((participant) => {
                  const name = participant.display_name?.trim() || participant.invited_email || 'Crew member';
                  return (
                    <div key={participant.id} className="flex items-center gap-2 rounded-lg border border-app-border/70 bg-app-card/60 px-2 py-1.5">
                      {participant.avatar_url ? (
                        <Image src={participant.avatar_url} alt={name} width={24} height={24} className="h-6 w-6 rounded-full object-cover" unoptimized />
                      ) : (
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-app-bg text-[10px] font-semibold text-app-muted">
                          {initialsFromName(name)}
                        </span>
                      )}
                      <span className="truncate text-xs font-medium text-app-text">{name}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-app-muted">No participants yet.</p>
            )}
          </div>
        </div>
      ) : null}

      {deleteDishTarget ? (
        <div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/35 sm:items-center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close delete confirmation"
            onClick={() => {
              if (deletingDishEntryId) return;
              setDeleteDishTarget(null);
            }}
          />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-3 sm:rounded-2xl">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-app-text">Delete this dish?</p>
              <p className="text-xs text-app-muted">This will remove it from the hangout and your food log.</p>
              <p className="truncate text-xs text-app-muted">{deleteDishTarget.dishName}</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDeleteDishTarget(null)}
                disabled={Boolean(deletingDishEntryId)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void deleteDishRow(deleteDishTarget)}
                disabled={Boolean(deletingDishEntryId)}
              >
                {deletingDishEntryId ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card-surface space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="section-label">Food <span className="normal-case text-xs font-normal tracking-normal text-app-muted">— {dishCount} dishes</span></h2>
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

        {unratedDishCount > 0 ? (
          <div className="rounded-lg border border-app-border/80 bg-app-card/70 px-2.5 py-1.5 text-[11px] text-app-muted">
            Use the &quot;Rate it&quot; icon on each dish
          </div>
        ) : null}

        {visibleFood.length > 0 ? (
          <div className="divide-y divide-app-border/60">
            {visibleFood.map((row) => {
              const dishName = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
              const quantity = Math.max(1, row.hangoutItem.quantity ?? 1);
              const unitPrice = row.hangoutItem.unit_price;
              const identityValue = row.myEntry?.identity_tag ?? null;
              const isNeverAgain = identityValue === 'never_again';
              const dishPhoto = row.myEntry?.id ? (dishPhotosByItemId[row.myEntry.id]?.[0] ?? null) : null;
              const dishEntryId = row.myEntry?.id ?? null;
              const baseTriedBy = dishEntryId ? (dishTriedByByEntryId[dishEntryId] ?? []) : [];
              const myHadThis = Boolean(dishEntryId && myDishHadByEntryId[dishEntryId]);
              const selfProfile = participants.find((entry) => entry.user_id === currentUserId);
              const triedBy = (() => {
                if (!dishEntryId || !currentUserId) return baseTriedBy;
                const withoutSelf = baseTriedBy.filter((entry) => entry.user_id !== currentUserId);
                if (!myHadThis) return withoutSelf;
                return [
                  ...withoutSelf,
                  {
                    id: `self-${dishEntryId}-${currentUserId}`,
                    dish_entry_id: dishEntryId,
                    user_id: currentUserId,
                    had_it: true,
                    display_name: selfProfile?.display_name ?? creatorProfile?.display_name ?? 'You',
                    avatar_url: selfProfile?.avatar_url ?? currentUserAvatarUrl ?? null,
                  },
                ];
              })();
              const currentUserHadThis = myHadThis;
              const dishKey = row.myEntry?.dish_key ?? toDishKey(`${restaurant?.name ?? 'unknown-restaurant'} ${dishName}`);
              const catalog = catalogByDishKey[dishKey] ?? null;

              return (
                <div key={dishEntryId ?? row.hangoutItem.id} className={`space-y-1 p-2 ${isNeverAgain ? 'opacity-60' : ''}`}>
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
                        <div className="relative h-full w-full">
                          <Image src={dishPhoto.signedUrls.thumb} alt="Dish photo" width={64} height={64} className="h-full w-full object-cover" unoptimized />
                          {uploadingDishPhotoFor === row.hangoutItem.id ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[10px] font-medium text-white">Uploading...</div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="relative flex h-full w-full items-center justify-center bg-app-bg text-[10px] text-app-muted">
                          Add photo
                          {uploadingDishPhotoFor === row.hangoutItem.id ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-[10px] font-medium text-white">Uploading...</div>
                          ) : null}
                        </div>
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
                              {catalog.flavor_tags?.map((tag) => sanitizeText(tag)).join(' · ')}
                            </p>
                          ) : null}
                        </div>
                        <p className="text-sm font-medium leading-5 text-app-text">{formatPrice(unitPrice)}</p>
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <div className="mr-auto flex min-w-0 items-center gap-2">
                          <span className="text-[11px] text-app-muted">Tried by</span>
                          <div className="flex min-w-0 items-center gap-2">
                            {triedBy.length > 0 ? (
                              <div className="flex items-center">
                                {triedBy.slice(0, 4).map((entry, index) => {
                                  const resolvedName = entry.display_name ?? participants.find((row) => row.user_id === entry.user_id)?.display_name ?? 'User';
                                  const resolvedAvatar =
                                    entry.avatar_url ??
                                    participants.find((row) => row.user_id === entry.user_id)?.avatar_url ??
                                    (entry.user_id === currentUserId ? currentUserAvatarUrl : null);
                                  const isSelfAvatar = Boolean(currentUserId && entry.user_id === currentUserId);
                                  return (
                                    <button
                                      key={entry.id}
                                      type="button"
                                      className={`inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-app-card bg-app-bg text-[10px] font-medium text-app-text ${index > 0 ? '-ml-2' : ''}`}
                                      title={isSelfAvatar ? 'Remove me from this dish' : resolvedName}
                                      aria-label={isSelfAvatar ? `Remove yourself from ${dishName}` : `View who tried ${dishName}`}
                                      onClick={() => {
                                        if (isSelfAvatar) {
                                          void toggleMyDishHadIt(row, false);
                                          return;
                                        }
                                        setTriedBySheet({
                                          dishName,
                                          entries: triedBy.map((entryRow) => {
                                            const fallbackName = participants.find((participant) => participant.user_id === entryRow.user_id)?.display_name ?? 'User';
                                            return {
                                              ...entryRow,
                                              display_name: entryRow.display_name ?? fallbackName,
                                            };
                                          }),
                                        });
                                      }}
                                    >
                                      {resolvedAvatar ? (
                                        <Image
                                          src={resolvedAvatar}
                                          alt={resolvedName}
                                          width={32}
                                          height={32}
                                          className="h-8 w-8 object-cover"
                                          unoptimized
                                        />
                                      ) : (
                                        initialsFromName(resolvedName)
                                      )}
                                    </button>
                                  );
                                })}
                                {triedBy.length > 4 ? <span className="ml-1 text-[11px] text-app-muted">+{triedBy.length - 4}</span> : null}
                              </div>
                            ) : (
                              <span className="text-[11px] text-app-muted">No one yet</span>
                            )}
                            {dishEntryId && !currentUserHadThis ? (
                              <button
                                type="button"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-app-border text-app-muted transition-colors hover:border-app-primary/50 hover:text-app-text"
                                aria-label={`Mark I had ${dishName}`}
                                title="Mark I had this"
                                onClick={() => void toggleMyDishHadIt(row, true)}
                              >
                                <Plus size={15} strokeWidth={1.9} />
                              </button>
                            ) : null}
                          </div>
                        </div>
                    <DishActionBar
                      showPhotoAction={false}
                      onEdit={() => openDishCatalogEditor(row)}
                      onDelete={
                        canEditVisit
                          ? () =>
                              setDeleteDishTarget({
                                hangoutItemId: row.hangoutItem.id,
                                dishEntryId: dishEntryId,
                                dishName,
                              })
                          : undefined
                      }
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
                  const name = sanitizeText(row.hangoutItem.name_final || row.hangoutItem.name_raw);
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
        <div className="card-surface space-y-3 p-4">
          {saveHangoutError ? <p className="text-sm text-rose-700 dark:text-rose-300">{saveHangoutError}</p> : null}
          {deleteHangoutError ? <p className="text-sm text-rose-700 dark:text-rose-300">{deleteHangoutError}</p> : null}
          <div className={`grid gap-2 ${showUnsavedIndicator ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {showUnsavedIndicator ? (
              <Button type="button" variant="secondary" size="lg" onClick={() => void cancelHangoutDraft()} disabled={saveHangoutLoading || cancelingDraft}>
                {cancelingDraft ? 'Canceling...' : 'Cancel'}
              </Button>
            ) : null}
            <Button
              type="button"
              size="lg"
              onClick={() => void saveHangout()}
              disabled={!showUnsavedIndicator || saveHangoutLoading || cancelingDraft}
            >
              {saveHangoutLoading ? 'Saving...' : 'Save Hangout'}
            </Button>
          </div>
          {isHost ? (
            <button
              type="button"
              className="inline-flex h-8 items-center text-xs font-medium text-rose-700 underline underline-offset-2 dark:text-rose-300"
              onClick={() => {
                setDeleteHangoutError(null);
                setDeleteHangoutOpen(true);
              }}
              disabled={deleteHangoutLoading}
            >
              Delete hangout
            </button>
          ) : null}
        </div>
      ) : null}

      {saveHangoutToast ? (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-app-border bg-app-card px-3 py-2 text-sm text-app-text shadow-lg">
          {saveHangoutToast}
        </div>
      ) : null}

      {deleteHangoutOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close delete hangout dialog"
            onClick={() => {
              if (deleteHangoutLoading) return;
              setDeleteHangoutOpen(false);
            }}
          />
          <div className="relative w-full max-w-md rounded-t-2xl border border-app-border bg-app-card p-4">
            <p className="text-sm font-semibold text-app-text">Delete this hangout?</p>
            <p className="mt-1 text-xs leading-5 text-app-muted">
              Deleting this hangout removes the shared hangout for everyone. Any dishes participants rated, noted, or saved to their own food log will remain in their personal memories.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDeleteHangoutOpen(false)}
                disabled={deleteHangoutLoading}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => void deleteHangout()} disabled={deleteHangoutLoading}>
                {deleteHangoutLoading ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
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
