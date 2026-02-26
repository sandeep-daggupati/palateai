import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { authorizeRequest } from '@/lib/api/auth';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const STORAGE_BUCKET = 'uploads';

function normalizeKind(raw: string | null): 'hangout' | 'dish' | null {
  if (raw === 'hangout' || raw === 'dish') return raw;
  return null;
}

function getExtension(contentType: string | null, filename: string): string {
  const fromName = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : null;
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  if (!contentType) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('heic')) return 'heic';
  return 'jpg';
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
    const { data } = await supabase
      .from('receipt_uploads')
      .select('id')
      .eq('id', params.hangoutId)
      .eq('user_id', params.userId)
      .maybeSingle();
    return Boolean(data?.id);
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

async function signVariant(path: string): Promise<string | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, 60 * 30);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const form = await request.formData();
  const file = form.get('file');
  const kind = normalizeKind((form.get('kind') as string | null) ?? null);
  const hangoutId = ((form.get('hangout_id') as string | null) ?? null)?.trim() || null;
  const dishEntryId = ((form.get('dish_entry_id') as string | null) ?? null)?.trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  if (!kind) {
    return NextResponse.json({ error: 'kind must be hangout or dish' }, { status: 400 });
  }

  if (kind === 'hangout' && (!hangoutId || dishEntryId)) {
    return NextResponse.json({ error: 'hangout kind requires hangout_id only' }, { status: 400 });
  }

  if (kind === 'dish' && (!dishEntryId || hangoutId)) {
    return NextResponse.json({ error: 'dish kind requires dish_entry_id only' }, { status: 400 });
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

  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const originalExtension = getExtension(file.type, file.name);
  const objectId = crypto.randomUUID();
  const basePath = `${auth.userId}/photos/${kind}/${objectId}`;
  const originalPath = `${basePath}/original.${originalExtension}`;
  const mediumPath = `${basePath}/medium.jpg`;
  const thumbPath = `${basePath}/thumb.jpg`;

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

  const supabase = getServiceSupabaseClient();

  const uploads = await Promise.all([
    supabase.storage.from(STORAGE_BUCKET).upload(originalPath, sourceBuffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    }),
    supabase.storage.from(STORAGE_BUCKET).upload(mediumPath, mediumBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    }),
    supabase.storage.from(STORAGE_BUCKET).upload(thumbPath, thumbBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    }),
  ]);

  if (uploads.some((result) => result.error)) {
    return NextResponse.json({ error: 'Failed to upload photo variants' }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('photos')
    .insert({
      user_id: auth.userId,
      kind,
      hangout_id: kind === 'hangout' ? hangoutId : null,
      dish_entry_id: kind === 'dish' ? dishEntryId : null,
      storage_original: originalPath,
      storage_medium: mediumPath,
      storage_thumb: thumbPath,
    })
    .select('*')
    .single();

  if (insertError || !inserted) {
    return NextResponse.json({ error: 'Failed to save photo' }, { status: 500 });
  }
  const insertedPhoto = inserted as {
    id: string;
    kind: 'hangout' | 'dish';
    dish_entry_id: string | null;
    hangout_id: string | null;
    storage_thumb: string;
    storage_medium: string;
  };


  const [thumbUrl, mediumUrl] = await Promise.all([signVariant(insertedPhoto.storage_thumb), signVariant(insertedPhoto.storage_medium)]);

  return NextResponse.json({
    photo: {
      id: insertedPhoto.id,
      kind: insertedPhoto.kind,
      dish_entry_id: insertedPhoto.dish_entry_id,
      hangout_id: insertedPhoto.hangout_id,
      signedUrls: {
        thumb: thumbUrl,
        medium: mediumUrl,
      },
    },
  });
}


