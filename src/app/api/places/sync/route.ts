import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchPlaceDetails } from '@/lib/google/places';
import { Database } from '@/lib/supabase/types';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function getAnonSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing Supabase public environment variables.');
  }

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function authorize(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    return { error: NextResponse.json({ ok: false, error: 'Missing auth token' }, { status: 401 }) };
  }

  const anon = getAnonSupabaseClient();
  const {
    data: { user },
    error,
  } = await anon.auth.getUser(token);

  if (error || !user) {
    return { error: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  return { user, anon, token };
}

function isFresh(lastSync: string | null): boolean {
  if (!lastSync) return false;
  const stamp = new Date(lastSync).getTime();
  if (Number.isNaN(stamp)) return false;
  return Date.now() - stamp < THIRTY_DAYS_MS;
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;

  const payload = (await request.json().catch(() => null)) as {
    restaurant_id?: string;
    place_id?: string;
    force?: boolean;
  } | null;

  const restaurantId = payload?.restaurant_id?.trim() ?? null;
  const placeId = payload?.place_id?.trim() ?? null;
  const force = payload?.force === true;

  if (!restaurantId && !placeId) {
    return NextResponse.json({ ok: false, error: 'restaurant_id or place_id is required' }, { status: 400 });
  }

  // Use a client authenticated as the user to fetch the restaurant.
  // This allows RLS to enforce who can read the restaurant (users and active participants).
  const userClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
      },
    }
  );

  let restaurantQuery = userClient
    .from('restaurants')
    .select(
      'id,user_id,name,place_id,address,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync',
    )
    .limit(1);

  if (restaurantId) {
    restaurantQuery = restaurantQuery.eq('id', restaurantId);
  } else if (placeId) {
    restaurantQuery = restaurantQuery.eq('place_id', placeId);
  } else {
    return NextResponse.json({ ok: false, error: 'restaurant_id or place_id is required' }, { status: 400 });
  }

  const { data: restaurant, error: lookupError } = await restaurantQuery.maybeSingle();

  if (lookupError || !restaurant) {
    return NextResponse.json({ ok: false, error: 'Restaurant not found' }, { status: 404 });
  }

  if (!restaurant.place_id) {
    return NextResponse.json({ ok: false, reason: 'missing place_id', restaurant }, { status: 200 });
  }

  if (!force && isFresh(restaurant.last_place_sync)) {
    return NextResponse.json({ ok: true, cached: true, restaurant });
  }

  try {
    const details = await fetchPlaceDetails(restaurant.place_id);

    // Use service client to update the restaurant, as the requesting user
    // might not be the owner (e.g., they are a shared participant). RLS
    // blocks non-owners from updating, but they still need to be able to sync.
    const service = getServiceSupabaseClient();

    const { data: updatedRestaurant, error: updateError } = await service
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
      .select(
        'id,user_id,name,place_id,address,phone_number,website,maps_url,opening_hours,utc_offset_minutes,google_rating,price_level,business_status,last_place_sync',
      )
      .single();

    if (updateError) {
      return NextResponse.json({ ok: false, error: 'Failed to update restaurant directory', restaurant }, { status: 500 });
    }

    return NextResponse.json({ ok: true, cached: false, restaurant: updatedRestaurant });
  } catch (err) {
    console.error('Failed to sync place details:', err);
    const hasCached = Boolean(restaurant.phone_number || restaurant.website || restaurant.maps_url || restaurant.opening_hours);
    if (hasCached) {
      return NextResponse.json({ ok: true, cached: true, restaurant });
    }
    return NextResponse.json({ ok: false, error: 'Failed to sync place details' }, { status: 502 });
  }
}

