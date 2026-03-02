import { NextResponse } from 'next/server';
import path from 'node:path';
import sharp from 'sharp';
import { authorizeRequest } from '@/lib/api/auth';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const STORAGE_BUCKET = 'uploads';

type UploadBody = {
  kind?: 'hangout' | 'dish';
  hangout_id?: string | null;
  dish_entry_id?: string | null;
  storage_original?: string;
};

function normalizeKind(raw: unknown): 'hangout' | 'dish' | null {
  return raw === 'hangout' || raw === 'dish' ? raw : null;
}

async function validateOwnership(params: {
  userId: string;
  kind: 'hangout' | 'dish';
  hangoutId: string | null;
  dishEntryId: string | null;
}) {
  const supabase = getServiceSupabaseClient();

  if (params.kind === 'hangout') {
    if (!params.hangoutId) return false;
    const { data: canonical } = await supabase
      .from('hangouts')
      .select('id')
      .eq('id', params.hangoutId)
      .maybeSingle();
    if (canonical?.id) {
      const { data: participant } = await supabase
        .from('hangout_participants')
        .select('hangout_id')
        .eq('hangout_id', params.hangoutId)
        .eq('user_id', params.userId)
        .maybeSingle();
      if (participant?.hangout_id) return true;

      const { data: owner } = await supabase
        .from('hangouts')
        .select('id')
        .eq('id', params.hangoutId)
        .eq('owner_user_id', params.userId)
        .maybeSingle();
      if (owner?.id) return true;
    }

    const { data: legacy } = await supabase
      .from('receipt_uploads')
      .select('id')
      .eq('id', params.hangoutId)
      .eq('user_id', params.userId)
      .maybeSingle();
    return Boolean(legacy?.id);
  }

  if (!params.dishEntryId) return false;
  const { data } = await supabase
    .from('dish_entries')
    .select('id')
    .eq('id', params.dishEntryId)
    .eq('user_id', params.userId)
    .maybeSingle();
  return Boolean(data?.id);
}

async function ensureHangoutExistsForLegacyTarget(params: { hangoutId: string; userId: string }) {
  const supabase = getServiceSupabaseClient();
  const { data: existing } = await supabase.from('hangouts').select('id').eq('id', params.hangoutId).maybeSingle();
  if (existing?.id) return;

  const { data: legacy } = await supabase
    .from('receipt_uploads')
    .select('id,user_id,restaurant_id,visited_at,created_at,visit_note')
    .eq('id', params.hangoutId)
    .eq('user_id', params.userId)
    .maybeSingle();
  if (!legacy?.id) return;

  await supabase.from('hangouts').upsert({
    id: legacy.id,
    owner_user_id: legacy.user_id,
    restaurant_id: legacy.restaurant_id,
    occurred_at: legacy.visited_at ?? legacy.created_at,
    note: legacy.visit_note ?? null,
  });
  await supabase
    .from('hangout_participants')
    .upsert({ hangout_id: legacy.id, user_id: legacy.user_id }, { onConflict: 'hangout_id,user_id' });
}

async function signVariant(pathValue: string): Promise<string | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(pathValue, 60 * 30);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function deriveVariantPaths(originalPath: string): { mediumPath: string; thumbPath: string } {
  const dir = path.posix.dirname(originalPath);
  return {
    mediumPath: `${dir}/medium.jpg`,
    thumbPath: `${dir}/thumb.jpg`,
  };
}

export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const body = (await request.json().catch(() => null)) as UploadBody | null;
  const kind = normalizeKind(body?.kind);
  const hangoutId = (body?.hangout_id ?? null)?.trim() || null;
  const dishEntryId = (body?.dish_entry_id ?? null)?.trim() || null;
  const storageOriginal = (body?.storage_original ?? '').trim();

  if (!kind) {
    return NextResponse.json({ error: 'kind must be hangout or dish' }, { status: 400 });
  }

  if (!storageOriginal) {
    return NextResponse.json({ error: 'storage_original is required' }, { status: 400 });
  }

  if (kind === 'hangout' && (!hangoutId || dishEntryId)) {
    return NextResponse.json({ error: 'hangout kind requires hangout_id only' }, { status: 400 });
  }

  if (kind === 'dish' && !dishEntryId) {
    return NextResponse.json({ error: 'dish kind requires dish_entry_id' }, { status: 400 });
  }

  if (!storageOriginal.startsWith(`${auth.userId}/photos/${kind}/`)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 });
  }

  const ownsTarget = await validateOwnership({
    userId: auth.userId,
    kind,
    hangoutId,
    dishEntryId,
  });

  if (!ownsTarget) {
    return NextResponse.json({ error: 'Target not found' }, { status: 404 });
  }

  if (kind === 'hangout' && hangoutId) {
    await ensureHangoutExistsForLegacyTarget({ hangoutId, userId: auth.userId });
  }

  const supabase = getServiceSupabaseClient();

  const { data: originalFile, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET).download(storageOriginal);
  if (downloadError || !originalFile) {
    return NextResponse.json({ error: 'Failed to read uploaded original' }, { status: 500 });
  }

  const sourceBuffer = Buffer.from(await originalFile.arrayBuffer());

  const mediumBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: 1280, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  const thumbBuffer = await sharp(sourceBuffer)
    .rotate()
    .resize({ width: 320, withoutEnlargement: true })
    .jpeg({ quality: 76, mozjpeg: true })
    .toBuffer();

  const { mediumPath, thumbPath } = deriveVariantPaths(storageOriginal);

  const uploads = await Promise.all([
    supabase.storage.from(STORAGE_BUCKET).upload(mediumPath, mediumBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    }),
    supabase.storage.from(STORAGE_BUCKET).upload(thumbPath, thumbBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    }),
  ]);

  if (uploads.some((result) => result.error)) {
    return NextResponse.json({ error: 'Failed to upload photo variants' }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('photos')
    .insert({
      user_id: auth.userId,
      created_by: auth.userId,
      kind,
      hangout_id: kind === 'hangout' ? hangoutId : null,
      dish_entry_id: kind === 'dish' ? dishEntryId : null,
      storage_path: storageOriginal,
      storage_original: storageOriginal,
      storage_medium: mediumPath,
      storage_thumb: thumbPath,
    })
    .select('id,kind,dish_entry_id,hangout_id,storage_thumb,storage_medium')
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: insertError?.message ?? 'Failed to save photo' }, { status: 500 });
  }

  const [thumbUrl, mediumUrl] = await Promise.all([signVariant(inserted.storage_thumb), signVariant(inserted.storage_medium)]);

  return NextResponse.json({
    photo: {
      id: inserted.id,
      kind: inserted.kind,
      dish_entry_id: inserted.dish_entry_id,
      hangout_id: inserted.hangout_id,
      signedUrls: {
        thumb: thumbUrl,
        medium: mediumUrl,
      },
    },
  });
}
