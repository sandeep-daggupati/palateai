'use client';

import imageCompression from 'browser-image-compression';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';

export async function uploadImage(params: {
  file: File;
  userId: string;
  uploadId: string;
  category: 'receipt' | 'menu' | 'dish' | 'temp_receipt';
  onProgress?: (progress: number) => void;
}) {
  const { file, userId, uploadId, category, onProgress } = params;

  const compressed = await imageCompression(file, {
    maxWidthOrHeight: 1600,
    maxSizeMB: 2,
    initialQuality: 0.8,
    useWebWorker: true,
    onProgress,
  });

  const extension = file.name.split('.').pop() || 'jpg';
  const filePath = `${userId}/${category}/${uploadId}/${crypto.randomUUID()}.${extension}`;
  const supabase = getBrowserSupabaseClient();

  const { error } = await supabase.storage
    .from('uploads')
    .upload(filePath, compressed, { upsert: false, contentType: file.type });

  if (error) {
    throw error;
  }

  return filePath;
}
