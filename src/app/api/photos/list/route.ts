import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/api/auth';
import { getServiceSupabaseClient } from '@/lib/supabase/server';
import { Photo } from '@/lib/supabase/types';

const STORAGE_BUCKET = 'uploads';

function normalizeKind(raw: string | null): 'hangout' | 'dish' | null {
  if (raw === 'hangout' || raw === 'dish') return raw;
  return null;
}

export async function GET(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const kind = normalizeKind(searchParams.get('kind'));
  const hangoutId = searchParams.get('hangout_id')?.trim() || null;
  const dishEntryId = searchParams.get('dish_entry_id')?.trim() || null;
  const dishEntryIdsRaw = searchParams.get('dish_entry_ids')?.trim() || null;
  const includeOriginal = searchParams.get('include_original') === '1';

  if (!kind) {
    return NextResponse.json({ error: 'kind is required' }, { status: 400 });
  }

  const supabase = getServiceSupabaseClient();

  let query = supabase
    .from('photos')
    .select('id,user_id,kind,hangout_id,dish_entry_id,storage_original,storage_medium,storage_thumb,created_at')
    .eq('user_id', auth.userId)
    .eq('kind', kind)
    .order('created_at', { ascending: false });

  if (kind === 'hangout') {
    if (!hangoutId) {
      return NextResponse.json({ error: 'hangout_id is required for hangout kind' }, { status: 400 });
    }
    query = query.eq('hangout_id', hangoutId);
  }

  if (kind === 'dish') {
    if (dishEntryIdsRaw) {
      const ids = dishEntryIdsRaw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 100);

      if (ids.length === 0) {
        return NextResponse.json({ photos: [] });
      }

      query = query.in('dish_entry_id', ids);
    } else {
      if (!dishEntryId) {
        return NextResponse.json({ error: 'dish_entry_id or dish_entry_ids is required for dish kind' }, { status: 400 });
      }
      query = query.eq('dish_entry_id', dishEntryId);
    }
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: 'Failed to load photos' }, { status: 500 });
  }

  const rows = (data ?? []) as Photo[];

  const thumbPaths = rows.map((row) => row.storage_thumb);
  const mediumPaths = rows.map((row) => row.storage_medium);
  const originalPaths = includeOriginal ? rows.map((row) => row.storage_original) : [];

  const [{ data: thumbSigned }, { data: mediumSigned }, originalSignedResult] = await Promise.all([
    supabase.storage.from(STORAGE_BUCKET).createSignedUrls(thumbPaths, 60 * 30),
    supabase.storage.from(STORAGE_BUCKET).createSignedUrls(mediumPaths, 60 * 30),
    includeOriginal ? supabase.storage.from(STORAGE_BUCKET).createSignedUrls(originalPaths, 60 * 10) : Promise.resolve({ data: [] }),
  ]);

  const photos = rows.map((row, index) => ({
    id: row.id,
    kind: row.kind,
    hangout_id: row.hangout_id,
    dish_entry_id: row.dish_entry_id,
    created_at: row.created_at,
    signedUrls: {
      thumb: thumbSigned?.[index]?.signedUrl ?? null,
      medium: mediumSigned?.[index]?.signedUrl ?? null,
      original: includeOriginal ? originalSignedResult.data?.[index]?.signedUrl ?? null : null,
    },
  }));

  return NextResponse.json({ photos });
}
