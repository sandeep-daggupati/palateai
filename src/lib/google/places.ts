export type PlaceDirectoryDetails = {
  phone_number: string | null;
  website: string | null;
  maps_url: string | null;
  opening_hours: {
    open_now?: boolean;
    weekday_text?: string[];
  } | null;
  utc_offset_minutes: number | null;
  google_rating: number | null;
  price_level: number | null;
  business_status: string | null;
};

type GooglePlaceDetailsResponse = {
  status: string;
  result?: {
    formatted_phone_number?: string;
    website?: string;
    url?: string;
    opening_hours?: {
      open_now?: boolean;
      weekday_text?: string[];
    };
    utc_offset_minutes?: number;
    rating?: number;
    price_level?: number;
    business_status?: string;
  };
  error_message?: string;
};

function getPlacesApiKey(): string {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured');
  }
  return apiKey;
}

export async function fetchPlaceDetails(placeId: string): Promise<PlaceDirectoryDetails> {
  const apiKey = getPlacesApiKey();
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'formatted_phone_number,website,url,opening_hours,utc_offset_minutes,rating,price_level,business_status',
    key: apiKey,
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch place details');
  }

  const payload = (await response.json()) as GooglePlaceDetailsResponse;
  if (payload.status !== 'OK' || !payload.result) {
    throw new Error(payload.error_message ?? `Place details failed with status ${payload.status}`);
  }

  return {
    phone_number: payload.result.formatted_phone_number ?? null,
    website: payload.result.website ?? null,
    maps_url: payload.result.url ?? null,
    opening_hours: payload.result.opening_hours
      ? {
          open_now: payload.result.opening_hours.open_now,
          weekday_text: payload.result.opening_hours.weekday_text,
        }
      : null,
    utc_offset_minutes: payload.result.utc_offset_minutes ?? null,
    google_rating: payload.result.rating ?? null,
    price_level: payload.result.price_level ?? null,
    business_status: payload.result.business_status ?? null,
  };
}
