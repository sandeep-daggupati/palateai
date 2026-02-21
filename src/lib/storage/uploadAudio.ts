'use client';

import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

export async function uploadAudio(params: {
  blob: Blob;
  userId: string;
  uploadId: string;
}) {
  const { blob, userId, uploadId } = params;
  const filePath = `${userId}/audio/${uploadId}/${crypto.randomUUID()}.webm`;
  const supabase = getBrowserSupabaseClient();

  const { error } = await supabase.storage.from('uploads').upload(filePath, blob, {
    upsert: false,
    contentType: 'audio/webm',
  });

  if (error) {
    throw error;
  }

  return filePath;
}
