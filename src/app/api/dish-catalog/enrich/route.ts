import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ensureDishCatalogEntry } from '@/lib/data/dishCatalog';
import { Database } from '@/lib/supabase/types';

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

  return { anon, user, token };
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as { dishEntryId?: string } | null;
  const dishEntryId = body?.dishEntryId?.trim();

  if (!dishEntryId) {
    return NextResponse.json({ ok: false, error: 'dishEntryId is required' }, { status: 400 });
  }

  const userClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
      },
    },
  );

  const { data: entry, error: entryError } = await userClient
    .from('dish_entries')
    .select('id,dish_key,dish_name,restaurant_id')
    .eq('id', dishEntryId)
    .maybeSingle();

  if (entryError || !entry) {
    return NextResponse.json({ ok: false, error: 'Dish entry not found' }, { status: 404 });
  }

  if (!entry.dish_key) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  let restaurantName: string | null = null;
  if (entry.restaurant_id) {
    const { data: restaurant } = await userClient
      .from('restaurants')
      .select('name')
      .eq('id', entry.restaurant_id)
      .maybeSingle();
    restaurantName = restaurant?.name ?? null;
  }

  try {
    const catalog = await ensureDishCatalogEntry({
      dishKey: entry.dish_key,
      dishName: entry.dish_name,
      restaurantName,
    });

    return NextResponse.json({ ok: true, catalog });
  } catch (error) {
    console.error('Dish catalog enrichment failed:', error);
    return NextResponse.json({ ok: false, error: 'Enrichment failed' }, { status: 500 });
  }
}
