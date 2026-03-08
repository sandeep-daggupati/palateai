import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/api/auth';
import { fetchPlaceDetails } from '@/lib/google/places';
import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { Database } from '@/lib/supabase/types';

type ResolveRequest = {
  upload_id?: string;
  merchant_name?: string | null;
  merchant_address?: string | null;
  visit_lat?: number | null;
  visit_lng?: number | null;
};

type PlaceChoice = {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  confidence: number;
  distance_meters: number | null;
};

type GoogleTextSearchResponse = {
  status: string;
  results?: Array<{
    place_id?: string;
    name?: string;
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
  }>;
  error_message?: string;
};

type RestaurantRow = Database['public']['Tables']['restaurants']['Row'];

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(aRaw: string | null | undefined, bRaw: string | null | undefined): number {
  const a = normalizeText(aRaw);
  const b = normalizeText(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  const intersection = Array.from(aTokens).filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function localScore(merchantName: string, merchantAddress: string, candidate: RestaurantRow): number {
  const nameSim = tokenSimilarity(merchantName, candidate.name);
  const addressSim = merchantAddress ? tokenSimilarity(merchantAddress, candidate.address) : 0;
  return merchantAddress ? nameSim * 0.75 + addressSim * 0.25 : nameSim;
}

function hasDirectoryFields(row: RestaurantRow): boolean {
  return Boolean(row.phone_number || row.website || row.opening_hours || row.maps_url);
}

async function findBestLocalRestaurant(
  service: ReturnType<typeof getServiceSupabaseClient>,
  userId: string,
  merchantName: string,
  merchantAddress: string,
): Promise<{ row: RestaurantRow; score: number } | null> {
  const { data, error } = await service
    .from('restaurants')
    .select('id,user_id,name,place_id,address,lat,lng,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync,created_at')
    .eq('user_id', userId)
    .limit(300);

  if (error || !data || data.length === 0) return null;

  let best: { row: RestaurantRow; score: number } | null = null;
  for (const row of data as RestaurantRow[]) {
    const score = localScore(merchantName, merchantAddress, row);
    if (!best || score > best.score) {
      best = { row, score };
    }
  }
  return best;
}

async function googleTextSearch(query: string): Promise<GoogleTextSearchResponse> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { status: 'CONFIG_ERROR', error_message: 'GOOGLE_PLACES_API_KEY is not configured' };
  }

  const params = new URLSearchParams({
    query,
    key: apiKey,
    type: 'restaurant',
    language: 'en',
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    return { status: 'HTTP_ERROR', error_message: 'Failed to fetch Google text search results' };
  }

  return (await response.json()) as GoogleTextSearchResponse;
}

async function attachRestaurantToUpload(
  service: ReturnType<typeof getServiceSupabaseClient>,
  uploadId: string,
  restaurantId: string,
): Promise<void> {
  const { error: uploadError } = await service
    .from('receipt_uploads')
    .update({ restaurant_id: restaurantId })
    .eq('id', uploadId);
  if (uploadError) throw uploadError;

  await service.from('hangouts').update({ restaurant_id: restaurantId }).eq('id', uploadId);
  await service.from('dish_entries').update({ restaurant_id: restaurantId }).eq('hangout_id', uploadId);
}

export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as ResolveRequest | null;
  const uploadId = body?.upload_id?.trim() ?? '';
  const merchantName = (body?.merchant_name ?? '').trim();
  const merchantAddress = (body?.merchant_address ?? '').trim();

  if (!uploadId || !merchantName) {
    return NextResponse.json({ ok: false, error: 'upload_id and merchant_name are required' }, { status: 400 });
  }

  const service = getServiceSupabaseClient();
  const { data: upload, error: uploadError } = await service
    .from('receipt_uploads')
    .select('id,user_id,visit_lat,visit_lng,restaurant_id')
    .eq('id', uploadId)
    .maybeSingle();

  if (uploadError || !upload) {
    return NextResponse.json({ ok: false, error: 'Upload not found' }, { status: 404 });
  }

  if (upload.user_id !== auth.userId) {
    return NextResponse.json({ ok: false, error: 'Only the organizer can resolve restaurant selection' }, { status: 403 });
  }

  const refLat = Number.isFinite(body?.visit_lat as number) ? (body?.visit_lat as number) : upload.visit_lat;
  const refLng = Number.isFinite(body?.visit_lng as number) ? (body?.visit_lng as number) : upload.visit_lng;

  const localBest = await findBestLocalRestaurant(service, auth.userId, merchantName, merchantAddress);

  const localStrong = Boolean(
    localBest &&
      (localBest.score >= 0.82 ||
        (tokenSimilarity(merchantName, localBest.row.name) > 0.75 && tokenSimilarity(merchantAddress, localBest.row.address) > 0.6)),
  );

  if (localStrong && localBest && localBest.row.place_id) {
    let restaurant = localBest.row;

    if (!hasDirectoryFields(restaurant)) {
      try {
        const details = await fetchPlaceDetails(restaurant.place_id as string);
        const { data: enriched } = await service
          .from('restaurants')
          .update({
            phone_number: details.phone_number,
            website: details.website,
            maps_url: details.maps_url,
            opening_hours: details.opening_hours,
            utc_offset_minutes: details.utc_offset_minutes,
            google_rating: details.google_rating,
            price_level: details.price_level,
            business_status: details.business_status,
            last_place_sync: new Date().toISOString(),
          })
          .eq('id', restaurant.id)
          .select('id,user_id,name,place_id,address,lat,lng,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync,created_at')
          .single();

        if (enriched) restaurant = enriched as RestaurantRow;
      } catch {
        // Keep local match even if details refresh fails.
      }
    }

    await attachRestaurantToUpload(service, uploadId, restaurant.id);
    return NextResponse.json({
      ok: true,
      autoResolved: true,
      confidence: localBest.score,
      source: 'local',
      restaurant,
      choices: [],
    });
  }

  const query = [merchantName, merchantAddress].filter(Boolean).join(' ').trim();
  const google = await googleTextSearch(query);

  if (google.status !== 'OK' || !google.results?.length) {
    if (localStrong && localBest) {
      await attachRestaurantToUpload(service, uploadId, localBest.row.id);
      return NextResponse.json({
        ok: true,
        autoResolved: true,
        confidence: localBest.score,
        source: 'local_fallback',
        restaurant: localBest.row,
        choices: [],
      });
    }

    return NextResponse.json({
      ok: true,
      autoResolved: false,
      source: 'none',
      choices: [],
      reason: google.error_message ?? (google.status === 'ZERO_RESULTS' ? 'no_match' : 'lookup_failed'),
    });
  }

  const scored = google.results
    .slice(0, 6)
    .map((result) => {
      const name = result.name ?? '';
      const address = result.formatted_address ?? '';
      const lat = result.geometry?.location?.lat;
      const lng = result.geometry?.location?.lng;
      const nameSim = tokenSimilarity(merchantName, name);
      const addressSim = tokenSimilarity(merchantAddress, address);
      const dist =
        Number.isFinite(refLat as number) &&
        Number.isFinite(refLng as number) &&
        Number.isFinite(lat as number) &&
        Number.isFinite(lng as number)
          ? distanceMeters(refLat as number, refLng as number, lat as number, lng as number)
          : null;
      const distanceScore = dist == null ? 0.6 : Math.max(0, 1 - Math.min(dist, 2500) / 2500);
      const confidence = nameSim * 0.65 + addressSim * 0.2 + distanceScore * 0.15;
      return {
        placeId: result.place_id ?? '',
        name,
        address,
        lat: Number.isFinite(lat as number) ? (lat as number) : null,
        lng: Number.isFinite(lng as number) ? (lng as number) : null,
        nameSim,
        confidence,
        distanceMeters: dist,
      };
    })
    .filter((item) => item.placeId)
    .sort((a, b) => b.confidence - a.confidence);

  const top = scored[0];
  const hasDistance = top?.distanceMeters != null;
  const topIsHighConfidence = Boolean(
    top &&
      ((top.nameSim > 0.7 && hasDistance && (top.distanceMeters as number) < 300) ||
        (!hasDistance && top.nameSim > 0.82 && top.confidence > 0.74)),
  );

  if (top && topIsHighConfidence) {
    let restaurant: RestaurantRow | null = null;

    if (localStrong && localBest) {
      const { data: updatedLocal, error: localUpdateError } = await service
        .from('restaurants')
        .update({
          place_id: top.placeId,
          name: top.name,
          address: top.address || null,
          lat: top.lat,
          lng: top.lng,
        })
        .eq('id', localBest.row.id)
        .select('id,user_id,name,place_id,address,lat,lng,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync,created_at')
        .single();

      if (localUpdateError || !updatedLocal) {
        return NextResponse.json({ ok: false, error: 'Failed to enrich local restaurant match' }, { status: 500 });
      }
      restaurant = updatedLocal as RestaurantRow;
    } else {
      const upsert = await service
        .from('restaurants')
        .upsert(
          {
            user_id: auth.userId,
            place_id: top.placeId,
            name: top.name,
            address: top.address || null,
            lat: top.lat,
            lng: top.lng,
          },
          { onConflict: 'user_id,place_id' },
        )
        .select('id,user_id,name,place_id,address,lat,lng,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync,created_at')
        .single();

      if (upsert.error || !upsert.data) {
        return NextResponse.json({ ok: false, error: 'Failed to save resolved restaurant' }, { status: 500 });
      }

      restaurant = upsert.data as RestaurantRow;
    }

    try {
      const details = await fetchPlaceDetails(top.placeId);
      const { data: enriched } = await service
        .from('restaurants')
        .update({
          phone_number: details.phone_number,
          website: details.website,
          maps_url: details.maps_url,
          opening_hours: details.opening_hours,
          utc_offset_minutes: details.utc_offset_minutes,
          google_rating: details.google_rating,
          price_level: details.price_level,
          business_status: details.business_status,
          last_place_sync: new Date().toISOString(),
        })
        .eq('id', restaurant.id)
        .select('id,user_id,name,place_id,address,lat,lng,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync,created_at')
        .single();

      if (enriched) restaurant = enriched as RestaurantRow;
    } catch {
      // Non-blocking enrichment failure.
    }

    await attachRestaurantToUpload(service, uploadId, restaurant.id);

    return NextResponse.json({
      ok: true,
      autoResolved: true,
      confidence: top.confidence,
      source: localStrong ? 'local_google' : 'google',
      restaurant,
      choices: [],
    });
  }

  const choices: PlaceChoice[] = scored.slice(0, 5).map((item) => ({
    placeId: item.placeId,
    primaryText: item.name,
    secondaryText: item.address,
    confidence: Number(item.confidence.toFixed(3)),
    distance_meters: item.distanceMeters == null ? null : Math.round(item.distanceMeters),
  }));

  return NextResponse.json({
    ok: true,
    autoResolved: false,
    source: 'google',
    choices,
  });
}

