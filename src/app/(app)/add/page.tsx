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
    if (!receiptFile) return;
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

      const { data: createdUpload, error: uploadError } = await supabase
        .from('receipt_uploads')
        .insert({
          user_id: user.id,
          restaurant_id: finalRestaurantId,
          status: 'uploaded',
          type: uploadType,
          image_paths: [],
          visited_at: new Date().toISOString(),
          visit_lat: userLocation?.lat ?? null,
          visit_lng: userLocation?.lng ?? null,
        })
        .select('id')
        .single();

      if (uploadError) throw uploadError;

      const uploadId = createdUpload.id as string;
      const receiptPath = await uploadImage({
        file: receiptFile,
        userId: user.id,
        uploadId,
        category: uploadType,
        onProgress: setProgress,
      });

      if (dishFile) {
        await uploadImage({ file: dishFile, userId: user.id, uploadId, category: 'dish' });
      }

      let audioPath: string | null = null;
      if (audioBlob) {
        audioPath = await uploadAudio({ blob: audioBlob, userId: user.id, uploadId });
      }

      const { error: finalizeError } = await supabase
        .from('receipt_uploads')
        .update({
          image_paths: [receiptPath],
          audio_path: audioPath,
        })
        .eq('id', uploadId);

      if (finalizeError) throw finalizeError;

      router.push(`/uploads/${uploadId}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <h1 className="text-xl font-bold">Add upload</h1>
      <div className="rounded-xl bg-white p-4 shadow-sm space-y-3">
        <label className="text-sm font-medium">Receipt/Menu Image</label>
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
        <div className="flex gap-2">
          <Button type="button" className="w-auto" onClick={() => receiptPickerRef.current?.click()}>
            Upload photo
          </Button>
          <Button
            type="button"
            className="w-auto bg-slate-200 px-4 py-3 text-slate-900 hover:bg-slate-300"
            onClick={() => receiptCameraRef.current?.click()}
          >
            Take photo
          </Button>
        </div>
        <p className="text-xs text-slate-500">{receiptFile ? `Selected: ${receiptFile.name}` : 'No file selected.'}</p>

        <label className="text-sm font-medium">Optional Dish Photo</label>
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
        <div className="flex gap-2">
          <Button
            type="button"
            className="w-auto bg-slate-700 px-4 py-3 text-white hover:bg-slate-600"
            onClick={() => dishPickerRef.current?.click()}
          >
            Upload dish photo
          </Button>
          <Button
            type="button"
            className="w-auto bg-slate-200 px-4 py-3 text-slate-900 hover:bg-slate-300"
            onClick={() => dishCameraRef.current?.click()}
          >
            Take dish photo
          </Button>
        </div>
        <p className="text-xs text-slate-500">{dishFile ? `Selected: ${dishFile.name}` : 'No dish photo selected.'}</p>

        <label className="text-sm font-medium">Upload Type</label>
        <select
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
          value={uploadType}
          onChange={(e) => setUploadType(e.target.value as 'receipt' | 'menu')}
        >
          <option value="receipt">Receipt</option>
          <option value="menu">Menu</option>
        </select>

        <div className="space-y-2">
          <label className="text-sm font-medium">Restaurant</label>
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
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {autocompleteLoading && <p className="p-3 text-sm text-slate-500">Searching nearby places...</p>}
                {!autocompleteLoading && suggestions.length === 0 && (
                  <p className="p-3 text-sm text-slate-500">No matching places found.</p>
                )}
                {!autocompleteLoading && suggestions.map((suggestion) => (
                  <button
                    key={suggestion.placeId}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void selectSuggestion(suggestion)}
                    className="w-full border-b border-slate-100 px-3 py-3 text-left last:border-b-0"
                  >
                    <p className="text-sm font-medium text-slate-900">{suggestion.primaryText}</p>
                    {suggestion.secondaryText && <p className="text-xs text-slate-500">{suggestion.secondaryText}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedPlace?.address && (
            <p className="text-xs text-slate-600">Selected: {selectedPlace.address}</p>
          )}

          {autocompleteError && <p className="text-xs text-red-600">{autocompleteError}</p>}

          <Button
            type="button"
            className="w-auto bg-slate-200 px-3 py-2 text-sm text-slate-900 hover:bg-slate-300"
            onClick={useMyLocation}
            disabled={locationLoading}
          >
            {locationLoading ? 'Locating...' : 'Use my location'}
          </Button>

          {userLocation && (
            <p className="text-xs text-emerald-700">
              Using location bias: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
            </p>
          )}
          {locationError && <p className="text-xs text-red-600">{locationError}</p>}
        </div>

        <Button type="button" className="bg-indigo-600 hover:bg-indigo-500" onClick={toggleRecording}>
          {recording ? 'Stop recording' : audioBlob ? 'Re-record audio note' : 'Record audio note'}
        </Button>
        {audioBlob && <p className="text-xs text-emerald-700">Audio note attached.</p>}

        {loading && <p className="text-xs text-slate-500">Uploading... {Math.round(progress)}%</p>}
        <Button type="button" onClick={onSubmit} disabled={!receiptFile || loading}>
          Save upload
        </Button>
      </div>
    </div>
  );
}
