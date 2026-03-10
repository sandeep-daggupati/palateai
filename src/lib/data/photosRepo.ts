'use client';

import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { SignedPhoto } from '@/lib/photos/types';
import { uploadOriginalPhotoDirect } from '@/lib/photos/clientUpload';

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = getBrowserSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

export async function listHangoutPhotos(hangoutId: string): Promise<SignedPhoto[]> {
  const response = await fetch(`/api/photos/list?kind=hangout&hangout_id=${encodeURIComponent(hangoutId)}&include_original=1`, {
    headers: await authHeaders(),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { photos?: SignedPhoto[] };
  return payload.photos ?? [];
}

export async function listDishPhotosForHangout(hangoutId: string): Promise<SignedPhoto[]> {
  const supabase = getBrowserSupabaseClient();
  const byHangout = await supabase.from('dish_entries').select('id').eq('hangout_id', hangoutId);
  const entries =
    byHangout.error
      ? await supabase.from('dish_entries').select('id').eq('source_upload_id', hangoutId)
      : byHangout;
  const ids = (entries.data ?? []).map((row) => row.id).filter(Boolean).join(',');
  if (!ids) return [];

  const response = await fetch(`/api/photos/list?kind=dish&dish_entry_ids=${encodeURIComponent(ids)}&include_original=1`, {
    headers: await authHeaders(),
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { photos?: SignedPhoto[] };
  return payload.photos ?? [];
}

export async function uploadHangoutPhoto(hangoutId: string, file: File): Promise<SignedPhoto | null> {
  const storageOriginal = await uploadOriginalPhotoDirect({ file, kind: 'hangout' });
  const response = await fetch('/api/photos/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      kind: 'hangout',
      hangout_id: hangoutId,
      storage_original: storageOriginal,
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { photo?: SignedPhoto };
  return payload.photo ?? null;
}

export async function uploadDishPhoto(hangoutId: string, dishEntryId: string, file: File): Promise<SignedPhoto | null> {
  const storageOriginal = await uploadOriginalPhotoDirect({ file, kind: 'dish' });

  const response = await fetch('/api/photos/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({
      kind: 'dish',
      hangout_id: hangoutId,
      dish_entry_id: dishEntryId,
      storage_original: storageOriginal,
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { photo?: SignedPhoto };
  return payload.photo ?? null;
}

export async function deletePhoto(photoId: string): Promise<boolean> {
  const response = await fetch('/api/photos/delete', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({ photoId }),
  });
  return response.ok;
}
