import { NextResponse } from 'next/server';

type GooglePlaceDetailsResponse = {
  status: string;
  result?: {
    place_id?: string;
    name?: string;
    formatted_address?: string;
    geometry?: {
      location?: {
        lat?: number;
        lng?: number;
      };
    };
    url?: string;
  };
  error_message?: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get('placeId')?.trim();

  if (!placeId) {
    return NextResponse.json({ error: 'placeId is required' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY is not configured' }, { status: 500 });
  }

  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'place_id,name,formatted_address,geometry/location,url',
    key: apiKey,
  });

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'Failed to fetch place details' }, { status: 502 });
  }

  const data = (await response.json()) as GooglePlaceDetailsResponse;

  if (data.status !== 'OK' || !data.result) {
    return NextResponse.json(
      { error: data.error_message ?? `Place details failed with status ${data.status}` },
      { status: 502 },
    );
  }

  const lat = data.result.geometry?.location?.lat ?? null;
  const lng = data.result.geometry?.location?.lng ?? null;

  return NextResponse.json({
    placeId: data.result.place_id ?? placeId,
    name: data.result.name ?? 'Unknown place',
    address: data.result.formatted_address ?? '',
    lat,
    lng,
    googleMapsUrl: data.result.url ?? null,
  });
}
