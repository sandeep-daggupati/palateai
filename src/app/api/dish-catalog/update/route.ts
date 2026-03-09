import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/lib/supabase/types';
import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { toDishKey } from '@/lib/utils';
import { sanitizeText } from '@/lib/text/sanitize';

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

  return { user, token };
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = sanitizeText(value);
  if (!cleaned) return null;
  return cleaned.slice(0, maxLen);
}

function cleanFlavorTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const tag = sanitizeText(item).toLowerCase()
      .replace(/[^a-z0-9- ]+/g, '')
      .replace(/\s+/g, '-');

    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag.slice(0, 32));
    if (result.length >= 8) break;
  }

  return result.length > 0 ? result : [];
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    hangoutId?: string;
    hangoutItemId?: string;
    nameCanonical?: string;
    description?: string;
    flavorTags?: string[];
  } | null;

  const hangoutId = body?.hangoutId?.trim();
  const hangoutItemId = body?.hangoutItemId?.trim();

  if (!hangoutId || !hangoutItemId) {
    return NextResponse.json({ ok: false, error: 'hangoutId and hangoutItemId are required' }, { status: 400 });
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

  const { data: item } = await userClient
    .from('hangout_items')
    .select('id,hangout_id,name_raw,name_final')
    .eq('id', hangoutItemId)
    .eq('hangout_id', hangoutId)
    .maybeSingle();

  if (!item) {
    return NextResponse.json({ ok: false, error: 'Dish not found' }, { status: 404 });
  }

  const { data: hangout } = await userClient.from('hangouts').select('id,restaurant_id').eq('id', hangoutId).maybeSingle();
  if (!hangout) {
    return NextResponse.json({ ok: false, error: 'Hangout not found' }, { status: 404 });
  }

  let restaurantName: string | null = null;
  if (hangout.restaurant_id) {
    const { data: restaurant } = await userClient.from('restaurants').select('name').eq('id', hangout.restaurant_id).maybeSingle();
    restaurantName = restaurant?.name ?? null;
  }

  const sourceDishName = item.name_final || item.name_raw;
  const dishKey = toDishKey(`${restaurantName ?? 'unknown-restaurant'} ${sourceDishName}`);

  const nameCanonical = cleanText(body?.nameCanonical, 80) ?? sourceDishName;
  const description = cleanText(body?.description, 220);
  const flavorTags = cleanFlavorTags(body?.flavorTags) ?? [];

  const service = getServiceSupabaseClient();
  const { data, error } = await service
    .from('dish_catalog')
    .upsert(
      {
        dish_key: dishKey,
        name_canonical: nameCanonical,
        description,
        flavor_tags: flavorTags,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'dish_key' },
    )
    .select('*')
    .single();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: error?.message ?? 'Failed to update dish catalog' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, catalog: data });
}

