'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { uploadDishPhoto } from '@/lib/data/photosRepo';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { uploadImage } from '@/lib/storage/uploadImage';
import { toDishKey } from '@/lib/utils';

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

type UserLocation = {
  lat: number;
  lng: number;
};

type CaptureMode = 'receipt' | 'food_photo';

const fieldLabelClass = 'section-label';

export default function AddPage() {
  const router = useRouter();
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [restaurantId, setRestaurantId] = useState<string>('');
  const [restaurantQuery, setRestaurantQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [autocompleteError, setAutocompleteError] = useState<string | null>(null);
  const [isRestaurantFocused, setIsRestaurantFocused] = useState(false);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSharedVisit, setIsSharedVisit] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dishName, setDishName] = useState('');
  const [dishPrice, setDishPrice] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const imageCameraRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!captureMode) return;

    if (restaurantQuery.trim().length < 2) {
      setSuggestions([]);
      setAutocompleteError(null);
      setAutocompleteLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        setAutocompleteLoading(true);
        setAutocompleteError(null);

        const params = new URLSearchParams({ q: restaurantQuery.trim() });
        if (userLocation) {
          params.set('lat', String(userLocation.lat));
          params.set('lng', String(userLocation.lng));
        }

        const response = await fetch(`/api/places/autocomplete?${params.toString()}`, {
          signal: controller.signal,
        });

        const payload = (await response.json()) as {
          results?: PlaceSuggestion[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? 'Failed to fetch suggestions');
        }

        setSuggestions(payload.results ?? []);
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setAutocompleteError(error instanceof Error ? error.message : 'Failed to fetch suggestions');
        setSuggestions([]);
      } finally {
        setAutocompleteLoading(false);
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [captureMode, restaurantQuery, userLocation]);

  useEffect(() => {
    if (!imageFile) {
      setPhotoPreviewUrl(null);
      return;
    }
    const nextUrl = URL.createObjectURL(imageFile);
    setPhotoPreviewUrl(nextUrl);
    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [imageFile]);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported on this device.');
      return;
    }

    setLocationLoading(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocationLoading(false);
      },
      (error) => {
        setLocationError(error.message || 'Could not get your location.');
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
    );
  };

  const selectSuggestion = async (suggestion: PlaceSuggestion) => {
    try {
      setAutocompleteError(null);
      const detailsResponse = await fetch(`/api/places/details?placeId=${encodeURIComponent(suggestion.placeId)}`);
      const detailsPayload = (await detailsResponse.json()) as PlaceDetails & { error?: string };

      if (!detailsResponse.ok) {
        throw new Error(detailsPayload.error ?? 'Failed to fetch place details');
      }

      const details: PlaceDetails = {
        placeId: detailsPayload.placeId,
        name: detailsPayload.name,
        address: detailsPayload.address,
        lat: detailsPayload.lat,
        lng: detailsPayload.lng,
        googleMapsUrl: detailsPayload.googleMapsUrl ?? null,
      };

      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('Missing user session.');

      const { data: upsertedRestaurant, error: upsertError } = await supabase
        .from('restaurants')
        .upsert(
          {
            user_id: user.id,
            place_id: details.placeId,
            name: details.name,
            address: details.address,
            lat: details.lat,
            lng: details.lng,
          },
          { onConflict: 'user_id,place_id' },
        )
        .select('id')
        .single();

      if (upsertError) throw upsertError;

      setSelectedPlace(details);
      setRestaurantId(upsertedRestaurant.id as string);
      setRestaurantQuery(details.name);
      setSuggestions([]);
      setIsRestaurantFocused(false);
    } catch (error) {
      setAutocompleteError(error instanceof Error ? error.message : 'Could not select restaurant');
    }
  };

  const clearRestaurant = () => {
    setRestaurantId('');
    setRestaurantQuery('');
    setSelectedPlace(null);
    setSuggestions([]);
    setAutocompleteError(null);
  };

  const selectMode = (mode: CaptureMode) => {
    setCaptureMode(mode);
    setImageFile(null);
    setProgress(0);
    setDishName('');
    setDishPrice('');
    setSaveError(null);
  };

  const cancelFlow = () => {
    setCaptureMode(null);
    setImageFile(null);
    setProgress(0);
    setDishName('');
    setDishPrice('');
    setSaveError(null);
    setRestaurantId('');
    setRestaurantQuery('');
    setSelectedPlace(null);
    setSuggestions([]);
  };

  const ensureRestaurantId = async (userId: string): Promise<string | null> => {
    let finalRestaurantId: string | null = restaurantId || null;
    if (!finalRestaurantId && restaurantQuery.trim()) {
      const supabase = getBrowserSupabaseClient();
      const { data: createdRestaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .insert({
          user_id: userId,
          name: restaurantQuery.trim(),
          place_id: selectedPlace?.placeId ?? null,
          address: selectedPlace?.address ?? null,
          lat: selectedPlace?.lat ?? null,
          lng: selectedPlace?.lng ?? null,
        })
        .select('id')
        .single();

      if (restaurantError) throw restaurantError;
      finalRestaurantId = createdRestaurant.id;
    }
    return finalRestaurantId;
  };

  const saveReceiptFlow = async () => {
    if (!imageFile) return;
    const supabase = getBrowserSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Missing user session.');

    const finalRestaurantId = await ensureRestaurantId(user.id);
    const { data: createdUpload, error: uploadError } = await supabase
      .from('receipt_uploads')
      .insert({
        user_id: user.id,
        restaurant_id: finalRestaurantId,
        status: 'uploaded',
        type: 'receipt',
        image_paths: [],
        visited_at: new Date().toISOString(),
        is_shared: isSharedVisit,
        share_visibility: 'private',
        visit_lat: userLocation?.lat ?? null,
        visit_lng: userLocation?.lng ?? null,
      })
      .select('id')
      .single();

    if (uploadError) throw uploadError;
    const uploadId = createdUpload.id as string;

    const { data: hangoutExisting, error: hangoutExistingError } = await supabase
      .from('hangouts')
      .select('id')
      .eq('id', uploadId)
      .maybeSingle();
    if (hangoutExistingError) throw hangoutExistingError;
    if (!hangoutExisting) {
      const { error: hangoutInsertError } = await supabase.from('hangouts').insert({
        id: uploadId,
        owner_user_id: user.id,
        restaurant_id: finalRestaurantId,
        occurred_at: new Date().toISOString(),
        note: null,
      });
      if (hangoutInsertError) throw hangoutInsertError;
    }

    const { data: participantExisting, error: participantExistingError } = await supabase
      .from('hangout_participants')
      .select('hangout_id')
      .eq('hangout_id', uploadId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (participantExistingError) throw participantExistingError;
    if (!participantExisting) {
      const { error: participantError } = await supabase.from('hangout_participants').insert({
        hangout_id: uploadId,
        user_id: user.id,
      });
      if (participantError) throw participantError;
    }

    const imagePath = await uploadImage({
      file: imageFile,
      userId: user.id,
      uploadId,
      category: 'temp_receipt',
      onProgress: setProgress,
    });

    const { error: finalizeError } = await supabase
      .from('receipt_uploads')
      .update({
        image_paths: [imagePath],
        audio_path: null,
      })
      .eq('id', uploadId);

    if (finalizeError) throw finalizeError;
    router.push(`/uploads/${uploadId}`);
  };

  const saveFoodPhotoFlow = async () => {
    if (!imageFile) return;
    const name = dishName.trim();
    if (!name) {
      setSaveError('Dish name is required.');
      return;
    }

    const supabase = getBrowserSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Missing user session.');

    const finalRestaurantId = await ensureRestaurantId(user.id);
    const numericPrice = Number(dishPrice.trim());
    const price = Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : null;
    const dishKey = toDishKey(`${restaurantQuery.trim() || 'unknown-restaurant'} ${name}`);
    const eatenAt = new Date().toISOString();

    const { data: sourceUpload, error: sourceUploadError } = await supabase
      .from('receipt_uploads')
      .insert({
        user_id: user.id,
        restaurant_id: finalRestaurantId,
        status: 'uploaded',
        type: 'receipt',
        image_paths: [],
        visited_at: eatenAt,
        is_shared: false,
        share_visibility: 'private',
      })
      .select('id')
      .single();
    if (sourceUploadError) throw sourceUploadError;

    const hangoutId = sourceUpload.id;
    const { error: hangoutInsertError } = await supabase.from('hangouts').upsert({
      id: hangoutId,
      owner_user_id: user.id,
      restaurant_id: finalRestaurantId,
      occurred_at: eatenAt,
      note: null,
    });
    if (hangoutInsertError) throw hangoutInsertError;

    const { error: participantError } = await supabase.from('hangout_participants').upsert(
      { hangout_id: hangoutId, user_id: user.id },
      { onConflict: 'hangout_id,user_id' },
    );
    if (participantError) throw participantError;

    const { data: hangoutItem, error: hangoutItemError } = await supabase
      .from('hangout_items')
      .insert({
        hangout_id: hangoutId,
        source_id: null,
        name_raw: name,
        name_final: name,
        quantity: 1,
        unit_price: price,
        currency: 'USD',
        included: true,
        confidence: null,
      })
      .select('id')
      .single();
    if (hangoutItemError || !hangoutItem?.id) throw hangoutItemError ?? new Error('Failed to create food item');

    const entryInsert = await supabase
      .from('dish_entries')
      .insert({
        user_id: user.id,
        restaurant_id: finalRestaurantId,
        hangout_id: hangoutId,
        hangout_item_id: hangoutItem.id,
        source_upload_id: hangoutId,
        dish_name: name,
        price_original: price,
        currency_original: 'USD',
        price_usd: price,
        quantity: 1,
        eaten_at: eatenAt,
        dish_key: dishKey,
        identity_tag: null,
        comment: null,
        had_it: true,
      })
      .select('id')
      .single();
    if (entryInsert.error || !entryInsert.data?.id) throw entryInsert.error ?? new Error('Failed to save food');
    const dishEntryId = entryInsert.data.id;

    const photo = await uploadDishPhoto(hangoutId, dishEntryId, imageFile);
    if (!photo) throw new Error('Photo upload failed');

    router.push('/food');
  };

  const onSubmit = async () => {
    if (!captureMode || !imageFile) return;
    setLoading(true);
    setSaveError(null);
    try {
      if (captureMode === 'receipt') {
        await saveReceiptFlow();
      } else {
        await saveFoodPhotoFlow();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4 pb-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-app-text">Add</h1>
        <p className="text-sm text-app-muted">Capture your meal</p>
      </div>

      {!captureMode ? (
        <section className="card-surface space-y-3">
          <button
            type="button"
            onClick={() => selectMode('receipt')}
            className="w-full rounded-2xl border border-app-border bg-app-card p-4 text-left transition-colors hover:border-app-primary"
          >
            <p className="text-base font-semibold text-app-text">Scan receipt</p>
            <p className="mt-1 text-sm text-app-muted">Extract dishes automatically from a receipt.</p>
          </button>

          <button
            type="button"
            onClick={() => selectMode('food_photo')}
            className="w-full rounded-2xl border border-app-border bg-app-card p-4 text-left transition-colors hover:border-app-primary"
          >
            <p className="text-base font-semibold text-app-text">Add food photo</p>
            <p className="mt-1 text-sm text-app-muted">Snap a picture of your plate and log it manually.</p>
          </button>
        </section>
      ) : (
        <section className="card-surface space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className={fieldLabelClass}>{captureMode === 'receipt' ? 'Receipt upload' : 'Food photo upload'}</p>
            <button type="button" className="text-xs font-medium text-app-link" onClick={() => setCaptureMode(null)}>
              Change
            </button>
          </div>

          <input
            ref={imagePickerRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
          />
          <input
            ref={imageCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="primary" size="sm" onClick={() => imagePickerRef.current?.click()}>
              Upload photo
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => imageCameraRef.current?.click()}>
              Take photo
            </Button>
          </div>
          <p className="text-xs text-app-muted">{imageFile ? `Selected: ${imageFile.name}` : 'No file selected.'}</p>
          {photoPreviewUrl ? (
            <div className="overflow-hidden rounded-xl border border-app-border">
              <Image src={photoPreviewUrl} alt="Selected meal photo" width={960} height={720} className="h-48 w-full object-cover" unoptimized />
            </div>
          ) : null}

          {captureMode === 'food_photo' ? (
            <div className="space-y-2">
              <label className={fieldLabelClass}>Dish name</label>
              <Input value={dishName} onChange={(event) => setDishName(event.target.value)} placeholder="What is this dish?" />
              <label className={fieldLabelClass}>Price</label>
              <Input
                value={dishPrice}
                onChange={(event) => setDishPrice(event.target.value)}
                placeholder="Optional"
                inputMode="decimal"
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <label className={fieldLabelClass}>Restaurant</label>
            <div className="relative">
              <Input
                value={restaurantQuery}
                placeholder="Search restaurant, cafe, bar..."
                onFocus={() => setIsRestaurantFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setIsRestaurantFocused(false), 120);
                }}
                onChange={(e) => {
                  setRestaurantQuery(e.target.value);
                  setRestaurantId('');
                  setSelectedPlace(null);
                }}
              />

              {isRestaurantFocused && restaurantQuery.trim().length >= 2 && (
                <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-app-border bg-app-card shadow-sm">
                  {autocompleteLoading && <p className="p-3 text-sm text-app-muted">Searching nearby places...</p>}
                  {!autocompleteLoading && suggestions.length === 0 && <p className="p-3 text-sm text-app-muted">No matching places found.</p>}
                  {!autocompleteLoading &&
                    suggestions.map((suggestion) => (
                      <button
                        key={suggestion.placeId}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void selectSuggestion(suggestion)}
                        className="w-full border-b border-app-border px-3 py-3 text-left last:border-b-0"
                      >
                        <p className="text-sm font-medium text-app-text">{suggestion.primaryText}</p>
                        {suggestion.secondaryText ? <p className="text-xs text-app-muted">{suggestion.secondaryText}</p> : null}
                      </button>
                    ))}
                </div>
              )}
            </div>

            {selectedPlace?.address ? <p className="text-xs text-app-muted">Selected: {selectedPlace.address}</p> : null}
            {autocompleteError ? <p className="text-xs text-rose-700 dark:text-rose-300">{autocompleteError}</p> : null}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={useMyLocation} disabled={locationLoading}>
                {locationLoading ? 'Locating...' : 'Use my location'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={clearRestaurant}>
                Skip
              </Button>
            </div>

            {userLocation ? (
              <p className="text-xs text-app-muted">
                Using location bias: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
              </p>
            ) : null}
            {locationError ? <p className="text-xs text-rose-700 dark:text-rose-300">{locationError}</p> : null}
          </div>

          {captureMode === 'receipt' ? (
            <div className="space-y-2">
              <label className={fieldLabelClass}>Who is this for?</label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={!isSharedVisit ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setIsSharedVisit(false)}
                >
                  Just me
                </Button>
                <Button
                  type="button"
                  variant={isSharedVisit ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setIsSharedVisit(true)}
                >
                  With crew
                </Button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-app-muted">
              {captureMode === 'receipt' ? `Uploading... ${Math.round(progress)}%` : 'Saving food...'}
            </p>
          ) : null}
          {saveError ? <p className="text-xs text-rose-700 dark:text-rose-300">{saveError}</p> : null}

          {captureMode === 'food_photo' ? (
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" size="lg" onClick={cancelFlow} disabled={loading}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={onSubmit}
                disabled={!imageFile || loading || dishName.trim().length === 0}
              >
                {loading ? 'Saving...' : 'Save food'}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={onSubmit}
              disabled={!imageFile || loading}
            >
              {loading ? 'Saving...' : 'Continue to review'}
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
