import { NextResponse } from 'next/server';

type GoogleAutocompleteResponse = {
  status: string;
  predictions?: Array<{
    place_id?: string;
    structured_formatting?: {
      main_text?: string;
      secondary_text?: string;
    };
    description?: string;
  }>;
  error_message?: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const latRaw = searchParams.get('lat');
  const lngRaw = searchParams.get('lng');

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GOOGLE_MAPS_API_KEY is not configured' }, { status: 500 });
  }

  const params = new URLSearchParams({
    input: q,
    key: apiKey,
    types: 'establishment',
    language: 'en',
  });

  const lat = latRaw ? Number.parseFloat(latRaw) : Number.NaN;
  const lng = lngRaw ? Number.parseFloat(lngRaw) : Number.NaN;

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    params.set('location', `${lat},${lng}`);
    params.set('radius', '50000');
  }

  const response = await fetch(`https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json({ error: 'Failed to fetch places autocomplete' }, { status: 502 });
  }

  const data = (await response.json()) as GoogleAutocompleteResponse;

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    return NextResponse.json(
      { error: data.error_message ?? `Places autocomplete failed with status ${data.status}` },
      { status: 502 },
    );
  }

  const results = (data.predictions ?? []).slice(0, 8).map((prediction) => ({
    placeId: prediction.place_id ?? '',
    primaryText: prediction.structured_formatting?.main_text ?? prediction.description ?? 'Unknown place',
    secondaryText: prediction.structured_formatting?.secondary_text ?? '',
  })).filter((prediction) => prediction.placeId.length > 0);

  return NextResponse.json({ results });
}
