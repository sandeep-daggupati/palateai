import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { authorizeRequest } from '@/lib/api/auth';
import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { Database, DishEntry, Photo } from '@/lib/supabase/types';

const STORAGE_BUCKET = 'uploads';

function getUserScopedClient(token: string) {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  );
}

export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('hangout_ids')?.trim() ?? '';
  const hangoutIds = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (hangoutIds.length === 0) {
    return NextResponse.json({ covers: {} });
  }

  const userClient = getUserScopedClient(auth.token);
  const service = getServiceSupabaseClient();

  const { data: hangoutPhotosRaw } = await userClient
    .from('photos')
    .select('id,hangout_id,dish_entry_id,kind,storage_thumb,created_at')
    .eq('kind', 'hangout')
    .in('hangout_id', hangoutIds)
    .order('created_at', { ascending: false });
  const hangoutPhotos = (hangoutPhotosRaw ?? []) as Array<Pick<Photo, 'id' | 'hangout_id' | 'dish_entry_id' | 'kind' | 'storage_thumb' | 'created_at'>>;

  const { data: dishEntriesRaw } = await userClient
    .from('dish_entries')
    .select('id,hangout_id,source_upload_id')
    .or(`hangout_id.in.(${hangoutIds.join(',')}),source_upload_id.in.(${hangoutIds.join(',')})`);
  const dishEntries = (dishEntriesRaw ?? []) as Array<Pick<DishEntry, 'id' | 'hangout_id' | 'source_upload_id'>>;
  const dishEntryIds = dishEntries.map((row) => row.id);

  let dishPhotos: Array<Pick<Photo, 'id' | 'dish_entry_id' | 'storage_thumb' | 'created_at'>> = [];
  if (dishEntryIds.length > 0) {
    const { data: dishPhotosRaw } = await userClient
      .from('photos')
      .select('id,dish_entry_id,storage_thumb,created_at')
      .eq('kind', 'dish')
      .in('dish_entry_id', dishEntryIds)
      .order('created_at', { ascending: false });
    dishPhotos = (dishPhotosRaw ?? []) as Array<Pick<Photo, 'id' | 'dish_entry_id' | 'storage_thumb' | 'created_at'>>;
  }

  const hangoutIdByDishEntryId = dishEntries.reduce((acc, row) => {
    const hangoutId = row.source_upload_id ?? row.hangout_id;
    if (!hangoutId) return acc;
    acc[row.id] = hangoutId;
    return acc;
  }, {} as Record<string, string>);

  const bestPathByHangoutId: Record<string, string> = {};
  for (const row of hangoutPhotos) {
    if (!row.hangout_id) continue;
    if (!bestPathByHangoutId[row.hangout_id]) {
      bestPathByHangoutId[row.hangout_id] = row.storage_thumb;
    }
  }
  for (const row of dishPhotos) {
    if (!row.dish_entry_id) continue;
    const hangoutId = hangoutIdByDishEntryId[row.dish_entry_id];
    if (!hangoutId) continue;
    if (!bestPathByHangoutId[hangoutId]) {
      bestPathByHangoutId[hangoutId] = row.storage_thumb;
    }
  }

  const paths = Array.from(new Set(Object.values(bestPathByHangoutId)));
  const signedByPath: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed } = await service.storage.from(STORAGE_BUCKET).createSignedUrls(paths, 60 * 20);
    for (let i = 0; i < paths.length; i += 1) {
      const url = signed?.[i]?.signedUrl;
      if (url) signedByPath[paths[i]] = url;
    }
  }

  const covers = hangoutIds.reduce(
    (acc, id) => {
      const path = bestPathByHangoutId[id];
      acc[id] = path ? signedByPath[path] ?? null : null;
      return acc;
    },
    {} as Record<string, string | null>,
  );

  return NextResponse.json({ covers });
}
