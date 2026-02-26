'use client';

import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

function extensionFromFile(file: File): string {
  const byName = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : null;
  if (byName && /^[a-z0-9]+$/.test(byName)) return byName;
  if (file.type.includes('png')) return 'png';
  if (file.type.includes('webp')) return 'webp';
  if (file.type.includes('heic')) return 'heic';
  return 'jpg';
}

export async function uploadOriginalPhotoDirect(params: {
  file: File;
  kind: 'hangout' | 'dish';
}): Promise<string> {
  const supabase = getBrowserSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Not authenticated');
  }

  const ext = extensionFromFile(params.file);
  const objectPath = `${user.id}/photos/${params.kind}/${crypto.randomUUID()}/original.${ext}`;

  const { error } = await supabase.storage.from('uploads').upload(objectPath, params.file, {
    contentType: params.file.type || 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return objectPath;
}
