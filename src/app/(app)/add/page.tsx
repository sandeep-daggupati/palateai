'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { uploadAudio } from '@/lib/storage/uploadAudio';
import { uploadImage } from '@/lib/storage/uploadImage';

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

const fieldLabelClass = 'section-label';

export default function AddPage() {
  const router = useRouter();
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [dishFile, setDishFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState<'receipt' | 'menu'>('receipt');
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

  const receiptPickerRef = useRef<HTMLInputElement | null>(null);
  const receiptCameraRef = useRef<HTMLInputElement | null>(null);
  const dishPickerRef = useRef<HTMLInputElement | null>(null);
  const dishCameraRef = useRef<HTMLInputElement | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
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
  }, [restaurantQuery, userLocation]);

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

  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
    recorder.onstop = () => setAudioBlob(new Blob(chunksRef.current, { type: 'audio/webm' }));
    recorder.start();
    mediaRecorderRef.current = recorder;
    setRecording(true);
  };

  const onSubmit = async () => {
    if (!receiptFile && !dishFile) return;
    setLoading(true);

    try {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('Missing user session.');

      let finalRestaurantId: string | null = restaurantId || null;

      if (!finalRestaurantId && restaurantQuery.trim()) {
        const { data: createdRestaurant, error: restaurantError } = await supabase
          .from('restaurants')
          .insert({
            user_id: user.id,
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

      const { data: createdHangout, error: hangoutError } = await supabase
        .from('hangouts')
        .insert({
          owner_user_id: user.id,
          restaurant_id: finalRestaurantId,
          occurred_at: new Date().toISOString(),
          note: null,
        })
        .select('id')
        .single();

      if (hangoutError) throw hangoutError;

      const uploadId = createdHangout.id as string;
      await supabase.from('hangout_participants').upsert(
        { hangout_id: uploadId, user_id: user.id },
        { onConflict: 'hangout_id,user_id' },
      );

      let receiptPath: string | null = null;
      if (receiptFile) {
        receiptPath = await uploadImage({
          file: receiptFile,
          userId: user.id,
          uploadId,
          category: uploadType,
          onProgress: setProgress,
        });

        await supabase.from('hangout_sources').insert({
          hangout_id: uploadId,
          type: 'receipt',
          storage_path: receiptPath,
          extractor: null,
        });

        await supabase.from('photos').insert({
          user_id: user.id,
          kind: 'hangout',
          hangout_id: uploadId,
          storage_original: receiptPath,
          storage_medium: receiptPath,
          storage_thumb: receiptPath,
        });
      }

      if (dishFile) {
        const dishPath = await uploadImage({ file: dishFile, userId: user.id, uploadId, category: 'dish' });
        await supabase.from('hangout_sources').insert({
          hangout_id: uploadId,
          type: 'dish_photo',
          storage_path: dishPath,
          extractor: null,
        });

        const { data: dishEntry } = await supabase
          .from('dish_entries')
          .insert({
            user_id: user.id,
            restaurant_id: finalRestaurantId,
            hangout_id: uploadId,
            source_upload_id: uploadId,
            dish_name: 'Dish photo',
            dish_key: `dish-photo-${crypto.randomUUID()}`,
            currency_original: 'USD',
            had_it: true,
            eaten_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (!dishEntry?.id) throw new Error('Could not create dish entry for dish photo');

        await supabase.from('photos').insert({
          user_id: user.id,
          kind: 'dish',
          dish_entry_id: dishEntry.id,
          storage_original: dishPath,
          storage_medium: dishPath,
          storage_thumb: dishPath,
        });
      }

      let audioPath: string | null = null;
      if (audioBlob) {
        audioPath = await uploadAudio({ blob: audioBlob, userId: user.id, uploadId });
      }

      if (audioPath) {
        await supabase.from('hangout_sources').insert({
          hangout_id: uploadId,
          type: 'manual',
          storage_path: audioPath,
          extractor: null,
        });
      }

      router.push(`/uploads/${uploadId}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4 pb-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-app-text">Add</h1>
        <p className="text-sm text-app-muted">Capture a receipt or menu, then review and save your hangout.</p>
      </div>

      <div className="card-surface space-y-4">
        <div className="space-y-2">
          <p className={fieldLabelClass}>Receipt or Menu Image</p>
          <input
            ref={receiptPickerRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          />
          <input
            ref={receiptCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="primary" size="sm" onClick={() => receiptPickerRef.current?.click()}>
              Upload photo
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => receiptCameraRef.current?.click()}>
              Take photo
            </Button>
          </div>
          <p className="text-xs text-app-muted">{receiptFile ? `Selected: ${receiptFile.name}` : 'No file selected.'}</p>
        </div>

        <div className="space-y-2">
          <p className={fieldLabelClass}>Optional Dish Photo</p>
          <input
            ref={dishPickerRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setDishFile(e.target.files?.[0] ?? null)}
          />
          <input
            ref={dishCameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => setDishFile(e.target.files?.[0] ?? null)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => dishPickerRef.current?.click()}>
              Upload dish
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => dishCameraRef.current?.click()}>
              Take dish photo
            </Button>
          </div>
          <p className="text-xs text-app-muted">{dishFile ? `Selected: ${dishFile.name}` : 'No dish photo selected.'}</p>
        </div>

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
          <p className="text-xs text-app-muted">
            {isSharedVisit
              ? 'Invite your buddies on the next screen. Everyone can log their own experience.'
              : 'Just you: extract, review, and save in one quick pass.'}
          </p>
        </div>

        <div className="space-y-2">
          <label className={fieldLabelClass}>Upload Type</label>
          <select
            className="h-11 w-full rounded-xl border border-app-border bg-app-card px-3 text-base leading-6 text-app-text outline-none transition-colors duration-200 focus:border-app-primary focus:ring-2 focus:ring-app-accent/60"
            value={uploadType}
            onChange={(e) => setUploadType(e.target.value as 'receipt' | 'menu')}
          >
            <option value="receipt">Receipt</option>
            <option value="menu">Menu</option>
          </select>
        </div>

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
                {!autocompleteLoading && suggestions.length === 0 && (
                  <p className="p-3 text-sm text-app-muted">No matching places found.</p>
                )}
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
                      {suggestion.secondaryText && <p className="text-xs text-app-muted">{suggestion.secondaryText}</p>}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {selectedPlace?.address && <p className="text-xs text-app-muted">Selected: {selectedPlace.address}</p>}
          {autocompleteError && <p className="text-xs text-rose-700 dark:text-rose-300">{autocompleteError}</p>}

          <Button type="button" variant="secondary" size="sm" onClick={useMyLocation} disabled={locationLoading}>
            {locationLoading ? 'Locating...' : 'Use my location'}
          </Button>

          {userLocation && (
            <p className="text-xs text-app-muted">
              Using location bias: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
            </p>
          )}
          {locationError && <p className="text-xs text-rose-700 dark:text-rose-300">{locationError}</p>}
        </div>

        <div className="space-y-2">
          <p className={fieldLabelClass}>Audio Note</p>
          <Button type="button" variant="secondary" onClick={toggleRecording}>
            {recording ? 'Stop recording' : audioBlob ? 'Re-record audio note' : 'Record audio note'}
          </Button>
          <p className="text-xs text-app-muted">{audioBlob ? 'Audio note attached.' : 'Optional: add a short voice note.'}</p>
        </div>

        {loading && <p className="text-sm text-app-muted">Uploading... {Math.round(progress)}%</p>}

        <Button type="button" variant="primary" size="lg" onClick={onSubmit} disabled={(!receiptFile && !dishFile) || loading}>
          {loading ? 'Saving...' : 'Save hangout'}
        </Button>
      </div>
    </div>
  );
}


