import path from 'node:path';
import sharp from 'sharp';
import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/api/auth';
import { getServiceSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const STORAGE_BUCKET = 'uploads';

function extensionFromName(name: string, mime: string): string {
  const fromName = name.includes('.') ? name.split('.').pop()?.toLowerCase() : null;
  if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic')) return 'heic';
  return 'jpg';
}

function deriveVariantPaths(originalPath: string): { mediumPath: string; thumbPath: string } {
  const dir = path.posix.dirname(originalPath);
  return {
    mediumPath: `${dir}/medium.jpg`,
    thumbPath: `${dir}/thumb.jpg`,
  };
}

async function signUrl(storagePath: string): Promise<string | null> {
  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60 * 30);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function POST(request: Request) {
  const auth = await authorizeRequest(request);
  if ('error' in auth) return auth.error;

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'Invalid multipart payload' }, { status: 400 });
  }

  const dishEntryId = String(formData.get('dish_entry_id') ?? '').trim();
  const file = formData.get('file');

  if (!dishEntryId) {
    return NextResponse.json({ error: 'dish_entry_id is required' }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  const supabase = getServiceSupabaseClient();

  const { data: dishEntry } = await supabase
    .from('dish_entries')
    .select('id,user_id,hangout_id,source_upload_id')
    .eq('id', dishEntryId)
    .maybeSingle();

  if (!dishEntry) {
    return NextResponse.json({ error: 'Dish entry not found' }, { status: 404 });
  }

  const visitId = dishEntry.source_upload_id ?? dishEntry.hangout_id;
  if (!visitId) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  const { data: participant } = await supabase
    .from('visit_participants')
    .select('visit_id')
    .eq('visit_id', visitId)
    .eq('user_id', auth.userId)
    .eq('status', 'active')
    .maybeSingle();
  const { data: owner } = await supabase
    .from('receipt_uploads')
    .select('id')
    .eq('id', visitId)
    .eq('user_id', auth.userId)
    .maybeSingle();
  if (!participant?.visit_id && !owner?.id) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
  }

  const ext = extensionFromName(file.name, file.type || 'application/octet-stream');
  const folder = `${auth.userId}/photos/dish/${crypto.randomUUID()}`;
  const storageOriginal = `${folder}/original.${ext}`;
  const { mediumPath, thumbPath } = deriveVariantPaths(storageOriginal);

  const sourceBuffer = Buffer.from(await file.arrayBuffer());

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

  const originalUpload = await supabase.storage.from(STORAGE_BUCKET).upload(storageOriginal, sourceBuffer, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (originalUpload.error) {
    return NextResponse.json({ error: 'Failed to upload original photo' }, { status: 500 });
  }

  const [mediumUpload, thumbUpload] = await Promise.all([
    supabase.storage.from(STORAGE_BUCKET).upload(mediumPath, mediumBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    }),
    supabase.storage.from(STORAGE_BUCKET).upload(thumbPath, thumbBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    }),
  ]);

  if (mediumUpload.error || thumbUpload.error) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storageOriginal, mediumPath, thumbPath]);
    return NextResponse.json({ error: 'Failed to upload photo variants' }, { status: 500 });
  }

  const { data: existingPhoto } = await supabase
    .from('photos')
    .select('id,storage_original,storage_medium,storage_thumb')
    .eq('kind', 'dish')
    .eq('dish_entry_id', dishEntryId)
    .maybeSingle();

  const previousPaths = existingPhoto
    ? [existingPhoto.storage_original, existingPhoto.storage_medium, existingPhoto.storage_thumb].filter(Boolean)
    : [];

  const writeResult = existingPhoto
    ? await supabase
        .from('photos')
        .update({
          user_id: auth.userId,
          kind: 'dish',
          hangout_id: dishEntry.hangout_id,
          dish_entry_id: dishEntryId,
          storage_original: storageOriginal,
          storage_medium: mediumPath,
          storage_thumb: thumbPath,
        })
        .eq('id', existingPhoto.id)
        .select('id,user_id,kind,hangout_id,dish_entry_id,storage_original,storage_medium,storage_thumb,created_at')
        .single()
    : await supabase
        .from('photos')
        .insert({
          user_id: auth.userId,
          kind: 'dish',
          hangout_id: dishEntry.hangout_id,
          dish_entry_id: dishEntryId,
          storage_original: storageOriginal,
          storage_medium: mediumPath,
          storage_thumb: thumbPath,
        })
        .select('id,user_id,kind,hangout_id,dish_entry_id,storage_original,storage_medium,storage_thumb,created_at')
        .single();

  if (writeResult.error || !writeResult.data) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storageOriginal, mediumPath, thumbPath]);
    return NextResponse.json({ error: writeResult.error?.message ?? 'Failed to save dish photo' }, { status: 500 });
  }

  if (previousPaths.length > 0) {
    const oldUniquePaths = previousPaths.filter((p) => p !== storageOriginal && p !== mediumPath && p !== thumbPath);
    if (oldUniquePaths.length > 0) {
      await supabase.storage.from(STORAGE_BUCKET).remove(oldUniquePaths);
    }
  }

  const [thumbUrl, mediumUrl, originalUrl] = await Promise.all([
    signUrl(writeResult.data.storage_thumb),
    signUrl(writeResult.data.storage_medium),
    signUrl(writeResult.data.storage_original),
  ]);

  return NextResponse.json({
    photo: {
      id: writeResult.data.id,
      user_id: writeResult.data.user_id,
      kind: writeResult.data.kind,
      hangout_id: writeResult.data.hangout_id,
      dish_entry_id: writeResult.data.dish_entry_id,
      created_at: writeResult.data.created_at,
      signedUrls: {
        thumb: thumbUrl,
        medium: mediumUrl,
        original: originalUrl,
      },
    },
  });
}
